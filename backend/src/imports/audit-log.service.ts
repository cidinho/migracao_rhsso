import { Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ImportJob } from './import.types.js';
import { countByStatus } from './job-view.js';

export class AuditLogService {
  private readonly logger = new Logger('Auditoria');
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async write(job: ImportJob): Promise<void> {
    const entry = {
      event: 'import_job_finished',
      jobId: job.id,
      sourceJobId: job.sourceJobId,
      mode: job.mode,
      fileName: job.fileName,
      realm: job.realm,
      status: job.status,
      message: job.message,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      finishedAt: job.finishedAt?.toISOString(),
      groups: job.groups.map((g) => g.path),
      requiredActions: job.requiredActions,
      total: job.rows.length,
      counts: countByStatus(job.results),
      results: [...job.results].sort((a, b) => a.linha - b.linha),
    };
    const month = (job.finishedAt ?? new Date()).toISOString().slice(0, 7);
    const file = join(this.dir, `importacoes-${month}.jsonl`);
    try {
      await mkdir(this.dir, { recursive: true });
      await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      this.logger.error(`Falha ao gravar o log de auditoria em ${file}: ${String(err)}`);
    }
  }
}
