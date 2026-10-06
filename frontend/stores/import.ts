import { defineStore } from 'pinia'
import { api, apiErrorMessage } from '~/composables/useApi'
import type { GroupNode, GroupRef, HealthResponse, JobView, PreviewResult, PreviewRow, RowResult } from '~/types/import'

const FINAL = new Set(['CONCLUIDO', 'CANCELADO', 'FALHOU'])
const POLL_MS = 1500

export const useImportStore = defineStore('import', () => {
  const step = ref(1)

  const health = ref<HealthResponse | null>(null)
  const healthLoading = ref(false)
  const healthError = ref('')

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

  const started = computed(() => job.value !== null)
  const finished = computed(() => !!job.value && FINAL.has(job.value.status))

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

  async function uploadFile(file: File) {
    uploading.value = true
    uploadError.value = ''
    try {
      const form = new FormData()

      form.append('file', file, file.name)
      preview.value = await api<PreviewResult>('/imports/preview', { method: 'POST', body: form })
      removedLines.value = []
      step.value = 2
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
          groupIds: selectedGroupIds.value,
          rows: validRows.value.map(r => ({ line: r.line, uid: r.uid, nome: r.nome, email: r.email })),
        },
      })

      results.value = []
      applyJob(view)
      step.value = 5
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
    step.value = 1
    preview.value = null
    removedLines.value = []
    uploadError.value = ''
    selectedGroupIds.value = []
    job.value = null
    results.value = []
    jobError.value = ''
  }

  return {
    step,
    health,
    healthLoading,
    healthError,
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
    started,
    finished,
    loadHealth,
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
