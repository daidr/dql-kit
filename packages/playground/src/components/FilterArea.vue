<script setup lang="ts">
import { FilterButton, FilterPanel } from '@dql-kit/vue-ui'
import { computed } from 'vue'
import { usePlaygroundStore } from '../store.ts'

const store = usePlaygroundStore()

const filter = computed(() => store.filter.value)
const config = computed(() => store.config.value)
const errors = computed(() => filter.value.errors.value)
const dropped = computed(() => filter.value.dropped.value)

const isManual = computed(() => config.value.commitMode === 'manual')
const isDirty = computed(() => filter.value.isDirty.value)

const onClear = () => filter.value.actions.clear()
const onCommit = () => filter.value.commit()
const onDiscard = () => filter.value.discard()
</script>

<template>
  <section class="filter-area">
    <header class="filter-area__head">
      <div class="filter-area__title">
        <span>筛选器</span>
        <span class="filter-area__sub">
          commit: <code>{{ config.commitMode }}</code>
        </span>
      </div>
      <div class="filter-area__actions">
        <FilterButton :filter="filter" />
        <template v-if="isManual">
          <button
            type="button"
            class="btn btn--ghost"
            :disabled="!isDirty"
            @click="onDiscard"
          >
            放弃
          </button>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="!isDirty"
            @click="onCommit"
          >
            提交
          </button>
        </template>
        <button type="button" class="btn btn--ghost" @click="onClear">
          清空
        </button>
      </div>
    </header>

    <div class="filter-area__body">
      <FilterPanel :filter="filter" />
    </div>

    <footer class="filter-area__foot">
      <div v-if="errors.length > 0" class="filter-area__chip filter-area__chip--err">
        {{ errors.length }} 个错误
      </div>
      <div v-if="dropped.length > 0" class="filter-area__chip filter-area__chip--warn">
        {{ dropped.length }} 个节点已丢弃
        <button
          type="button"
          class="filter-area__chip-close"
          @click="filter.dismissDropped()"
        >
          ×
        </button>
      </div>
      <div v-if="isManual && !isDirty" class="filter-area__chip">已同步</div>
    </footer>
  </section>
</template>

<style scoped>
.filter-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  padding: 12px 14px;
}
.filter-area__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.filter-area__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.filter-area__sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
  letter-spacing: 0;
  text-transform: none;
}
.filter-area__sub code {
  font-family: var(--font-mono);
  background: var(--surface-deep);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--text-strong);
}
.filter-area__actions {
  display: flex;
  gap: 6px;
}
.filter-area__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  background: var(--surface-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}
.filter-area__foot {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  min-height: 22px;
}
.filter-area__chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-deep);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.filter-area__chip--err {
  background: var(--danger-soft);
  color: var(--danger);
}
.filter-area__chip--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.filter-area__chip-close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}
</style>
