import type { GroupRef } from '../groups/groups.service.js';
import type { KcUser } from '../keycloak/keycloak-admin.client.js';

export type JobStatus = 'PREPARANDO' | 'EXECUTANDO' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO' | 'FALHOU';
export type RowStatus = 'CRIADO' | 'GRUPOS_ADICIONADOS' | 'SEM_ALTERACAO' | 'ERRO' | 'NAO_PROCESSADO';
export type GroupStatus = 'ADICIONADO' | 'JA_POSSUIA' | 'FALHOU';
export type PauseReason = 'WAF' | 'MANUAL';

export const ROW_STATUSES: RowStatus[] = ['CRIADO', 'GRUPOS_ADICIONADOS', 'SEM_ALTERACAO', 'ERRO', 'NAO_PROCESSADO'];
export const FINAL_STATUSES: JobStatus[] = ['CONCLUIDO', 'CANCELADO', 'FALHOU'];

export interface ImportRow {
  line: number;
  uid: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
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
  results: RowResult[];
  pending: number[];
  progress: Map<number, RowProgress>;
  members: Map<string, Set<string>>;
  control: { pauseRequested: boolean; cancelRequested: boolean; wafBlocked: boolean };
}

export interface JobView {
  id: string;
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
