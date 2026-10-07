import type { ImportMode } from '../csv/csv-import.js';
import type { GroupRef } from '../groups/groups.service.js';
import type { KcUser } from '../keycloak/keycloak-admin.client.js';

export type JobStatus = 'PREPARANDO' | 'EXECUTANDO' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO' | 'FALHOU';
export type RowStatus = 'CRIADO' | 'GRUPOS_ADICIONADOS' | 'SEM_ALTERACAO' | 'ERRO' | 'NAO_PROCESSADO' | 'IGNORADO';
export type GroupStatus = 'ADICIONADO' | 'JA_POSSUIA' | 'FALHOU' | 'INEXISTENTE';
export type PauseReason = 'WAF' | 'MANUAL';

export const ROW_STATUSES: RowStatus[] = ['CRIADO', 'GRUPOS_ADICIONADOS', 'SEM_ALTERACAO', 'ERRO', 'NAO_PROCESSADO', 'IGNORADO'];
export const FINAL_STATUSES: JobStatus[] = ['CONCLUIDO', 'CANCELADO', 'FALHOU'];

export interface MissingGroup {
  path: string;
  motivo: string;
}

export interface ImportRow {
  line: number;
  uid: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Importação completa: grupos válidos da linha; na simples, valem os grupos do job. */
  groups?: GroupRef[];
  missingGroups?: MissingGroup[];
  /** Importação completa: paths pedidos na planilha, reenviados no reprocessamento. */
  requestedGroups?: string[];
}

export interface GroupResult {
  id: string;
  path: string;
  status: GroupStatus;
  erro?: string;
}

export interface RowResult {
  linha: number;
  uid: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  status: RowStatus;
  usuarioCriado: boolean;
  acoesObrigatorias: string[];
  grupos: GroupResult[];
  avisos: string[];
  erro?: string;
}

/** Estado parcial de uma linha, preservado se o job pausar no meio dela. */
export interface RowProgress {
  userId?: string;
  created: boolean;
  existing?: KcUser;
  groups: Map<string, GroupResult>;
}

export interface ImportJob {
  id: string;
  mode: ImportMode;
  fileName: string;
  sourceJobId?: string;
  realm: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  status: JobStatus;
  pauseReason?: PauseReason;
  message?: string;
  prepared: boolean;
  groups: GroupRef[];
  requiredActions: string[];
  emailVerified: boolean;
  rows: ImportRow[];
  /** Começa com as linhas IGNORADO; as processadas são acrescentadas depois delas. */
  results: RowResult[];
  ignored: number;
  pending: number[];
  progress: Map<number, RowProgress>;
  members: Map<string, Set<string>>;
  control: { pauseRequested: boolean; cancelRequested: boolean; wafBlocked: boolean };
}

export interface JobView {
  id: string;
  mode: ImportMode;
  fileName: string;
  sourceJobId?: string;
  realm: string;
  status: JobStatus;
  pauseReason?: PauseReason;
  message?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  total: number;
  processed: number;
  counts: Record<RowStatus, number>;
  groups: GroupRef[];
  requiredActions: string[];
  results: RowResult[];
  nextSince: number;
}
