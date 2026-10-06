<script setup lang="ts">
import type { GroupNode } from '~/types/import'

defineOptions({ name: 'GroupTreeNode' })

const props = defineProps<{
  node: GroupNode
  depth: number
  selectedIds: string[]
  expandedIds: string[]
  forceExpand: boolean
  term: string
}>()

const emit = defineEmits<{
  select: [id: string, value: boolean]
  expand: [id: string]
}>()

const hasChildren = computed(() => props.node.subGroups.length > 0)
const expanded = computed(() => hasChildren.value && (props.forceExpand || props.expandedIds.includes(props.node.id)))
const selected = computed(() => props.selectedIds.includes(props.node.id))
const childrenId = computed(() => `group-children-${props.node.id}`)

const segments = computed(() => {
  const name = props.node.name
  const term = props.term
  const index = term ? name.toLowerCase().indexOf(term) : -1
  if (index < 0)
    return [{ text: name, match: false }]

  return [
    { text: name.slice(0, index), match: false },
    { text: name.slice(index, index + term.length), match: true },
    { text: name.slice(index + term.length), match: false },
  ].filter(s => s.text)
})
</script>

<template>
  <li class="group-node">
    <div
      class="group-row"
      :class="{ 'group-row--selected': selected }"
      :style="{ paddingInlineStart: `${depth * 1.5}rem` }"
    >
      <IconBtn
        v-if="hasChildren"
        size="small"
        :aria-expanded="expanded"
        :aria-controls="childrenId"
        :aria-label="`${expanded ? 'Recolher' : 'Expandir'} subgrupos de ${node.name}`"
        :disabled="forceExpand"
        @click="emit('expand', node.id)"
      >
        <VIcon :icon="expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'" />
      </IconBtn>
      <span
        v-else
        class="expand-placeholder"
      />

      <VCheckbox
        :model-value="selected"
        density="compact"
        hide-details
        class="flex-grow-1"
        :aria-label="`Selecionar grupo ${node.path}`"
        @update:model-value="value => emit('select', node.id, !!value)"
      >
        <template #label>
          <span class="d-flex flex-column">
            <span>
              <template
                v-for="(segment, i) in segments"
                :key="i"
              >
                <mark
                  v-if="segment.match"
                  class="match"
                >{{ segment.text }}</mark>
                <template v-else>{{ segment.text }}</template>
              </template>
              <span
                v-if="hasChildren"
                class="text-caption text-medium-emphasis ms-2"
              >{{ node.subGroups.length }} subgrupo(s)</span>
            </span>
            <span
              v-if="term"
              class="text-caption text-medium-emphasis"
            >{{ node.path }}</span>
          </span>
        </template>
      </VCheckbox>
    </div>

    <ul
      v-if="expanded"
      :id="childrenId"
      class="group-list"
    >
      <GroupTreeNode
        v-for="child in node.subGroups"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-ids="selectedIds"
        :expanded-ids="expandedIds"
        :force-expand="forceExpand"
        :term="term"
        @select="(id, value) => emit('select', id, value)"
        @expand="id => emit('expand', id)"
      />
    </ul>
  </li>
</template>

<style scoped lang="scss">
.group-list {
  padding: 0;
  list-style: none;
}

.group-row {
  display: flex;
  align-items: center;
  border-radius: 8px;
  gap: 0.25rem;
  min-block-size: 44px;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  &--selected {
    background-color: rgba(var(--v-theme-primary), 0.1);
  }
}

.expand-placeholder {
  display: inline-block;
  flex: none;
  inline-size: 34px;
}

.match {
  border-radius: 2px;
  background-color: rgba(var(--v-theme-warning), 0.35);
  color: inherit;
}
</style>
