<script setup lang="ts">
import { useImportStore } from '~/stores/import'
import type { RowResult, RowStatus } from '~/types/import'
import { groupStatusLabels, jobStatusLabels, requiredActionLabels, rowStatusLabels } from '~/utils/importLabels'

const store = useImportStore()
const filter = ref<RowStatus | null>(null)
const search = ref('')
const expanded = ref<number[]>([])
const confirmCancel = ref(false)
const announcement = ref('')

const job = computed(() => store.job)
const running = computed(() => !!job.value && ['PREPARANDO', 'EXECUTANDO'].includes(job.value.status))
const paused = computed(() => job.value?.status === 'PAUSADO')
const percent = computed(() => (job.value?.total ? Math.round((job.value.processed / job.value.total) * 100) : 0))
const errorsToRetry = computed(() => (job.value ? job.value.counts.ERRO + job.value.counts.NAO_PROCESSADO : 0))

const cards = computed(() => {
  const statuses: RowStatus[] = ['CRIADO', 'GRUPOS_ADICIONADOS', 'SEM_ALTERACAO', 'ERRO']
  if (job.value?.counts.NAO_PROCESSADO)
    statuses.push('NAO_PROCESSADO')

  return statuses.map(status => ({ status, count: job.value?.counts[status] ?? 0, ...rowStatusLabels[status] }))
})

const items = computed(() => {
  const list = filter.value ? store.results.filter(r => r.status === filter.value) : store.results

  return [...list].sort((a, b) => a.linha - b.linha)
})

const headers = [
  { title: 'Linha', key: 'linha', width: 80 },
  { title: 'Login', key: 'username' },
  { title: 'Nome', key: 'nome', value: (r: RowResult) => [r.firstName, r.lastName].filter(Boolean).join(' ') },
  { title: 'Resultado', key: 'status' },
  { title: 'Grupos', key: 'grupos', sortable: false },
  { title: '', key: 'data-table-expand', sortable: false, width: 56 },
]

watch(() => job.value?.id, () => {
  filter.value = null
  expanded.value = []
})

let lastDecile = -1
watch(() => [job.value?.status, percent.value] as const, ([status, pct], previous) => {
  if (!status)
    return
  const decile = Math.floor((pct ?? 0) / 10)
  if (status !== previous?.[0]) {
    announcement.value = `Importação ${jobStatusLabels[status].text.toLowerCase()}. ${job.value?.processed} de ${job.value?.total} linhas processadas.`
    lastDecile = decile
  }
  else if (decile !== lastDecile) {
    lastDecile = decile
    announcement.value = `${pct}% concluído: ${job.value?.processed} de ${job.value?.total} linhas.`
  }
}, { immediate: true })

function toggleFilter(status: RowStatus) {
  filter.value = filter.value === status ? null : status
}

function groupSummary(row: RowResult) {
  const count = (s: string) => row.grupos.filter(g => g.status === s).length
  const parts = []
  if (count('ADICIONADO'))
    parts.push(`${count('ADICIONADO')} adicionado(s)`)
  if (count('JA_POSSUIA'))
    parts.push(`${count('JA_POSSUIA')} já possuía`)
  if (count('FALHOU'))
    parts.push(`${count('FALHOU')} com falha`)

  return parts.join(' · ') || '—'
}

function resultDescription(row: RowResult) {
  if (row.status === 'SEM_ALTERACAO')
    return 'Usuário já existia e já possuía o(s) grupo(s).'
  if (row.status === 'CRIADO' && row.acoesObrigatorias.includes('UPDATE_PROFILE'))
    return 'Usuário criado; deverá atualizar o perfil no próximo login.'
  if (row.erro)
    return row.erro

  return rowStatusLabels[row.status].description
}

async function cancel() {
  confirmCancel.value = false
  await store.control('cancel')
}

function newImport() {
  store.reset()
}
</script>

