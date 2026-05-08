<script setup lang="ts">
import { computed } from 'vue'
import { usePlaygroundStore } from '../store.ts'
import { defaultSpec } from '../utils/schemaSpec.ts'

const store = usePlaygroundStore()

const dirty = computed(() => {
  if (!store.parsedSpec.value.ok) return true
  return (
    JSON.stringify(store.parsedSpec.value.value)
    !== JSON.stringify(store.appliedSpec.value)
  )
})

const error = computed(() =>
  store.parsedSpec.value.ok ? null : store.parsedSpec.value.error,
)

const onApply = () => store.applySpec()
const onReset = () => store.resetSpec()
const onLoadDefault = () => {
  store.specText.value = JSON.stringify(defaultSpec, null, 2)
}
</script>

<template>
  <section class="schema-editor">
    <header class="schema-editor__head">
      <div class="schema-editor__title">
        <span>Schema</span>
        <span v-if="dirty" class="schema-editor__badge">未应用</span>
      </div>
      <div class="schema-editor__actions">
        <button type="button" class="btn btn--ghost" @click="onLoadDefault">
          载入默认
        </button>
        <button type="button" class="btn btn--ghost" @click="onReset">
          重置
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!!error || !dirty"
          @click="onApply"
        >
          应用
        </button>
      </div>
    </header>

    <textarea
      v-model="store.specText.value"
      class="schema-editor__input"
      spellcheck="false"
      autocorrect="off"
      autocapitalize="off"
    />

    <p v-if="error" class="schema-editor__error">{{ error }}</p>

    <footer class="schema-editor__hint">
      支持的字段类型：<code>string</code> · <code>number</code> ·
      <code>boolean</code> · <code>enum</code> · <code>date</code> ·
      <code>datetime</code> · <code>id</code> · <code>array</code>
    </footer>
  </section>
</template>

<style scoped>
.schema-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 12px 14px;
}
.schema-editor__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.schema-editor__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  display: flex;
  gap: 8px;
  align-items: center;
}
.schema-editor__badge {
  font-size: 10px;
  letter-spacing: 0;
  text-transform: none;
  background: var(--accent-soft);
  color: var(--accent-strong);
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}
.schema-editor__actions {
  display: flex;
  gap: 6px;
}
.schema-editor__input {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--surface-deep);
  color: var(--text-strong);
  outline: none;
  transition: border-color 120ms ease;
}
.schema-editor__input:focus {
  border-color: var(--accent-strong);
}
.schema-editor__error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
  font-family: var(--font-mono);
  white-space: pre-wrap;
  background: var(--danger-soft);
  border-radius: 6px;
  padding: 8px 10px;
}
.schema-editor__hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.schema-editor__hint code {
  font-family: var(--font-mono);
  background: var(--surface-deep);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--text-strong);
}
</style>
