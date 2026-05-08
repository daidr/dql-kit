<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value: unknown
  empty?: string
}>()

const formatted = computed(() => {
  try {
    return JSON.stringify(props.value, null, 2)
  } catch (err) {
    return `// 无法序列化: ${err instanceof Error ? err.message : String(err)}`
  }
})

const isEmpty = computed(() => {
  const v = props.value
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
})
</script>

<template>
  <div class="json-view">
    <pre v-if="!isEmpty"><code>{{ formatted }}</code></pre>
    <div v-else class="json-view__empty">{{ empty ?? '— 空 —' }}</div>
  </div>
</template>

<style scoped>
.json-view {
  height: 100%;
  overflow: auto;
  background: var(--surface-deep);
  border-radius: 6px;
}
.json-view pre {
  margin: 0;
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-strong);
  white-space: pre-wrap;
  word-break: break-word;
}
.json-view__empty {
  padding: 18px;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
</style>
