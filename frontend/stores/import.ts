import type { InjectionKey } from 'vue'
import { defineStore } from 'pinia'
import { api, apiErrorMessage } from '~/composables/useApi'
import { useConnectionStore } from '~/stores/connection'
import type { GroupNode, GroupRef, ImportMode, JobView, PreviewResult, PreviewRow, RowResult, StepName } from '~/types/import'

const FINAL = new Set(['CONCLUIDO', 'CANCELADO', 'FALHOU'])
const POLL_MS = 1500

export const STEPS: Record<ImportMode, StepName[]> = {
  simples: ['upload', 'review', 'groups', 'confirm', 'result'],
  completa: ['upload', 'review', 'confirm', 'result'],
}

export interface GroupUsage {
  path: string
  count: number
}

const storeDefinitions = {
  simples: defineImportStore('simples'),
  completa: defineImportStore('completa'),
}

export function createImportStore(mode: ImportMode) {
  return storeDefinitions[mode]()
}

export type ImportStore = ReturnType<typeof createImportStore>

export const importStoreKey: InjectionKey<ImportStore> = Symbol('importStore')

/** Store da importação em andamento na página; fora de um ImportWizard, usa a importação simples. */
export function useImportStore(): ImportStore {
  return inject(importStoreKey, null) ?? createImportStore('simples')
}

