import { defineStore } from 'pinia'
import { api, apiErrorMessage } from '~/composables/useApi'
import type { HealthResponse } from '~/types/import'

export const useConnectionStore = defineStore('connection', () => {
  const health = ref<HealthResponse | null>(null)
  const healthLoading = ref(false)
  const healthError = ref('')

  async function loadHealth(refresh = false) {
    healthLoading.value = true
    healthError.value = ''
    try {
      health.value = await api<HealthResponse>('/health', { query: refresh ? { refresh: 'true' } : undefined })
    }
    catch (err) {
      health.value = null
      healthError.value = apiErrorMessage(err)
    }
    finally {
      healthLoading.value = false
    }
  }

  return { health, healthLoading, healthError, loadHealth }
})
