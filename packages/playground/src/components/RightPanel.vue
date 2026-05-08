<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlaygroundStore } from '../store.ts'
import DqlTab from './tabs/DqlTab.vue'
import DraftAstTab from './tabs/DraftAstTab.vue'
import ErrorsTab from './tabs/ErrorsTab.vue'
import SqlTab from './tabs/SqlTab.vue'
import ValidAstTab from './tabs/ValidAstTab.vue'

type TabId = 'draft' | 'valid' | 'errors' | 'sql' | 'dql'

const tabs: Array<{ id: TabId, label: string }> = [
  { id: 'draft',  label: '当前 AST' },
  { id: 'valid',  label: '合法化 AST' },
  { id: 'errors', label: '错误' },
  { id: 'sql',    label: 'SQL' },
  { id: 'dql',    label: 'DQL' },
]

const active = ref<TabId>('valid')
const store = usePlaygroundStore()

const errorCount = computed(() => store.filter.value.errors.value.length)
const droppedCount = computed(() => store.filter.value.dropped.value.length)
const errorBadge = computed(() => errorCount.value + droppedCount.value)
</script>

<template>
  <section class="right-panel">
    <nav class="right-panel__tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="active === t.id"
        class="right-panel__tab"
        :class="{ 'right-panel__tab--active': active === t.id }"
        @click="active = t.id"
      >
        {{ t.label }}
        <span
          v-if="t.id === 'errors' && errorBadge > 0"
          class="right-panel__badge"
        >{{ errorBadge }}</span>
      </button>
    </nav>

    <div class="right-panel__body">
      <DraftAstTab v-if="active === 'draft'" />
      <ValidAstTab v-else-if="active === 'valid'" />
      <ErrorsTab v-else-if="active === 'errors'" />
      <SqlTab v-else-if="active === 'sql'" />
      <DqlTab v-else-if="active === 'dql'" />
    </div>
  </section>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}
.right-panel__tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  overflow-x: auto;
}
.right-panel__tab {
  position: relative;
  background: none;
  border: none;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  font-weight: 500;
  white-space: nowrap;
  transition: color 120ms ease, background 120ms ease;
}
.right-panel__tab:hover {
  color: var(--text-strong);
}
.right-panel__tab--active {
  color: var(--accent-strong);
  background: var(--surface-deep);
}
.right-panel__tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--accent-strong);
  border-radius: 2px 2px 0 0;
}
.right-panel__badge {
  margin-left: 6px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  vertical-align: middle;
}
.right-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}
.right-panel__body > * {
  height: 100%;
  min-height: 0;
}
</style>
