import { stringify } from 'csv-stringify/sync';
import { ROW_STATUSES, type ImportJob, type JobView, type RowResult, type RowStatus } from './import.types.js';

export function countByStatus(results: RowResult[]): Record<RowStatus, number> {
  const counts = Object.fromEntries(ROW_STATUSES.map((s) => [s, 0])) as Record<RowStatus, number>;
  for (const r of results) counts[r.status]++;
  return counts;
}

export function toView(job: ImportJob, since = 0): JobView {
  const from = Math.max(0, Math.min(since, job.results.length));
  return {
    id: job.id,
    mode: job.mode,
    fileName: job.fileName,
    sourceJobId: job.sourceJobId,
    realm: job.realm,
    status: job.status,
    pauseReason: job.pauseReason,
    message: job.message,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    finishedAt: job.finishedAt?.toISOString(),
    total: job.rows.length,
    processed: job.results.length - job.ignored,
    counts: countByStatus(job.results),
    groups: job.groups,
    requiredActions: job.requiredActions,
    results: job.results.slice(from),
    nextSince: job.results.length,
  };
}

export function toReportCsv(job: ImportJob): string {
  const pathsWith = (r: RowResult, status: string) =>
    r.grupos.filter((g) => g.status === status).map((g) => g.path).join(' | ');
  const pathsWithReason = (r: RowResult, status: string) =>
    r.grupos
      .filter((g) => g.status === status)
      .map((g) => `${g.path}: ${g.erro ?? ''}`)
      .join(' | ');
  const rows = [...job.results]
    .sort((a, b) => a.linha - b.linha)
    .map((r) => [
      r.linha,
      r.uid,
      r.username,
      r.firstName,
      r.lastName,
      r.email,
      r.status,
      r.acoesObrigatorias.join(' | '),
      pathsWith(r, 'ADICIONADO'),
      pathsWith(r, 'JA_POSSUIA'),
      pathsWithReason(r, 'FALHOU'),
      pathsWithReason(r, 'INEXISTENTE'),
      r.avisos.join(' | '),
      r.erro ?? '',
    ]);
  return (
    '\uFEFF' +
    stringify(rows, {
      delimiter: ';',
      record_delimiter: '\r\n',
      header: true,
      columns: [
        'Linha',
        'UID',
        'Username',
        'Nome',
        'Sobrenome',
        'Email',
        'Status',
        'Ações obrigatórias',
        'Grupos adicionados',
        'Grupos que já possuía',
        'Grupos com falha',
        'Grupos inexistentes',
        'Avisos',
        'Mensagem',
      ],
    })
  );
}
