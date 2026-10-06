export type JobStatus = 'PREPARANDO' | 'EXECUTANDO' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO' | 'FALHOU'
export type RowStatus = 'CRIADO' | 'GRUPOS_ADICIONADOS' | 'SEM_ALTERACAO' | 'ERRO' | 'NAO_PROCESSADO'
export type GroupStatus = 'ADICIONADO' | 'JA_POSSUIA' | 'FALHOU'

export interface HealthResponse {
  status: 'ok' | 'erro'
  realm: string
  keycloakUrl: string
  checkedAt: string
  error?: { type: string; message: string }
  settings: {
    maxConcurrency: number
    minIntervalMs: number
    newUserRequiredActions: string[]
    uploadMaxBytes: number
    uploadMaxRows: number
  }
}

export interface PreviewRow {
  line: number
  uid: string
  nome: string
  email: string
  username: string
  firstName: string
  lastName: string
  errors: string[]
}

export interface PreviewResult {
  fileName: string
  encoding: string
  delimiter: string
  total: number
  validCount: number
  invalidCount: number
  rows: PreviewRow[]
}

export interface GroupNode {
  id: string
  name: string
  path: string
  subGroups: GroupNode[]
}

export interface GroupRef {
  id: string
  name: string
  path: string
}

export interface GroupResult {
  id: string
  path: string
  status: GroupStatus
  erro?: string
}

export interface RowResult {
  linha: number
  uid: string
  username: string
  email: string
  firstName: string
  lastName: string
  status: RowStatus
  usuarioCriado: boolean
  acoesObrigatorias: string[]
  grupos: GroupResult[]
  avisos: string[]
  erro?: string
}

export interface JobView {
  id: string
  fileName: string
  sourceJobId?: string
  realm: string
  status: JobStatus
  pauseReason?: 'WAF' | 'MANUAL'
  message?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  total: number
  processed: number
  counts: Record<RowStatus, number>
  groups: GroupRef[]
  requiredActions: string[]
  results: RowResult[]
  nextSince: number
}
