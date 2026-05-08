<script setup lang="ts">
// Monaco implementation of the DQL editor — registers the language
// + completion / hover / markers / semantic-token providers via
// `@dql-kit/dql-monaco`, then drives the same `filter.draft` ref under
// the same focus-arbitration rules (Q14) used by the CodeMirror variant.

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { astEqual, prune, type FilterSchema } from '@dql-kit/core'
import { format, parse, type FetcherMap } from '@dql-kit/dql'
import {
  DQL_LANGUAGE_ID,
  createDqlContribution,
  registerDqlLanguage,
  type DqlContribution,
} from '@dql-kit/dql-monaco'
import './monacoEnvironment.ts'
import * as monaco from 'monaco-editor'
import { usePlaygroundStore } from '../../store.ts'

const store = usePlaygroundStore()
const editorEl = ref<HTMLDivElement | null>(null)

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model:  monaco.editor.ITextModel | null = null
let attachment: monaco.IDisposable | null = null
let contribution: DqlContribution | null = null
let updatingFromDraft = false

// Live getters — providers close over these so schema / fetcher changes
// take effect without re-registering.
const getSchema = (): FilterSchema | null =>
  (store.filter.value.schema.value as FilterSchema | undefined) ?? null
const getFetchers = (): FetcherMap =>
  (store.filter.value.fetchers ?? {}) as FetcherMap

const mount = (): void => {
  if (!editorEl.value) return
  const schema = getSchema()
  if (!schema) return

  registerDqlLanguage(monaco)

  contribution = createDqlContribution({
    monaco,
    schema:   () => getSchema(),
    fetchers: () => getFetchers(),
  })

  const initialText = format(store.filter.value.draft.value, schema)
  model = monaco.editor.createModel(initialText, DQL_LANGUAGE_ID)

  attachment = contribution.attach(model)

  editor = monaco.editor.create(editorEl.value, {
    model,
    automaticLayout: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    minimap: { enabled: false },
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 8,
    lineNumbersMinChars: 0,
    scrollbar: { vertical: 'auto', horizontal: 'auto' },
    overviewRulerLanes: 0,
    wordWrap: 'on',
    padding: { top: 10, bottom: 10 },
    renderLineHighlight: 'none',
    'semanticHighlighting.enabled': true,
    bracketPairColorization: { enabled: true },
    // Hover/suggestion popups must escape the editor's overflow box —
    // the tab pane wraps the editor in `overflow: hidden` for the
    // rounded border, which would otherwise clip them. With this flag
    // Monaco mounts overflow widgets to a `position:fixed` node at
    // document.body.
    fixedOverflowWidgets: true,
    suggest: {
      // Snippets are how we deliver value placeholders ($0..$1 etc.) —
      // make sure they're enabled and visible.
      snippetsPreventQuickSuggestions: false,
    },
  })

  const flushParseToDraft = (): void => {
    if (updatingFromDraft || !model) return
    const sch = getSchema()
    if (!sch) return
    const next = parse(model.getValue()).draft
    if (!astEqual(prune(next, sch), prune(store.filter.value.draft.value, sch))) {
      store.filter.value.draft.value = next
    }
  }

  // Buffer → draft (Q14: focus → buffer is truth).
  model.onDidChangeContent(flushParseToDraft)

  // ADR Q14: focus loss flushes pending buffer state to `draft`
  // immediately. Defensive belt — today the parse already runs per
  // keystroke, but if a debounce layer is added later, blur should
  // still commit the last keystrokes.
  editor.onDidBlurEditorWidget(flushParseToDraft)
}

const teardown = (): void => {
  attachment?.dispose(); attachment = null
  contribution?.dispose(); contribution = null
  editor?.dispose(); editor = null
  model?.dispose();  model  = null
}

onMounted(() => mount())
onBeforeUnmount(() => teardown())

// Q14 reverse direction: external draft writes reformat the buffer
// only when the editor has no focus.
watch(
  () => store.filter.value.draft.value,
  (newDraft) => {
    if (!editor || !model) return
    if (editor.hasTextFocus()) return
    const schema = getSchema()
    if (!schema) return
    const text = format(newDraft, schema)
    if (text === model.getValue()) return
    updatingFromDraft = true
    try {
      model.setValue(text)
    } finally {
      updatingFromDraft = false
    }
  },
  { deep: true },
)

// Schema replacement: dispose & rebuild. Providers are namespaced by
// language id, so the new contribution will register fresh providers.
// `nextTick` waits for Vue's reactive flush so the new schema is in
// place before the rebuilt providers close over it.
watch(
  () => store.filter.value,
  () => {
    teardown()
    void nextTick(() => mount())
  },
)
</script>

<template>
  <div ref="editorEl" class="monaco-editor-host" />
</template>

<style scoped>
.monaco-editor-host {
  flex: 1 1 auto;
  min-height: 200px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-deep);
  overflow: hidden;
}
</style>
