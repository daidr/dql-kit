<script setup lang="ts">
import { createMatcher, parseAst } from '@dql-kit/core'
import { computed } from 'vue'
import { usePlaygroundStore } from '../../store.ts'
import { buildSampleRows } from '../../utils/sampleRows.ts'
import { buildSchemaFromSpec } from '../../utils/schemaSpec.ts'

const store = usePlaygroundStore()

const schema = computed(() => buildSchemaFromSpec(store.appliedSpec.value))
const rows = computed(() => buildSampleRows(store.appliedSpec.value))
const columns = computed(() => Object.keys(store.appliedSpec.value.fields))

const result = computed(() => {
  const parsed = parseAst(store.filter.value.valid.value, schema.value)
  if (!parsed.ok) return { ok: false as const, error: JSON.stringify(parsed.errors, null, 2) }
  try {
    const matcher = createMatcher({ schema: schema.value })
    const ids = new Set(matcher.filter(parsed.ast, rows.value).map((r) => r.id))
    return { ok: true as const, ids }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

const display = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL'
  if (v === '') return "''"
  if (Array.isArray(v)) return `[${v.join(', ')}]`
  return String(v)
}
</script>

<template>
  <div class="tab-pane">
    <p class="tab-pane__hint">
      用 <code>createMatcher</code> 在内存中对样例数据求值，高亮命中的行。与 SQL 翻译遵循同一套 op 语义；
      样例数据按 schema 生成，每 5 行有一行全为 NULL。
    </p>
    <template v-if="result.ok">
      <p class="summary">命中 {{ result.ids.size }} / {{ rows.length }} 行</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th v-for="c in columns" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" :class="{ hit: result.ids.has(r.id) }">
              <td>{{ r.id }}</td>
              <td
                v-for="c in columns"
                :key="c"
                :class="{ null: r[c] === null || r[c] === undefined }"
              >{{ display(r[c]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <div v-else class="error">{{ result.error }}</div>
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
.summary {
  margin: 0;
  font-size: 12px;
  color: var(--text-strong);
  font-weight: 600;
}
.table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
}
th, td {
  padding: 5px 8px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
th {
  position: sticky;
  top: 0;
  background: var(--surface-deep);
  color: var(--text-muted);
  font-weight: 600;
}
tr:not(.hit) td {
  color: var(--text-muted);
  opacity: 0.55;
}
tr.hit td {
  color: var(--text-strong);
}
tr.hit td:first-child {
  box-shadow: inset 3px 0 0 var(--accent-strong);
}
td.null {
  font-style: italic;
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
