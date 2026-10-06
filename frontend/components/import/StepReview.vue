<script setup lang="ts">
import { useImportStore } from '~/stores/import'
import type { PreviewRow } from '~/types/import'

const store = useImportStore()
const onlyInvalid = ref(false)
const search = ref('')

const headers = [
  { title: 'Linha', key: 'line', width: 80 },
  { title: 'Login (username)', key: 'username' },
  { title: 'Nome', key: 'firstName' },
  { title: 'Sobrenome', key: 'lastName' },
  { title: 'E-mail', key: 'email' },
  { title: 'Situação', key: 'errors', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 64 },
]

const items = computed<PreviewRow[]>(() => (onlyInvalid.value ? store.invalidRows : store.rows))

watch(() => store.invalidRows.length, count => {
  if (count === 0)
    onlyInvalid.value = false
})

const encodingLabel = computed(() => {
  const map: Record<string, string> = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 com BOM', 'windows-1252': 'Windows-1252 (Excel)' }

  return map[store.preview?.encoding ?? ''] ?? store.preview?.encoding
})

function rowProps({ item }: { item: PreviewRow }) {
  return item.errors.length ? { class: 'row-invalid' } : {}
}
</script>

<template>
  <VCard v-if="store.preview">
    <VCardText>
      <div class="d-flex flex-wrap gap-4 mb-4">
        <VChip
          label
          prepend-icon="ri-file-text-line"
        >
          {{ store.preview.fileName }}
        </VChip>
        <VChip
          label
          variant="outlined"
        >
          {{ encodingLabel }} · separador "{{ store.preview.delimiter }}"
        </VChip>
      </div>

      <VRow class="mb-2">
        <VCol
          cols="12"
          sm="4"
        >
          <VCard
            variant="tonal"
            color="primary"
          >
            <VCardText>
              <div class="text-h4">
                {{ store.rows.length }}
              </div>
              <div>linhas na planilha</div>
            </VCardText>
          </VCard>
        </VCol>
        <VCol
          cols="12"
          sm="4"
        >
          <VCard
            variant="tonal"
            color="success"
          >
            <VCardText>
              <div class="text-h4">
                {{ store.validRows.length }}
              </div>
              <div>
                <VIcon
                  icon="ri-checkbox-circle-line"
                  size="18"
                /> válidas, serão importadas
              </div>
            </VCardText>
          </VCard>
        </VCol>
        <VCol
          cols="12"
          sm="4"
        >
          <VCard
            variant="tonal"
            :color="store.invalidRows.length ? 'error' : 'secondary'"
          >
            <VCardText>
              <div class="text-h4">
                {{ store.invalidRows.length }}
              </div>
              <div>
                <VIcon
                  icon="ri-error-warning-line"
                  size="18"
                /> inválidas, serão ignoradas
              </div>
            </VCardText>
          </VCard>
        </VCol>
      </VRow>

      <VAlert
        v-if="store.invalidRows.length && store.validRows.length"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        {{ store.invalidRows.length }} linha(s) com problema serão <strong>ignoradas</strong>.
        Para incluí-las, corrija a planilha e envie novamente.
      </VAlert>
      <VAlert
        v-if="!store.validRows.length"
        type="error"
        variant="tonal"
        class="mb-4"
        role="alert"
      >
        Nenhuma linha válida para importar. Corrija a planilha e envie novamente.
      </VAlert>

      <div class="d-flex flex-wrap align-center gap-4 mb-4">
        <VTextField
          v-model="search"
          label="Buscar na tabela"
          prepend-inner-icon="ri-search-line"
          clearable
          style="max-inline-size: 320px;"
        />
        <VSwitch
          v-model="onlyInvalid"
          :disabled="!store.invalidRows.length"
          :label="`Mostrar só inválidas (${store.invalidRows.length})`"
        />
        <VSpacer />
        <VBtn
          v-if="store.removedLines.length"
          variant="text"
          prepend-icon="ri-arrow-go-back-line"
          @click="store.restoreRows()"
        >
          Restaurar {{ store.removedLines.length }} linha(s) removida(s)
        </VBtn>
      </div>

      <VDataTable
        :headers="headers"
        :items="items"
        :search="search"
        :items-per-page="25"
        :row-props="rowProps"
        item-value="line"
        density="comfortable"
        class="border rounded"
        no-data-text="Nenhuma linha para exibir."
        items-per-page-text="Linhas por página"
        page-text="{0}-{1} de {2}"
      >
        <template #item.errors="{ item }">
          <div
            v-if="item.errors.length"
            class="d-flex flex-column gap-1 py-1"
          >
            <span
              v-for="error in item.errors"
              :key="error"
              class="text-error d-flex align-center gap-1"
            >
              <VIcon
                icon="ri-error-warning-line"
                size="16"
              />
              {{ error }}
            </span>
          </div>
          <span
            v-else
            class="text-success d-flex align-center gap-1"
          >
            <VIcon
              icon="ri-checkbox-circle-line"
              size="16"
            />
            Válida
          </span>
        </template>
        <template #item.actions="{ item }">
          <IconBtn
            size="small"
            :aria-label="`Remover linha ${item.line} (${item.username || 'sem UID'})`"
            @click="store.removeRow(item.line)"
          >
            <VIcon icon="ri-delete-bin-line" />
            <VTooltip activator="parent">
              Remover linha
            </VTooltip>
          </IconBtn>
        </template>
      </VDataTable>
    </VCardText>

    <VCardActions class="justify-space-between pa-4">
      <VBtn
        variant="outlined"
        color="secondary"
        prepend-icon="ri-arrow-left-line"
        @click="store.step = 1"
      >
        Trocar arquivo
      </VBtn>
      <VBtn
        variant="elevated"
        :disabled="!store.validRows.length"
        append-icon="ri-arrow-right-line"
        @click="store.step = 3; store.groupTree.length || store.loadGroups()"
      >
        Escolher grupos
      </VBtn>
    </VCardActions>
  </VCard>
</template>

<style scoped>
:deep(.row-invalid) {
  background-color: rgba(var(--v-theme-error), 0.08);
}
</style>
