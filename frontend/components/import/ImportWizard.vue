<script setup lang="ts">
import type { Component } from 'vue'
import StepConfirm from '~/components/import/StepConfirm.vue'
import StepGroups from '~/components/import/StepGroups.vue'
import StepResult from '~/components/import/StepResult.vue'
import StepReview from '~/components/import/StepReview.vue'
import StepUpload from '~/components/import/StepUpload.vue'
import { createImportStore, importStoreKey } from '~/stores/import'
import type { ImportMode, StepName } from '~/types/import'

const props = defineProps<{ mode: ImportMode }>()

const store = createImportStore(props.mode)

provide(importStoreKey, store)

const stepInfo: Record<StepName, { title: string; subtitle: string; component: Component }> = {
  upload: { title: 'Upload', subtitle: 'Planilha CSV', component: StepUpload },
  review: { title: 'Revisão', subtitle: 'Conferir as linhas', component: StepReview },
  groups: { title: 'Grupos', subtitle: 'Escolher os grupos', component: StepGroups },
  confirm: { title: 'Confirmação', subtitle: 'Revisar e importar', component: StepConfirm },
  result: { title: 'Resultado', subtitle: 'Progresso e relatório', component: StepResult },
}

const steps = computed(() => store.steps.map((name, index) => ({ name, number: index + 1, ...stepInfo[name] })))
const current = computed(() => steps.value.find(s => s.name === store.step) ?? steps.value[0])

function goToNumber(number: number) {
  const target = steps.value[number - 1]
  if (target && store.canGoTo(target.name))
    store.goTo(target.name)
}

function isComplete(name: StepName) {
  return store.steps.indexOf(name) < store.steps.indexOf(store.step) || (name === 'result' && store.finished)
}

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
        :model-value="current.number"
        flat
        alt-labels
        @update:model-value="value => goToNumber(Number(value))"
      >
        <VStepperHeader>
          <template
            v-for="(s, index) in steps"
            :key="s.name"
          >
            <VStepperItem
              :value="s.number"
              :title="s.title"
              :subtitle="s.subtitle"
              :complete="isComplete(s.name)"
              :editable="store.canGoTo(s.name) && s.name !== store.step"
              :disabled="!store.canGoTo(s.name)"
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
      Etapa {{ current.number }} de {{ steps.length }}: {{ current.title }}
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
