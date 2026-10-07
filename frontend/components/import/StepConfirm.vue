<script setup lang="ts">
import { useImportStore } from '~/stores/import'
import { formatDuration, requiredActionLabels } from '~/utils/importLabels'

const store = useImportStore()
const ASSUMED_LATENCY_MS = 200

onMounted(() => store.loadHealth(true))

const settings = computed(() => store.health?.settings)
const connected = computed(() => store.health?.status === 'ok')

const requiredActions = computed(() => settings.value?.newUserRequiredActions ?? [])

const full = store.mode === 'completa'
const groupCount = computed(() => (full ? store.rowGroups.length : store.selectedGroups.length))

const estimate = computed(() => {
  if (!settings.value)
    return null
  const users = store.validRows.length

  const assignments = full
    ? store.rowGroups.reduce((sum, g) => sum + g.count, 0)
    : users * store.selectedGroups.length

  const perRequest = Math.max(settings.value.minIntervalMs, ASSUMED_LATENCY_MS / settings.value.maxConcurrency)
  const prefetch = groupCount.value
  const min = (prefetch + users) * perRequest
  const max = (prefetch + users * 2 + assignments) * perRequest

  return { min: formatDuration(min), max: formatDuration(max) }
})
</script>

<template>
  <VCard>
    <VCardText>
      <p class="text-body-1 mb-6">
        Confira o resumo. A importação só começa quando você clicar em <strong>Importar</strong>.
      </p>

      <VRow>
        <VCol
          cols="12"
          md="6"
        >
          <VList
            lines="two"
            class="border rounded"
          >
            <VListItem
              prepend-icon="ri-user-add-line"
              title="Usuários a processar"
              :subtitle="`${store.validRows.length} linha(s) válida(s) de ${store.preview?.fileName ?? ''}`"
            />
            <VListItem
              v-if="store.invalidRows.length || store.removedLines.length"
              prepend-icon="ri-forbid-line"
              title="Linhas ignoradas"
              :subtitle="`${store.invalidRows.length} inválida(s) e ${store.removedLines.length} removida(s) manualmente`"
            />
            <VListItem
              prepend-icon="ri-server-line"
              title="Realm de destino"
              :subtitle="store.health ? `${store.health.realm} — ${store.health.keycloakUrl}` : 'desconhecido'"
            />
            <VListItem
              prepend-icon="ri-time-line"
              title="Tempo estimado"
              :subtitle="estimate ? `entre ${estimate.min} e ${estimate.max}, conforme quantos usuários já existirem` : '—'"
            />
          </VList>
        </VCol>
        <VCol
          cols="12"
          md="6"
        >
          <div class="border rounded pa-4 h-100">
            <h3 class="text-subtitle-1 font-weight-medium mb-3">
              Grupos que serão atribuídos ({{ groupCount }})
            </h3>
            <div
              v-if="full"
              class="d-flex flex-wrap gap-2"
            >
              <VChip
                v-for="group in store.rowGroups"
                :key="group.path"
                label
                color="primary"
                prepend-icon="ri-group-line"
              >
                {{ group.path }} · {{ group.count }} usuário(s)
              </VChip>
            </div>
            <div
              v-else
              class="d-flex flex-wrap gap-2"
            >
              <VChip
                v-for="group in store.selectedGroups"
                :key="group.id"
                label
                color="primary"
                prepend-icon="ri-group-line"
              >
                {{ group.path }}
              </VChip>
            </div>
            <template v-if="full && store.missingGroups.length">
              <h3 class="text-subtitle-1 font-weight-medium mt-5 mb-3">
                Grupos inexistentes, não serão atribuídos ({{ store.missingGroups.length }})
              </h3>
              <div class="d-flex flex-wrap gap-2">
                <VChip
                  v-for="group in store.missingGroups"
                  :key="group.path"
                  label
                  color="warning"
                  prepend-icon="ri-question-line"
                >
                  {{ group.path }} · {{ group.count }} linha(s)
                </VChip>
              </div>
            </template>
          </div>
        </VCol>
      </VRow>

      <VAlert
        type="info"
        variant="tonal"
        class="mt-6"
        title="O que vai acontecer"
      >
        <ul class="ps-4">
          <li>
            <strong>Usuários novos</strong> serão criados sem senha e receberão os grupos{{ full ? ' da própria linha' : '' }}.
          </li>
          <li v-if="requiredActions.length">
            Usuários novos deverão {{ requiredActions.map(a => requiredActionLabels[a] ?? a).join(' e ') }} no próximo login<template v-if="requiredActions.includes('UPDATE_PROFILE')">
              , pois a divisão do NOME em nome e sobrenome foi feita automaticamente
            </template>.
          </li>
          <li><strong>Usuários existentes</strong> receberão apenas os grupos que ainda não possuem; nenhum outro dado será alterado.</li>
          <li>Quem já possuir todos os grupos ficará como "Sem alteração".</li>
          <li v-if="full">
            Nenhum grupo é removido. Grupos inexistentes ficam registrados no resultado e no relatório.
          </li>
        </ul>
      </VAlert>

      <VAlert
        v-if="!connected && !store.healthLoading"
        type="error"
        variant="tonal"
        class="mt-4"
        role="alert"
        title="Não foi possível conectar ao RH-SSO"
      >
        {{ store.health?.error?.message ?? store.healthError }}
        <template #append>
          <VBtn
            variant="text"
            @click="store.loadHealth(true)"
          >
            Tentar novamente
          </VBtn>
        </template>
      </VAlert>

      <VAlert
        v-if="store.jobError"
        type="error"
        variant="tonal"
        class="mt-4"
        role="alert"
      >
        {{ store.jobError }}
      </VAlert>
    </VCardText>

    <VCardActions class="justify-space-between pa-4">
      <VBtn
        variant="outlined"
        color="secondary"
        prepend-icon="ri-arrow-left-line"
        @click="store.back()"
      >
        {{ full ? 'Voltar à revisão' : 'Voltar aos grupos' }}
      </VBtn>
      <VBtn
        variant="elevated"
        size="large"
        prepend-icon="ri-upload-cloud-2-line"
        :loading="store.actionLoading || store.healthLoading"
        :disabled="!connected || !store.validRows.length || !groupCount"
        @click="store.startImport()"
      >
        Importar {{ store.validRows.length }} usuário(s)
      </VBtn>
    </VCardActions>
  </VCard>
</template>
