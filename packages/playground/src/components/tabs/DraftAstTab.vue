<script setup lang="ts">
import { computed } from 'vue'
import { usePlaygroundStore } from '../../store.ts'
import JsonView from '../JsonView.vue'

const store = usePlaygroundStore()
const draft = computed(() => store.filter.value.draft.value)
</script>

<template>
  <div class="tab-pane">
    <p class="tab-pane__hint">
      用户实时编辑的草稿树。可能包含 <code>null</code> 或缺失字段，未经过校验或剪枝。
    </p>
    <JsonView :value="draft" />
  </div>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.tab-pane__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}
.tab-pane__hint code {
  font-family: var(--font-mono);
  background: var(--surface-deep);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--text-strong);
}
</style>
