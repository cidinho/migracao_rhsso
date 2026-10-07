export type JobStatus = 'PREPARANDO' | 'EXECUTANDO' | 'PAUSADO' | 'CONCLUIDO' | 'CANCELADO' | 'FALHOU'
export type RowStatus = 'CRIADO' | 'GRUPOS_ADICIONADOS' | 'SEM_ALTERACAO' | 'ERRO' | 'NAO_PROCESSADO' | 'IGNORADO'
export type GroupStatus = 'ADICIONADO' | 'JA_POSSUIA' | 'FALHOU' | 'INEXISTENTE'
export type ImportMode = 'simples' | 'completa'
export type StepName = 'upload' | 'review' | 'groups' | 'confirm' | 'result'

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
  groups?: string[]
  groupChecks?: PreviewGroup[]
}

export interface PreviewGroup {
  path: string
  status: 'OK' | 'INEXISTENTE'
  id?: string
  motivo?: string
}

export interface PreviewResult {
  fileName: string
  mode: ImportMode
  encoding: string
  delimiter: string
  groupColumns: string[]
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
  mode: ImportMode
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
