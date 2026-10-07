<script setup lang="ts">
import GroupTreeNode from '~/components/import/GroupTreeNode.vue'
import { useImportStore } from '~/stores/import'
import type { GroupNode } from '~/types/import'

const store = useImportStore()
const search = ref<string | null>('')
const debounced = refDebounced(search, 250)
const term = computed(() => (debounced.value ?? '').trim().toLowerCase())
const expandedIds = ref<string[]>([])

onMounted(() => {
  if (!store.groupTree.length && !store.groupsLoading)
    store.loadGroups()
})

function prune(nodes: GroupNode[]): GroupNode[] {
  if (!term.value)
    return nodes

  return nodes.flatMap(node => {
    const subGroups = prune(node.subGroups)
    const match = node.name.toLowerCase().includes(term.value) || node.path.toLowerCase().includes(term.value)

    return match || subGroups.length ? [{ ...node, subGroups }] : []
  })
}

const visibleTree = computed(() => prune(store.groupTree))

const totalGroups = computed(() => {
  const count = (nodes: GroupNode[]): number => nodes.reduce((sum, n) => sum + 1 + count(n.subGroups), 0)

  return count(store.groupTree)
})

function toggleExpand(id: string) {
  expandedIds.value = expandedIds.value.includes(id)
    ? expandedIds.value.filter(e => e !== id)
    : [...expandedIds.value, id]
}

function expandAll(value: boolean) {
  const ids: string[] = []

  const walk = (nodes: GroupNode[]) => nodes.forEach(n => {
    if (n.subGroups.length) {
      ids.push(n.id)
      walk(n.subGroups)
    }
  })

  walk(store.groupTree)
  expandedIds.value = value ? ids : []
}
</script>

<template>
  <VCard>
    <VCardText>
      <p class="text-body-1 mb-4">
        Selecione os grupos que serão atribuídos a <strong>todos os {{ store.validRows.length }} usuários</strong>.
        Marcar um grupo não marca seus subgrupos (e vice-versa).
      </p>

      <section
        aria-labelledby="selected-title"
        class="mb-4"
      >
        <h3
          id="selected-title"
          class="text-subtitle-1 font-weight-medium mb-2"
        >
          Grupos selecionados ({{ store.selectedGroups.length }})
        </h3>
        <div
          v-if="store.selectedGroups.length"
          class="d-flex flex-wrap gap-2"
        >
          <VChip
            v-for="group in store.selectedGroups"
            :key="group.id"
            color="primary"
            closable
            label
            :close-label="`Remover ${group.path}`"
            @click:close="store.toggleGroup(group.id, false)"
          >
            {{ group.path }}
          </VChip>
        </div>
        <p
          v-else
          class="text-body-2 text-medium-emphasis"
        >
          Nenhum grupo selecionado ainda.
        </p>
      </section>

      <VDivider class="mb-4" />

      <div class="d-flex flex-wrap align-center gap-3 mb-3">
        <VTextField
          v-model="search"
          label="Buscar grupo por nome ou caminho"
          placeholder="ex.: PORTAL"
          prepend-inner-icon="ri-search-line"
          clearable
          style="min-inline-size: 260px; max-inline-size: 420px;"
        />
        <VBtn
          variant="text"
          size="small"
          :disabled="!!term"
          @click="expandAll(true)"
        >
          Expandir tudo
        </VBtn>
        <VBtn
          variant="text"
          size="small"
          :disabled="!!term"
          @click="expandAll(false)"
        >
          Recolher tudo
        </VBtn>
        <VSpacer />
        <VBtn
          variant="tonal"
          size="small"
          prepend-icon="ri-refresh-line"
          :loading="store.groupsLoading"
          @click="store.loadGroups(true)"
        >
          Atualizar grupos
        </VBtn>
      </div>

      <VAlert
        v-if="store.groupsError"
        type="error"
        variant="tonal"
        class="mb-4"
        role="alert"
      >
        Não foi possível carregar os grupos: {{ store.groupsError }}
      </VAlert>

      <div
        class="tree-container border rounded pa-2"
        :aria-busy="store.groupsLoading"
      >
        <VSkeletonLoader
          v-if="store.groupsLoading && !store.groupTree.length"
          type="list-item@6"
        />
        <p
          v-else-if="!store.groupTree.length && !store.groupsError"
          class="pa-4 text-medium-emphasis"
        >
          O realm não possui grupos.
        </p>
        <p
          v-else-if="term && !visibleTree.length"
          class="pa-4 text-medium-emphasis"
          role="status"
        >
          Nenhum grupo encontrado para "{{ debounced }}".
        </p>
        <ul
          v-else
          class="group-list"
          :aria-label="`Árvore de grupos do realm (${totalGroups} grupos)`"
        >
          <GroupTreeNode
            v-for="node in visibleTree"
            :key="node.id"
            :node="node"
            :depth="0"
            :selected-ids="store.selectedGroupIds"
            :expanded-ids="expandedIds"
            :force-expand="!!term"
            :term="term"
            @select="store.toggleGroup"
            @expand="toggleExpand"
          />
        </ul>
      </div>
    </VCardText>

    <VCardActions class="justify-space-between pa-4 flex-wrap gap-2">
      <VBtn
        variant="outlined"
        color="secondary"
        prepend-icon="ri-arrow-left-line"
        @click="store.back()"
      >
        Voltar à revisão
      </VBtn>
      <div class="d-flex align-center gap-3">
        <span
          v-if="!store.selectedGroups.length"
          id="groups-required"
          class="text-body-2 text-medium-emphasis"
        >Escolha ao menos um grupo para continuar.</span>
        <VBtn
          variant="elevated"
          :disabled="!store.selectedGroups.length"
          append-icon="ri-arrow-right-line"
          :aria-describedby="store.selectedGroups.length ? undefined : 'groups-required'"
          @click="store.next()"
        >
          Revisar e confirmar
        </VBtn>
      </div>
    </VCardActions>
  </VCard>
</template>

<style scoped>
.group-list {
  padding: 0;
  list-style: none;
}

.tree-container {
  max-block-size: 480px;
  overflow-y: auto;
}
</style>
