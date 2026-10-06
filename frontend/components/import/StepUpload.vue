<script setup lang="ts">
import { useImportStore } from '~/stores/import'
import { formatBytes } from '~/utils/importLabels'

const store = useImportStore()
const input = ref<HTMLInputElement>()
const dragging = ref(false)
const errorId = 'upload-error'

const limits = computed(() => store.health?.settings)

function openPicker() {
  if (!store.uploading)
    input.value?.click()
}

function handleFiles(files: FileList | null | undefined) {
  const file = files?.[0]
  if (file)
    store.uploadFile(file)
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement

  handleFiles(target.files)
  target.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  handleFiles(event.dataTransfer?.files)
}
</script>

<template>
  <VCard>
    <VCardText>
      <p class="text-body-1 mb-6">
        Envie a planilha com os usuários a importar. O arquivo deve estar em formato <strong>CSV</strong>
        e conter as colunas <code>UID</code> (login), <code>NOME</code> e <code>Email</code>.
      </p>

      <div
        class="dropzone"
        :class="{ 'dropzone--active': dragging, 'dropzone--error': store.uploadError }"
        role="button"
        tabindex="0"
        :aria-busy="store.uploading"
        :aria-describedby="store.uploadError ? errorId : 'upload-help'"
        aria-label="Selecionar planilha CSV. Você também pode arrastar e soltar o arquivo aqui."
        @click="openPicker"
        @keydown.enter.prevent="openPicker"
        @keydown.space.prevent="openPicker"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <VProgressCircular
          v-if="store.uploading"
          indeterminate
          size="48"
          class="mb-4"
        />
        <VIcon
          v-else
          icon="ri-file-upload-line"
          size="48"
          class="mb-4"
          color="primary"
        />
        <div class="text-h6 mb-1">
          {{ store.uploading ? 'Lendo a planilha…' : 'Arraste e solte o arquivo CSV aqui' }}
        </div>
        <div
          id="upload-help"
          class="text-body-2 text-medium-emphasis mb-4"
        >
          ou use o botão abaixo
          <template v-if="limits">
            · até {{ formatBytes(limits.uploadMaxBytes) }} e {{ limits.uploadMaxRows.toLocaleString('pt-BR') }} linhas
          </template>
        </div>
        <VBtn
          :loading="store.uploading"
          prepend-icon="ri-folder-open-line"
          tabindex="-1"
          @click.stop="openPicker"
        >
          Selecionar arquivo
        </VBtn>
        <input
          ref="input"
          type="file"
          accept=".csv,text/csv"
          class="d-none"
          @change="onChange"
        >
      </div>

      <VAlert
        v-if="store.uploadError"
        :id="errorId"
        type="error"
        variant="tonal"
        class="mt-4"
        role="alert"
      >
        {{ store.uploadError }}
      </VAlert>

      <VRow class="mt-6">
        <VCol
          cols="12"
          md="7"
        >
          <h3 class="text-subtitle-1 font-weight-medium mb-2">
            Formato esperado
          </h3>
          <VTable
            density="compact"
            class="border rounded"
          >
            <thead>
              <tr>
                <th>UID</th>
                <th>NOME</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>t_abc1234</td>
                <td>Maria da Silva Santos</td>
                <td>maria.santos@exemplo.com.br</td>
              </tr>
            </tbody>
          </VTable>
        </VCol>
        <VCol
          cols="12"
          md="5"
        >
          <h3 class="text-subtitle-1 font-weight-medium mb-2">
            Dicas
          </h3>
          <ul class="text-body-2 tips">
            <li>Separador <code>;</code> ou <code>,</code> e acentos (UTF-8 ou padrão do Excel) são detectados automaticamente.</li>
            <li>O UID vira o login, em minúsculas.</li>
            <li>O primeiro nome vai para "nome" e o restante para "sobrenome".</li>
          </ul>
          <VBtn
            variant="tonal"
            prepend-icon="ri-download-2-line"
            href="/api/imports/template.csv"
            download
            class="mt-3"
          >
            Baixar modelo CSV
          </VBtn>
        </VCol>
      </VRow>
    </VCardText>
  </VCard>
</template>

<style scoped lang="scss">
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1.5rem;
  border: 2px dashed rgba(var(--v-border-color), 0.3);
  border-radius: 12px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s, background-color 0.2s;

  &:hover,
  &--active {
    border-color: rgb(var(--v-theme-primary));
    background-color: rgba(var(--v-theme-primary), 0.06);
  }

  &--error {
    border-color: rgb(var(--v-theme-error));
  }

  &:focus-visible {
    outline: 3px solid rgb(var(--v-theme-primary));
    outline-offset: 3px;
  }
}

.tips {
  padding-inline-start: 1.25rem;

  li + li {
    margin-block-start: 0.25rem;
  }
}
</style>
