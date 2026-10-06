<script setup lang="ts">
import { useImportStore } from '~/stores/import'

const store = useImportStore()

onMounted(() => {
  if (!store.health)
    store.loadHealth()
})

const state = computed(() => {
  if (!store.health && (store.healthLoading || !store.healthError))
    return { color: 'secondary', icon: 'ri-loader-4-line', text: 'Verificando conexão…' }
  if (store.health?.status === 'ok')
    return { color: 'success', icon: 'ri-shield-check-line', text: `Realm ${store.health.realm}` }
  if (store.health)
    return { color: 'error', icon: 'ri-error-warning-line', text: `Realm ${store.health.realm}: sem conexão` }

  return { color: 'error', icon: 'ri-error-warning-line', text: 'Backend indisponível' }
})

const detail = computed(() => {
  if (store.health?.status === 'ok')
    return `Conectado a ${store.health.keycloakUrl}`

  return store.health?.error?.message ?? store.healthError ?? ''
})
</script>

<template>
  <VChip
    :color="state.color"
    variant="tonal"
    label
    :prepend-icon="state.icon"
    role="button"
    :aria-label="`${state.text}. ${detail} Clique para verificar novamente.`"
    @click="store.loadHealth(true)"
  >
    <span class="d-none d-sm-inline">{{ state.text }}</span>
    <VTooltip
      activator="parent"
      location="bottom"
      max-width="420"
    >
      {{ detail }}<br>
      <small>Clique para verificar novamente.</small>
    </VTooltip>
  </VChip>
</template>
