import { UserAlreadyExistsError, WafBlockedError, errorMessage } from '../keycloak/errors.js';
import type { KcUser, KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';
import type { GroupResult, ImportJob, ImportRow, RowProgress, RowResult, RowStatus } from './import.types.js';

/**
 * Processa uma linha: cria o usuário se não existir (com as ações obrigatórias)
 * e atribui apenas os grupos que ele ainda não possui. WafBlockedError é
 * propagado para que o job pause sem marcar a linha como erro.
 */
export class ImportProcessor {
  constructor(private readonly kc: KeycloakAdminClient) {}

  async processRow(job: ImportJob, index: number): Promise<RowResult> {
    const row = job.rows[index];
    const progress = this.progressOf(job, index);

    if (!progress.userId) {
      let existing = await this.kc.findUserByUsername(row.username);
      if (!existing) {
        try {
          progress.userId = await this.kc.createUser({
            username: row.username,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            emailVerified: job.emailVerified,
            requiredActions: job.requiredActions,
          });
          progress.created = true;
        } catch (err) {
          if (!(err instanceof UserAlreadyExistsError)) throw err;
          existing = await this.kc.findUserByUsername(row.username);
          if (!existing) {
            throw new Error('O RH-SSO informou que o usuário já existe (409), mas ele não foi encontrado pela busca por username.');
          }
        }
      }
      if (existing) {
        progress.userId = existing.id;
        progress.existing = existing;
      }
    }

    const rowGroups = row.groups ?? job.groups;
    for (const group of rowGroups) {
      if (progress.groups.has(group.id)) continue;
      if (!progress.created && job.members.get(group.id)?.has(row.username)) {
        progress.groups.set(group.id, { id: group.id, path: group.path, status: 'JA_POSSUIA' });
        continue;
      }
      try {
        await this.kc.addUserToGroup(progress.userId!, group.id);
        progress.groups.set(group.id, { id: group.id, path: group.path, status: 'ADICIONADO' });
      } catch (err) {
        if (err instanceof WafBlockedError) throw err;
        progress.groups.set(group.id, { id: group.id, path: group.path, status: 'FALHOU', erro: errorMessage(err) });
      }
    }

    const grupos = rowGroups.map((g) => progress.groups.get(g.id)!);
    const failed = grupos.filter((g) => g.status === 'FALHOU').length;
    let status: RowStatus;
    if (failed) status = 'ERRO';
    else if (progress.created) status = 'CRIADO';
    else if (grupos.some((g) => g.status === 'ADICIONADO')) status = 'GRUPOS_ADICIONADOS';
    else status = 'SEM_ALTERACAO';

    return {
      ...this.base(job, row, progress),
      status,
      grupos: [...grupos, ...missingResults(row)],
      avisos: [
        ...(row.missingGroups ?? []).map((m) => `Grupo ${m.path} não foi atribuído: ${m.motivo}.`),
        ...(progress.existing ? divergences(row, progress.existing) : []),
      ],
      erro: failed
        ? `Falha ao atribuir ${failed} grupo(s)${progress.created ? '; o usuário foi criado' : ''}.`
        : undefined,
    };
  }

  errorResult(job: ImportJob, index: number, err: unknown): RowResult {
    const row = job.rows[index];
    const progress = this.progressOf(job, index);
    return {
      ...this.base(job, row, progress),
      status: 'ERRO',
      grupos: [...progress.groups.values(), ...missingResults(row)],
      avisos: [],
      erro: errorMessage(err),
    };
  }

  notProcessedResult(job: ImportJob, index: number): RowResult {
    const row = job.rows[index];
    return {
      ...this.base(job, row, { created: false, groups: new Map() }),
      status: 'NAO_PROCESSADO',
      grupos: [],
      avisos: [],
      erro: 'Importação cancelada antes de processar esta linha.',
    };
  }

  private progressOf(job: ImportJob, index: number): RowProgress {
    let progress = job.progress.get(index);
    if (!progress) {
      progress = { created: false, groups: new Map<string, GroupResult>() };
      job.progress.set(index, progress);
    }
    return progress;
  }

  private base(job: ImportJob, row: ImportRow, progress: RowProgress) {
    return {
      linha: row.line,
      uid: row.uid,
      username: row.username,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      usuarioCriado: progress.created,
      acoesObrigatorias: progress.created ? [...job.requiredActions] : [],
    };
  }
}

function missingResults(row: ImportRow): GroupResult[] {
  return (row.missingGroups ?? []).map((m) => ({ id: m.path, path: m.path, status: 'INEXISTENTE', erro: m.motivo }));
}

function divergences(row: ImportRow, user: KcUser): string[] {
  const avisos: string[] = [];
  if ((user.email ?? '').toLowerCase() !== row.email.toLowerCase()) {
    avisos.push(`E-mail no RH-SSO (${user.email || 'vazio'}) difere da planilha (${row.email}); não foi alterado.`);
  }
  const kcName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const csvName = [row.firstName, row.lastName].filter(Boolean).join(' ');
  if (kcName.toLowerCase() !== csvName.toLowerCase()) {
    avisos.push(`Nome no RH-SSO (${kcName || 'vazio'}) difere da planilha (${csvName}); não foi alterado.`);
  }
  return avisos;
}
