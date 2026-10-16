<script setup lang="ts">
import { computed } from 'vue'
import { usePlaygroundStore } from '../../store.ts'
import { buildSchemaFromSpec } from '../../utils/schemaSpec.ts'
import { previewSql } from '../../utils/sqlPreview.ts'

const store = usePlaygroundStore()

const result = computed(() =>
  previewSql(
    buildSchemaFromSpec(store.appliedSpec.value),
    store.filter.value.valid.value,
  ),
)
</script>

<template>
  <div class="tab-pane">
    <p class="tab-pane__hint">
      通过 <code>@dql-kit/drizzle-pg</code> 翻译为 PostgreSQL 方言。表与列均为根据 schema 动态构造的虚拟模型。
    </p>

    <template v-if="result.ok">
      <pre class="sql"><code>{{ result.sql }}</code></pre>
      <div class="params">
        <header class="params__head">参数</header>
        <pre v-if="result.params.length > 0"><code>{{ JSON.stringify(result.params, null, 2) }}</code></pre>
        <div v-else class="params__empty">— 无 —</div>
      </div>
    </template>
    <template v-else>
      <div class="error">{{ result.error }}</div>
    </template>
  </div>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 10px;
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
.sql {
  margin: 0;
  padding: 12px 14px;
  background: var(--surface-deep);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-strong);
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--border);
}
.params {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.params__head {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: 600;
}
.params pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--surface-deep);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-strong);
}
.params__empty {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 12px;
}
.error {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--danger);
  background: var(--danger-soft);
  padding: 12px;
  border-radius: 6px;
  white-space: pre-wrap;
}
</style>
