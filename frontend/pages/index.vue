<script setup lang="ts">
import StepConfirm from '~/components/import/StepConfirm.vue'
import StepGroups from '~/components/import/StepGroups.vue'
import StepResult from '~/components/import/StepResult.vue'
import StepReview from '~/components/import/StepReview.vue'
import StepUpload from '~/components/import/StepUpload.vue'
import { useImportStore } from '~/stores/import'

useHead({ title: 'Importar usuários' })

const store = useImportStore()

const steps = [
  { value: 1, title: 'Upload', subtitle: 'Planilha CSV', component: StepUpload },
  { value: 2, title: 'Revisão', subtitle: 'Conferir as linhas', component: StepReview },
  { value: 3, title: 'Grupos', subtitle: 'Escolher os grupos', component: StepGroups },
  { value: 4, title: 'Confirmação', subtitle: 'Revisar e importar', component: StepConfirm },
  { value: 5, title: 'Resultado', subtitle: 'Progresso e relatório', component: StepResult },
]

const reachable = computed(() => {
  if (store.started)
    return 5
  if (store.selectedGroups.length && store.validRows.length)
    return 4
  if (store.validRows.length)
    return 3
  if (store.preview)
    return 2

  return 1
})

function canGoTo(value: number) {
  return store.started ? value === 5 : value <= reachable.value
}

const current = computed(() => steps.find(s => s.value === store.step) ?? steps[0])

const heading = ref<HTMLElement>()

watch(() => store.step, async () => {
  await nextTick()
  heading.value?.focus()
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (store.started && !store.finished) {
    event.preventDefault()
    event.returnValue = ''
  }
})
</script>

<template>
  <div>
    <VCard class="mb-6">
      <VStepper
        :model-value="store.step"
        flat
        alt-labels
        @update:model-value="value => canGoTo(Number(value)) && (store.step = Number(value))"
      >
        <VStepperHeader>
          <template
            v-for="(s, index) in steps"
            :key="s.value"
          >
            <VStepperItem
              :value="s.value"
              :title="s.title"
              :subtitle="s.subtitle"
              :complete="store.step > s.value || (s.value === 5 && store.finished)"
              :editable="canGoTo(s.value) && s.value !== store.step"
              :disabled="!canGoTo(s.value)"
              color="primary"
            />
            <VDivider v-if="index < steps.length - 1" />
          </template>
        </VStepperHeader>
      </VStepper>
    </VCard>

    <h2
      ref="heading"
      tabindex="-1"
      class="text-h5 mb-4 step-heading"
    >
      Etapa {{ current.value }} de {{ steps.length }}: {{ current.title }}
    </h2>

    <KeepAlive>
      <component :is="current.component" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.step-heading:focus {
  outline: none;
}

.step-heading:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 4px;
}
</style>
