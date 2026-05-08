<script setup lang="ts">
import { computed } from 'vue'
import { usePlaygroundStore } from '../../store.ts'
import JsonView from '../JsonView.vue'

const store = usePlaygroundStore()
const valid = computed(() => store.filter.value.valid.value)
</script>

<template>
  <div class="tab-pane">
    <p class="tab-pane__hint">
      <code>analyze</code> 一次走查得到的合法化结果：丢弃不完整 / 类型错误的节点，保留可执行子树。
      也是 <code>useFilter().valid</code> 的输出。
    </p>
    <JsonView :value="valid" />
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
