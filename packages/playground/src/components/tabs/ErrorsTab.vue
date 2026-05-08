<script setup lang="ts">
import type { ValidationError } from '@dql-kit/core'
import { computed } from 'vue'
import { usePlaygroundStore } from '../../store.ts'

const store = usePlaygroundStore()
const errors = computed(() => store.filter.value.errors.value)
const dropped = computed(() => store.filter.value.dropped.value)

const formatPath = (p: number[]) =>
  p.length === 0 ? 'root' : `root.${p.join('.')}`

const messageOf = (e: ValidationError): string => {
  switch (e.code) {
    case 'unknown_field':
      return `未知字段：${e.field}`
    case 'op_not_allowed':
      return `字段 ${e.field} 不支持运算符 ${e.op}`
    case 'value_type_mismatch':
      return `值类型不匹配：期望 ${e.expected}，实际 ${e.got}`
    case 'value_shape_mismatch':
      return `值形状不匹配：${e.op} 期望 ${e.expected}`
    case 'incomplete':
      return `缺少 ${e.missing}`
  }
}
</script>

<template>
  <div class="tab-pane">
    <p class="tab-pane__hint">
      校验错误来自 <code>analyze</code> 的同一遍走查；URL 反序列化丢弃的节点单独列出。
    </p>

    <div v-if="errors.length === 0 && dropped.length === 0" class="tab-pane__empty">
      — 没有问题 —
    </div>

    <ol v-if="errors.length > 0" class="error-list">
      <li v-for="(e, i) in errors" :key="i" class="error-list__item">
        <code class="error-list__path">{{ formatPath(e.path) }}</code>
        <span class="error-list__code">{{ e.code }}</span>
        <span class="error-list__msg">{{ messageOf(e) }}</span>
      </li>
    </ol>

    <div v-if="dropped.length > 0" class="dropped">
      <header class="dropped__head">URL 反序列化时丢弃的节点</header>
      <ol class="error-list">
        <li v-for="(d, i) in dropped" :key="i" class="error-list__item">
          <code class="error-list__path">{{ formatPath(d.path) }}</code>
          <span class="error-list__code">{{ d.reason }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
  overflow: auto;
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
.tab-pane__empty {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  padding: 18px;
  background: var(--surface-deep);
  border-radius: 6px;
}
.error-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.error-list__item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  background: var(--danger-soft);
  border-radius: 6px;
  font-size: 12px;
}
.error-list__path {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface);
  border-radius: 3px;
  padding: 2px 6px;
  color: var(--text-strong);
}
.error-list__code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--danger);
  font-weight: 600;
}
.error-list__msg {
  color: var(--text-strong);
}
.dropped {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dropped__head {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: 600;
}
</style>
