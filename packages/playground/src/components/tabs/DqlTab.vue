<script setup lang="ts">
// Hosts the DQL editor with a toggle between the CodeMirror and Monaco
// implementations. Both editors bind to the same `filter.draft` ref via
// the shared playground store, so switching engines preserves the
// currently-edited filter.

import { ref, computed, defineAsyncComponent } from 'vue'

type Engine = 'codemirror' | 'monaco'

// Persist last-chosen engine across reloads.
const ENGINE_STORAGE_KEY = 'dql-kit/playground/engine'
const readEngine = (): Engine => {
  try {
    const saved = window.localStorage.getItem(ENGINE_STORAGE_KEY)
    return saved === 'monaco' ? 'monaco' : 'codemirror'
  } catch {
    return 'codemirror'
  }
}
const writeEngine = (e: Engine): void => {
  try { window.localStorage.setItem(ENGINE_STORAGE_KEY, e) } catch { /* ignore */ }
}

const engine = ref<Engine>(readEngine())

const setEngine = (e: Engine): void => {
  engine.value = e
  writeEngine(e)
}

// Lazy-load both editor variants so the bigger engine (Monaco, with
// its workers + tokenizer bundle) only ships when the user picks it.
const CodeMirrorEditor = defineAsyncComponent(
  () => import('../dql/DqlEditorCodeMirror.vue'),
)
const MonacoEditor = defineAsyncComponent(
  () => import('../dql/DqlEditorMonaco.vue'),
)

const currentEditor = computed(() =>
  engine.value === 'monaco' ? MonacoEditor : CodeMirrorEditor,
)
</script>

<template>
  <div class="tab-pane">
    <div class="tab-pane__head">
      <p class="tab-pane__hint">
        DQL（Dou Query Language）— 文本编辑器与 FilterBuilder 共享 <code>filter.draft</code>。
      </p>
      <div class="engine-switch" role="tablist" aria-label="DQL editor engine">
        <button
          class="engine-switch__btn"
          :class="{ 'engine-switch__btn--active': engine === 'codemirror' }"
          role="tab"
          :aria-selected="engine === 'codemirror'"
          type="button"
          @click="setEngine('codemirror')"
        >
          CodeMirror
        </button>
        <button
          class="engine-switch__btn"
          :class="{ 'engine-switch__btn--active': engine === 'monaco' }"
          role="tab"
          :aria-selected="engine === 'monaco'"
          type="button"
          @click="setEngine('monaco')"
        >
          Monaco
        </button>
      </div>
    </div>

    <component :is="currentEditor" :key="engine" />

    <p class="tab-pane__hint tab-pane__hint--small">
      支持：字段 / 操作符 / 值的补全（按 ↑↓Enter）；不完整条件以提示形式高亮；
      括号、数组、字符串自动配对。已知限制：UI 中半完成的条件不会出现在文本里（v1）。
    </p>
  </div>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 10px;
}
.tab-pane__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.tab-pane__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
  flex: 1 1 auto;
}
.tab-pane__hint--small {
  font-size: 11px;
}
.tab-pane__hint code {
  font-family: var(--font-mono);
  background: var(--surface-deep);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--text-strong);
}
.engine-switch {
  display: inline-flex;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-deep);
}
.engine-switch__btn {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
  line-height: 1.4;
}
.engine-switch__btn + .engine-switch__btn {
  border-left: 1px solid var(--border);
}
.engine-switch__btn:hover {
  color: var(--text-strong);
}
.engine-switch__btn--active {
  background: var(--surface);
  color: var(--text-strong);
  font-weight: 500;
}
</style>