function defineImportStore(mode: ImportMode) {
  return defineStore(`import-${mode}`, () => {
    const connection = useConnectionStore()
    const steps = STEPS[mode]
    const step = ref<StepName>('upload')

    const preview = ref<PreviewResult | null>(null)
    const removedLines = ref<number[]>([])
    const uploading = ref(false)
    const uploadError = ref('')

    const groupTree = ref<GroupNode[]>([])
    const groupsLoading = ref(false)
    const groupsError = ref('')
    const selectedGroupIds = ref<string[]>([])

    const job = ref<JobView | null>(null)
    const results = ref<RowResult[]>([])
    const jobError = ref('')
    const actionLoading = ref(false)
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    const rows = computed<PreviewRow[]>(() =>
      (preview.value?.rows ?? []).filter(r => !removedLines.value.includes(r.line)))

    const validRows = computed(() => rows.value.filter(r => r.errors.length === 0))
    const invalidRows = computed(() => rows.value.filter(r => r.errors.length > 0))

    const groupIndex = computed(() => {
      const map = new Map<string, GroupRef>()

      const walk = (nodes: GroupNode[]) => nodes.forEach(n => {
        map.set(n.id, { id: n.id, name: n.name, path: n.path })
        walk(n.subGroups)
      })

      walk(groupTree.value)

      return map
    })

    const selectedGroups = computed(() =>
      selectedGroupIds.value.map(id => groupIndex.value.get(id)).filter((g): g is GroupRef => !!g)
        .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR')))

    function usage(status: 'OK' | 'INEXISTENTE'): GroupUsage[] {
      const counts = new Map<string, number>()
      for (const row of validRows.value) {
        for (const g of row.groupChecks ?? []) {
          if (g.status === status)
            counts.set(g.path, (counts.get(g.path) ?? 0) + 1)
        }
      }

      return [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'))
    }

    /** Importação completa: grupos válidos das linhas que serão importadas, com a quantidade de usuários. */
    const rowGroups = computed(() => usage('OK'))
    const missingGroups = computed(() => usage('INEXISTENTE'))

    const started = computed(() => job.value !== null)
    const finished = computed(() => !!job.value && FINAL.has(job.value.status))

    /** Última etapa que o usuário pode abrir no estado atual. */
    const reachable = computed<StepName>(() => {
      if (started.value)
        return 'result'
      if (validRows.value.length && (mode === 'completa' || selectedGroups.value.length))
        return 'confirm'
      if (validRows.value.length && mode === 'simples')
        return 'groups'
      if (preview.value)
        return 'review'

      return 'upload'
    })

    function canGoTo(name: StepName) {
      return started.value ? name === 'result' : steps.indexOf(name) <= steps.indexOf(reachable.value)
    }

    function goTo(name: StepName) {
      if (name === 'groups' && !groupTree.value.length)
        void loadGroups()
      step.value = name
    }

    function next() {
      const following = steps[steps.indexOf(step.value) + 1]
      if (following)
        goTo(following)
    }

    function back() {
      const previous = steps[steps.indexOf(step.value) - 1]
      if (previous)
        goTo(previous)
    }

    async function uploadFile(file: File) {
      uploading.value = true
      uploadError.value = ''
      try {
        const form = new FormData()

        form.append('file', file, file.name)
        preview.value = await api<PreviewResult>('/imports/preview', { method: 'POST', body: form, query: { mode } })
        removedLines.value = []
        goTo('review')
      }
      catch (err) {
        uploadError.value = apiErrorMessage(err)
      }
      finally {
        uploading.value = false
      }
    }

    function removeRow(line: number) {
      if (!removedLines.value.includes(line))
        removedLines.value.push(line)
    }

    function restoreRows() {
      removedLines.value = []
    }

    async function loadGroups(refresh = false) {
      groupsLoading.value = true
      groupsError.value = ''
      try {
        groupTree.value = await api<GroupNode[]>('/groups', { query: refresh ? { refresh: 'true' } : undefined })
        selectedGroupIds.value = selectedGroupIds.value.filter(id => groupIndex.value.has(id))
      }
      catch (err) {
        groupsError.value = apiErrorMessage(err)
      }
      finally {
        groupsLoading.value = false
      }
    }

    function toggleGroup(id: string, selected?: boolean) {
      const has = selectedGroupIds.value.includes(id)
      const shouldSelect = selected ?? !has
      if (shouldSelect && !has)
        selectedGroupIds.value.push(id)
      else if (!shouldSelect && has)
        selectedGroupIds.value = selectedGroupIds.value.filter(g => g !== id)
    }

    function applyJob(view: JobView, append = true) {
      results.value = append ? [...results.value, ...view.results] : view.results
      job.value = { ...view, results: [] }
    }

    async function startImport() {
      actionLoading.value = true
      jobError.value = ''
      try {
        const view = await api<JobView>('/imports', {
          method: 'POST',
          body: {
            fileName: preview.value?.fileName,
            mode,
            ...(mode === 'simples' && { groupIds: selectedGroupIds.value }),
            rows: (preview.value?.rows ?? []).map(r => ({
              line: r.line,
              uid: r.uid,
              nome: r.nome,
              email: r.email,
              ...(mode === 'completa' && { groups: r.groups ?? [] }),
              ...(removedLines.value.includes(r.line) && { removed: true }),
            })),
          },
        })

        results.value = []
        applyJob(view)
        goTo('result')
        schedulePoll()
      }
      catch (err) {
        jobError.value = apiErrorMessage(err)
      }
      finally {
        actionLoading.value = false
      }
    }

    function schedulePoll() {
      clearTimeout(pollTimer)
      if (job.value && !FINAL.has(job.value.status))
        pollTimer = setTimeout(poll, POLL_MS)
    }

    async function poll() {
      if (!job.value)
        return
      try {
        const view = await api<JobView>(`/imports/${job.value.id}`, { query: { since: results.value.length } })

        applyJob(view)
        jobError.value = ''
      }
      catch (err) {
        jobError.value = apiErrorMessage(err)
      }
      schedulePoll()
    }

    async function control(action: 'pause' | 'resume' | 'cancel') {
      if (!job.value)
        return
      actionLoading.value = true
      try {
        await api(`/imports/${job.value.id}/${action}`, { method: 'POST' })
        await poll()
      }
      catch (err) {
        jobError.value = apiErrorMessage(err)
      }
      finally {
        actionLoading.value = false
      }
    }

    async function retryErrors() {
      if (!job.value)
        return
      actionLoading.value = true
      jobError.value = ''
      try {
        const view = await api<JobView>(`/imports/${job.value.id}/retry-errors`, { method: 'POST' })

        results.value = []
        applyJob(view)
        schedulePoll()
      }
      catch (err) {
        jobError.value = apiErrorMessage(err)
      }
      finally {
        actionLoading.value = false
      }
    }

    function reset() {
      clearTimeout(pollTimer)
      step.value = 'upload'
      preview.value = null
      removedLines.value = []
      uploadError.value = ''
      selectedGroupIds.value = []
      job.value = null
      results.value = []
      jobError.value = ''
    }

    return {
      mode,
      steps,
      step,
      health: computed(() => connection.health),
      healthLoading: computed(() => connection.healthLoading),
      healthError: computed(() => connection.healthError),
      loadHealth: connection.loadHealth,
      preview,
      removedLines,
      uploading,
      uploadError,
      groupTree,
      groupsLoading,
      groupsError,
      selectedGroupIds,
      job,
      results,
      jobError,
      actionLoading,
      rows,
      validRows,
      invalidRows,
      selectedGroups,
      rowGroups,
      missingGroups,
      started,
      finished,
      canGoTo,
      goTo,
      next,
      back,
      uploadFile,
      removeRow,
      restoreRows,
      loadGroups,
      toggleGroup,
      startImport,
      control,
      retryErrors,
      reset,
    }
  })
}
