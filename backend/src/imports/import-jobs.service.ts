import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normalizeRows, type ImportMode, type NormalizedRow, type RowInput } from '../csv/csv-import.js';
import type { GroupRef, GroupsService } from '../groups/groups.service.js';
import { WafBlockedError, errorMessage } from '../keycloak/errors.js';
import type { KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';
import type { AuditLogService } from './audit-log.service.js';
import { ImportProcessor } from './import-processor.js';
import { FINAL_STATUSES, type ImportJob, type MissingGroup, type RowResult } from './import.types.js';
import { checkRowGroups } from './row-groups.js';

export interface ImportJobsOptions {
  realm: string;
  maxConcurrency: number;
  membersPageSize: number;
  maxRows: number;
  requiredActions: string[];
  emailVerified: boolean;
  retentionMinutes: number;
}

export interface CreateJobInput {
  fileName: string;
  mode?: ImportMode;
  /** Todas as linhas da planilha; as removidas na revisão chegam com `removed`. */
  rows: (RowInput & { removed?: boolean })[];
  /** Importação simples: grupos aplicados a todas as linhas. */
  groupIds?: string[];
  sourceJobId?: string;
}

export class ImportJobsService {
  private readonly logger = new Logger('Importação');
  private readonly jobs = new Map<string, ImportJob>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly processor: ImportProcessor;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly kc: KeycloakAdminClient,
    private readonly groups: GroupsService,
    private readonly audit: AuditLogService,
    private readonly options: ImportJobsOptions,
  ) {
    this.processor = new ImportProcessor(kc);
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  async create(input: CreateJobInput): Promise<ImportJob> {
    if (input.rows.length === 0) throw new BadRequestException('Nenhuma linha para importar.');
    if (input.rows.length > this.options.maxRows) {
      throw new BadRequestException(`Máximo de ${this.options.maxRows} linhas por importação.`);
    }
    const mode = input.mode ?? 'simples';
    const removed = normalizeRows(input.rows.filter((r) => r.removed)).map((r) => ({
      ...r,
      errors: ['Removida na revisão'],
    }));
    let rows = normalizeRows(
      input.rows.filter((r) => !r.removed),
      mode,
    );
    // Árvore sem cache: um grupo apagado depois da Revisão precisa virar INEXISTENTE, não falha de atribuição.
    if (mode === 'completa') rows = await checkRowGroups(this.groups, rows, true);
    const valid = rows.filter((r) => !r.errors.length);
    const ignored = [...removed, ...rows.filter((r) => r.errors.length)].sort((a, b) => a.line - b.line);
    if (valid.length === 0) {
      throw new BadRequestException({
        message: 'Nenhuma linha válida para importar. Corrija a planilha e envie novamente.',
        details: ignored.slice(0, 50).map((r) => ({ line: r.line, errors: r.errors })),
      });
    }

    let groups: GroupRef[];
    if (mode === 'simples') {
      const groupIds = [...new Set(input.groupIds ?? [])];
      if (groupIds.length === 0) throw new BadRequestException('Selecione ao menos um grupo.');
      const { found, missing } = await this.groups.resolve(groupIds);
      if (missing.length) {
        throw new BadRequestException(`Grupo(s) inexistente(s) no realm: ${missing.join(', ')}. Atualize a lista de grupos.`);
      }
      groups = found;
    } else {
      const union = new Map<string, GroupRef>();
      for (const row of valid) for (const g of rowGroupRefs(row)) union.set(g.id, g);
      groups = [...union.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    const job: ImportJob = {
      id: randomUUID(),
      mode,
      fileName: input.fileName || 'planilha.csv',
      sourceJobId: input.sourceJobId,
      realm: this.options.realm,
      createdAt: new Date(),
      status: 'PREPARANDO',
      prepared: false,
      groups,
      requiredActions: [...this.options.requiredActions],
      emailVerified: this.options.emailVerified,
      rows: valid.map((r) => ({
        line: r.line,
        uid: r.uid,
        username: r.username,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        ...(mode === 'completa' && {
          groups: rowGroupRefs(r),
          missingGroups: missingGroups(r),
          requestedGroups: r.groups,
        }),
      })),
      results: ignored.map(ignoredResult),
      ignored: ignored.length,
      pending: valid.map((_, i) => i),
      progress: new Map(),
      members: new Map(),
      control: { pauseRequested: false, cancelRequested: false, wafBlocked: false },
    };
    this.jobs.set(job.id, job);
    this.logger.log(
      `Job ${job.id} (${mode}) criado: ${job.rows.length} linha(s), ${job.ignored} ignorada(s), ` +
        `grupos ${job.groups.map((g) => g.path).join(', ')}`,
    );
    this.start(job);
    return job;
  }

  get(id: string): ImportJob {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Importação não encontrada (pode ter expirado ou o backend foi reiniciado).');
    return job;
  }

  pause(id: string): ImportJob {
    const job = this.get(id);
    if (job.status !== 'PREPARANDO' && job.status !== 'EXECUTANDO') {
      throw new ConflictException(`Não é possível pausar uma importação com status ${job.status}.`);
    }
    job.control.pauseRequested = true;
    return job;
  }

  resume(id: string): ImportJob {
    const job = this.get(id);
    if (job.status !== 'PAUSADO') {
      throw new ConflictException(`Só é possível retomar uma importação pausada (status atual: ${job.status}).`);
    }
    job.control = { pauseRequested: false, cancelRequested: false, wafBlocked: false };
    job.pauseReason = undefined;
    job.message = undefined;
    this.start(job);
    return job;
  }

  cancel(id: string): ImportJob {
    const job = this.get(id);
    if (FINAL_STATUSES.includes(job.status)) {
      throw new ConflictException(`A importação já foi finalizada (status ${job.status}).`);
    }
    if (job.status === 'PAUSADO') this.finishCancelled(job);
    else job.control.cancelRequested = true;
    return job;
  }

  async retryErrors(id: string): Promise<ImportJob> {
    const job = this.get(id);
    if (!FINAL_STATUSES.includes(job.status)) {
      throw new ConflictException('Aguarde a importação terminar para reprocessar os erros.');
    }
    const failedLines = new Set(
      job.results.filter((r) => r.status === 'ERRO' || r.status === 'NAO_PROCESSADO').map((r) => r.linha),
    );
    if (job.status === 'FALHOU') job.pending.forEach((i) => failedLines.add(job.rows[i].line));
    const rows = job.rows.filter((r) => failedLines.has(r.line));
    if (rows.length === 0) throw new BadRequestException('Não há linhas com erro para reprocessar.');
    return this.create({
      fileName: job.fileName,
      mode: job.mode,
      sourceJobId: job.id,
      ...(job.mode === 'simples' && { groupIds: job.groups.map((g) => g.id) }),
      rows: rows.map((r) => ({
        line: r.line,
        uid: r.uid,
        nome: [r.firstName, r.lastName].filter(Boolean).join(' '),
        email: r.email,
        ...(job.mode === 'completa' && { groups: r.requestedGroups }),
      })),
    });
  }

  /** Aguarda o processamento em andamento (usado em testes). */
  async idle(id: string): Promise<void> {
    await this.running.get(id);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private start(job: ImportJob): void {
    const run = this.run(job)
      .catch((err: unknown) => {
        job.status = 'FALHOU';
        job.message = errorMessage(err);
        this.logger.error(`Job ${job.id} falhou: ${job.message}`);
        return this.finish(job);
      })
      .finally(() => this.running.delete(job.id));
    this.running.set(job.id, run);
  }

  private async run(job: ImportJob): Promise<void> {
    if (!job.prepared) {
      job.status = 'PREPARANDO';
      try {
        for (const group of job.groups) {
          if (job.members.has(group.id)) continue;
          const members = await this.kc.listGroupMembers(group.id, this.options.membersPageSize);
          job.members.set(group.id, new Set(members.map((u) => u.username.toLowerCase())));
        }
        job.prepared = true;
      } catch (err) {
        if (!(err instanceof WafBlockedError)) throw err;
        this.setPaused(job, 'WAF', err.message);
        return;
      }
    }

    if (job.control.cancelRequested) return this.finishCancelled(job);
    if (job.control.pauseRequested) return this.setPaused(job, 'MANUAL');

    job.status = 'EXECUTANDO';
    job.startedAt ??= new Date();
    const workers = Math.max(1, Math.min(this.options.maxConcurrency, job.pending.length));
    await Promise.all(Array.from({ length: workers }, () => this.worker(job)));

    if (job.control.wafBlocked) return this.setPaused(job, 'WAF', job.message);
    if (job.control.cancelRequested) return this.finishCancelled(job);
    if (job.control.pauseRequested && job.pending.length) return this.setPaused(job, 'MANUAL');

    job.status = 'CONCLUIDO';
    await this.finish(job);
  }

  private async worker(job: ImportJob): Promise<void> {
    const { control } = job;
    while (!control.pauseRequested && !control.cancelRequested && !control.wafBlocked) {
      const index = job.pending.shift();
      if (index === undefined) return;
      try {
        job.results.push(await this.processor.processRow(job, index));
        job.progress.delete(index);
      } catch (err) {
        if (err instanceof WafBlockedError) {
          job.pending.unshift(index);
          control.wafBlocked = true;
          job.message = err.message;
          return;
        }
        job.results.push(this.processor.errorResult(job, index, err));
        job.progress.delete(index);
      }
    }
  }

  private setPaused(job: ImportJob, reason: 'WAF' | 'MANUAL', message?: string): void {
    job.status = 'PAUSADO';
    job.pauseReason = reason;
    job.message = message;
    this.logger.warn(`Job ${job.id} pausado (${reason})${message ? `: ${message}` : ''}`);
  }

  private finishCancelled(job: ImportJob): Promise<void> {
    for (const index of job.pending) job.results.push(this.processor.notProcessedResult(job, index));
    job.pending = [];
    job.progress.clear();
    job.status = 'CANCELADO';
    job.pauseReason = undefined;
    return this.finish(job);
  }

  private async finish(job: ImportJob): Promise<void> {
    job.finishedAt = new Date();
    this.logger.log(`Job ${job.id} finalizado com status ${job.status}.`);
    await this.audit.write(job);
  }

  private cleanup(): void {
    const limit = Date.now() - this.options.retentionMinutes * 60_000;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && job.finishedAt.getTime() < limit) this.jobs.delete(id);
    }
  }
}

function rowGroupRefs(row: NormalizedRow): GroupRef[] {
  return (row.groupChecks ?? []).flatMap((g) =>
    g.status === 'OK' && g.id ? [{ id: g.id, name: g.path.slice(g.path.lastIndexOf('/') + 1), path: g.path }] : [],
  );
}

function missingGroups(row: NormalizedRow): MissingGroup[] {
  return (row.groupChecks ?? []).flatMap((g) => (g.status === 'INEXISTENTE' ? [{ path: g.path, motivo: g.motivo ?? '' }] : []));
}

function ignoredResult(row: NormalizedRow): RowResult {
  return {
    linha: row.line,
    uid: row.uid,
    username: row.username,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: 'IGNORADO',
    usuarioCriado: false,
    acoesObrigatorias: [],
    grupos: missingGroups(row).map((m) => ({ id: m.path, path: m.path, status: 'INEXISTENTE', erro: m.motivo })),
    avisos: [],
    erro: row.errors.join('; '),
  };
}