<template>
  <div v-if="job">
    <div
      class="visually-hidden"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcement }}
    </div>

    <VCard class="mb-6">
      <VCardText>
        <div class="d-flex flex-wrap align-center gap-3 mb-4">
          <VChip
            :color="jobStatusLabels[job.status].color"
            :prepend-icon="jobStatusLabels[job.status].icon"
            label
            size="large"
          >
            {{ jobStatusLabels[job.status].text }}
          </VChip>
          <span class="text-body-1">{{ job.fileName }}</span>
          <VChip
            v-if="job.sourceJobId"
            size="small"
            variant="outlined"
            label
          >
            Reprocessamento de erros
          </VChip>
          <VSpacer />
          <div class="d-flex gap-2">
            <VBtn
              v-if="running"
              variant="tonal"
              color="warning"
              prepend-icon="ri-pause-line"
              :loading="store.actionLoading"
              @click="store.control('pause')"
            >
              Pausar
            </VBtn>
            <VBtn
              v-if="paused"
              prepend-icon="ri-play-line"
              :loading="store.actionLoading"
              @click="store.control('resume')"
            >
              Retomar
            </VBtn>
            <VBtn
              v-if="running || paused"
              variant="outlined"
              color="error"
              prepend-icon="ri-stop-line"
              @click="confirmCancel = true"
            >
              Cancelar
            </VBtn>
          </div>
        </div>

        <VProgressLinear
          :model-value="percent"
          :indeterminate="job.status === 'PREPARANDO'"
          :color="jobStatusLabels[job.status].color"
          height="12"
          rounded
          :aria-label="`Progresso da importação: ${percent}%`"
        />
        <div class="d-flex justify-space-between text-body-2 mt-2">
          <span v-if="job.status === 'PREPARANDO'">Consultando os membros atuais dos grupos…</span>
          <span v-else>{{ job.processed }} de {{ job.total }} linhas processadas</span>
          <span>{{ percent }}%</span>
        </div>

        <VAlert
          v-if="paused && job.pauseReason === 'WAF'"
          type="warning"
          variant="tonal"
          class="mt-4"
          title="Importação pausada: bloqueio do WAF"
          role="alert"
        >
          O firewall de aplicação bloqueou uma requisição ao RH-SSO. Nenhuma linha foi perdida: a linha em andamento
          continua pendente. Aguarde alguns minutos e clique em <strong>Retomar</strong>. Se o bloqueio se repetir, reduza
          a taxa de requisições (variáveis <code>KC_MIN_INTERVAL_MS</code> e <code>KC_MAX_CONCURRENCY</code> do backend).
        </VAlert>
        <VAlert
          v-else-if="paused"
          type="info"
          variant="tonal"
          class="mt-4"
        >
          Importação pausada. Clique em <strong>Retomar</strong> para continuar de onde parou.
        </VAlert>
        <VAlert
          v-if="job.status === 'FALHOU'"
          type="error"
          variant="tonal"
          class="mt-4"
          title="A importação foi interrompida"
          role="alert"
        >
          {{ job.message }}
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
    </VCard>

    <VRow class="mb-2">
      <VCol
        v-for="card in cards"
        :key="card.status"
        cols="12"
        sm="6"
        :md="cards.length > 4 ? undefined : 3"
      >
        <VCard
          :color="card.color"
          :variant="filter === card.status ? 'flat' : 'tonal'"
          :aria-pressed="filter === card.status"
          :aria-label="`${card.text}: ${card.count}. ${filter === card.status ? 'Remover filtro' : 'Filtrar tabela'}`"
          class="h-100 status-card"
          role="button"
          tabindex="0"
          @click="toggleFilter(card.status)"
          @keydown.enter.prevent="toggleFilter(card.status)"
          @keydown.space.prevent="toggleFilter(card.status)"
        >
          <VCardText class="d-flex align-center gap-3">
            <VIcon
              :icon="card.icon"
              size="32"
            />
            <div>
              <div class="text-h4">
                {{ card.count }}
              </div>
              <div>{{ card.text }}</div>
            </div>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VCard>
      <VCardText>
        <div class="d-flex flex-wrap align-center gap-3 mb-4">
          <VTextField
            v-model="search"
            label="Buscar por login, nome ou e-mail"
            prepend-inner-icon="ri-search-line"
            clearable
            style="max-inline-size: 360px;"
          />
          <VChip
            v-if="filter"
            closable
            label
            :color="rowStatusLabels[filter].color"
            :close-label="`Remover filtro ${rowStatusLabels[filter].text}`"
            @click:close="filter = null"
          >
            Filtro: {{ rowStatusLabels[filter].text }}
          </VChip>
          <VSpacer />
          <VBtn
            variant="tonal"
            prepend-icon="ri-download-2-line"
            :href="`/api/imports/${job.id}/report.csv`"
            :disabled="!store.results.length"
            download
          >
            Baixar relatório
          </VBtn>
          <VBtn
            v-if="store.finished && errorsToRetry"
            color="warning"
            prepend-icon="ri-restart-line"
            :loading="store.actionLoading"
            @click="store.retryErrors()"
          >
            Reprocessar {{ errorsToRetry }} erro(s)
          </VBtn>
          <VBtn
            v-if="store.finished"
            variant="outlined"
            prepend-icon="ri-add-line"
            @click="newImport"
          >
            Nova importação
          </VBtn>
        </div>

        <VDataTable
          v-model:expanded="expanded"
          :headers="headers"
          :items="items"
          :search="search"
          :items-per-page="25"
          item-value="linha"
          show-expand
          density="comfortable"
          class="border rounded"
          :no-data-text="filter ? 'Nenhuma linha com este resultado.' : 'Nenhum resultado ainda.'"
          items-per-page-text="Linhas por página"
          page-text="{0}-{1} de {2}"
        >
          <template #item.status="{ item }">
            <div class="py-2">
              <VChip
                :color="rowStatusLabels[item.status].color"
                :prepend-icon="rowStatusLabels[item.status].icon"
                size="small"
                label
              >
                {{ rowStatusLabels[item.status].text }}
              </VChip>
              <div class="text-caption text-medium-emphasis mt-1">
                {{ resultDescription(item) }}
              </div>
            </div>
          </template>
          <template #item.grupos="{ item }">
            <span>{{ groupSummary(item) }}</span>
            <VIcon
              v-if="item.avisos.length"
              icon="ri-alert-line"
              color="warning"
              size="18"
              class="ms-2"
              :aria-label="`${item.avisos.length} aviso(s)`"
            />
          </template>
          <template #expanded-row="{ columns, item }">
            <tr>
              <td
                :colspan="columns.length"
                class="py-4 detail-cell"
              >
                <div class="text-body-2 mb-2">
                  <strong>E-mail:</strong> {{ item.email }} · <strong>UID na planilha:</strong> {{ item.uid }}
                </div>
                <div
                  v-if="item.acoesObrigatorias.length"
                  class="text-body-2 mb-2"
                >
                  <strong>Ações obrigatórias no próximo login:</strong>
                  {{ item.acoesObrigatorias.map(a => requiredActionLabels[a] ?? a).join(', ') }}
                </div>
                <div class="d-flex flex-wrap gap-2 mb-2">
                  <VChip
                    v-for="group in item.grupos"
                    :key="group.id"
                    :color="groupStatusLabels[group.status].color"
                    :prepend-icon="groupStatusLabels[group.status].icon"
                    size="small"
                    label
                  >
                    {{ group.path }}: {{ groupStatusLabels[group.status].text }}<template v-if="group.erro">
                      ({{ group.erro }})
                    </template>
                  </VChip>
                </div>
                <div
                  v-for="aviso in item.avisos"
                  :key="aviso"
                  class="text-warning text-body-2 d-flex align-center gap-1"
                >
                  <VIcon
                    icon="ri-alert-line"
                    size="16"
                  />
                  {{ aviso }}
                </div>
                <div
                  v-if="item.erro"
                  class="text-error text-body-2 d-flex align-center gap-1"
                >
                  <VIcon
                    icon="ri-error-warning-line"
                    size="16"
                  />
                  {{ item.erro }}
                </div>
              </td>
            </tr>
          </template>
        </VDataTable>
      </VCardText>
    </VCard>

    <VDialog
      v-model="confirmCancel"
      max-width="480"
    >
      <VCard title="Cancelar a importação?">
        <VCardText>
          As linhas já processadas mantêm o resultado. As restantes ficarão como "Não processado" e poderão ser
          reprocessadas depois.
        </VCardText>
        <VCardActions class="justify-end">
          <VBtn
            variant="text"
            color="secondary"
            @click="confirmCancel = false"
          >
            Continuar importando
          </VBtn>
          <VBtn
            color="error"
            @click="cancel"
          >
            Cancelar importação
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>

<style scoped>
.visually-hidden {
  position: absolute;
  overflow: hidden;
  clip: rect(0 0 0 0);
  block-size: 1px;
  inline-size: 1px;
  white-space: nowrap;
}

.status-card:focus-visible {
  outline: 3px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.detail-cell {
  background-color: rgba(var(--v-theme-on-surface), 0.03);
}
</style>
