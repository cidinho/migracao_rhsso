import type { GroupStatus, JobStatus, RowStatus } from '~/types/import'

interface Label { text: string; icon: string; color: string }

export const rowStatusLabels: Record<RowStatus, Label & { description: string }> = {
  CRIADO: {
    text: 'Criado',
    icon: 'ri-user-add-line',
    color: 'success',
    description: 'Usuário criado e grupos atribuídos.',
  },
  GRUPOS_ADICIONADOS: {
    text: 'Grupos adicionados',
    icon: 'ri-group-line',
    color: 'info',
    description: 'Usuário já existia e recebeu os grupos que faltavam.',
  },
  SEM_ALTERACAO: {
    text: 'Sem alteração',
    icon: 'ri-checkbox-circle-line',
    color: 'secondary',
    description: 'Usuário já existia e já possuía os grupos válidos.',
  },
  ERRO: {
    text: 'Erro',
    icon: 'ri-error-warning-line',
    color: 'error',
    description: 'Falha ao processar a linha.',
  },
  NAO_PROCESSADO: {
    text: 'Não processado',
    icon: 'ri-indeterminate-circle-line',
    color: 'warning',
    description: 'Importação cancelada antes desta linha.',
  },
  IGNORADO: {
    text: 'Ignorado',
    icon: 'ri-forbid-line',
    color: 'default',
    description: 'Linha inválida ou removida na revisão; não foi importada.',
  },
}

export const groupStatusLabels: Record<GroupStatus, Label> = {
  ADICIONADO: { text: 'Adicionado', icon: 'ri-add-circle-line', color: 'success' },
  JA_POSSUIA: { text: 'Já possuía', icon: 'ri-check-line', color: 'secondary' },
  FALHOU: { text: 'Falhou', icon: 'ri-close-circle-line', color: 'error' },
  INEXISTENTE: { text: 'Inexistente', icon: 'ri-question-line', color: 'warning' },
}

export const jobStatusLabels: Record<JobStatus, Label> = {
  PREPARANDO: { text: 'Preparando', icon: 'ri-loader-4-line', color: 'info' },
  EXECUTANDO: { text: 'Em execução', icon: 'ri-play-circle-line', color: 'primary' },
  PAUSADO: { text: 'Pausada', icon: 'ri-pause-circle-line', color: 'warning' },
  CONCLUIDO: { text: 'Concluída', icon: 'ri-checkbox-circle-line', color: 'success' },
  CANCELADO: { text: 'Cancelada', icon: 'ri-close-circle-line', color: 'warning' },
  FALHOU: { text: 'Falhou', icon: 'ri-error-warning-line', color: 'error' },
}

export const requiredActionLabels: Record<string, string> = {
  UPDATE_PROFILE: 'atualizar o perfil (nome e sobrenome)',
  UPDATE_PASSWORD: 'definir uma nova senha',
  VERIFY_EMAIL: 'verificar o e-mail',
  CONFIGURE_TOTP: 'configurar o autenticador (OTP)',
  terms_and_conditions: 'aceitar os termos e condições',
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours)
    return `${hours} h ${minutes} min`
  if (minutes)
    return seconds && minutes < 10 ? `${minutes} min ${seconds} s` : `${minutes} min`

  return `${seconds} s`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  if (bytes >= 1024)
    return `${Math.round(bytes / 1024)} KB`

  return `${bytes} bytes`
}
