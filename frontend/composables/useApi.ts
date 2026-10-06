import { FetchError } from 'ofetch'

export function apiErrorMessage(err: unknown): string {
  if (err instanceof FetchError) {
    const data = err.data as { message?: string | string[] } | undefined
    const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message
    if (message)
      return message
    if (err.statusCode === 502 || err.statusCode === 504)
      return 'Não foi possível conectar ao backend. Verifique se ele está em execução.'
    if (!err.statusCode)
      return 'Sem resposta do servidor. Verifique sua conexão.'

    return `Erro ${err.statusCode}: ${err.statusMessage ?? err.message}`
  }

  return err instanceof Error ? err.message : String(err)
}

export const api = $fetch.create({ baseURL: '/api' })
