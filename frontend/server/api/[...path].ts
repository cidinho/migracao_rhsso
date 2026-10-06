export default defineEventHandler(event => {
  const { backendUrl } = useRuntimeConfig(event)
  const target = new URL(event.path, backendUrl).toString()

  return proxyRequest(event, target).catch(() => {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      data: { message: `Não foi possível conectar ao backend em ${backendUrl}. Verifique se ele está em execução e a variável NUXT_BACKEND_URL.` },
    })
  })
})
