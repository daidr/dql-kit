<script setup lang="ts">
// CodeMirror 6 implementation of the DQL editor. Bound to the store's
// shared `filter.draft` ref via focus arbitration (Q14):
//   - editor focused  → buffer truth, draft derived (debounced parse)
//   - editor blurred  → draft truth, buffer reformatted on external writes

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { lintGutter } from '@codemirror/lint'
import { astEqual, prune, type DraftAST, type FilterSchema } from '@dql-kit/core'
import { format, parse, type FetcherMap } from '@dql-kit/dql'
import {
  defaultDqlTheme,
  dql,
  dqlCompletion,
  dqlHover,
  dqlLinter,
} from '@dql-kit/dql-codemirror'
import { usePlaygroundStore } from '../../store.ts'

const store = usePlaygroundStore()
const editorEl = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let updatingFromDraft = false

const getSchema = (): FilterSchema | null =>
  (store.filter.value.schema.value as FilterSchema | undefined) ?? null
const getFetchers = (): FetcherMap =>
  (store.filter.value.fetchers ?? {}) as FetcherMap

const flushParseToDraft = (
  text: string,
  schema: FilterSchema,
  draftRef: { value: DraftAST },
): void => {
  const next = parse(text).draft
  if (!astEqual(prune(next, schema), prune(draftRef.value, schema))) {
    draftRef.value = next
  }
}

const buildExtensions = (
  schema: FilterSchema,
  fetchers: FetcherMap,
  draftRef: { value: DraftAST },
): Extension[] => [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap]),
  closeBrackets(),
  EditorView.lineWrapping,
  lintGutter(),
  dql({ schema }),
  dqlLinter({ schema }),
  dqlCompletion({ schema, fetchers }),
  dqlHover({ schema, fetchers }),
  defaultDqlTheme,
  EditorView.updateListener.of((update) => {
    if (!update.docChanged || updatingFromDraft) return
    flushParseToDraft(update.state.doc.toString(), schema, draftRef)
  }),
  // ADR Q14: focus loss flushes any pending buffer state to `draft`
  // immediately, bypassing any pending debounce. Today the parse runs
  // synchronously per keystroke, so this is a defensive belt: if a
  // future debouncing layer is introduced, the blur handler still
  // commits the last keystrokes before downstream watchers see the
  // draft change.
  EditorView.focusChangeEffect.of((state, focusing) => {
    if (!focusing && !updatingFromDraft) {
      flushParseToDraft(state.doc.toString(), schema, draftRef)
    }
    return null
  }),
]

const mount = (): void => {
  if (!editorEl.value) return
  const schema = getSchema()
  if (!schema) return
  const filter = store.filter.value
  view = new EditorView({
    parent: editorEl.value,
    state: EditorState.create({
      doc: format(filter.draft.value, schema),
      extensions: buildExtensions(schema, getFetchers(), filter.draft),
    }),
  })
}

onMounted(() => mount())
onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => store.filter.value.draft.value,
  (newDraft) => {
    if (!view) return
    if (view.hasFocus) return
    const schema = getSchema()
    if (!schema) return
    const text = format(newDraft, schema)
    if (text === view.state.doc.toString()) return
    updatingFromDraft = true
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
    } finally {
      updatingFromDraft = false
    }
  },
  { deep: true },
)

// Schema replacement (user edited the spec) requires a full editor
// rebuild — every dql/dqlLinter/etc. extension closes over the schema.
// `nextTick` waits for Vue's reactive flush (so `store.filter.value`
// resolves to the new instance before mount reads it); a bare
// queueMicrotask could fire before child-prop patches settle.
watch(
  () => store.filter.value,
  () => {
    view?.destroy()
    view = null
    void nextTick(() => mount())
  },
)
</script>

<template>
  <div ref="editorEl" class="cm-editor-host" />
</template>

<style scoped>
.cm-editor-host {
  flex: 1 1 auto;
  min-height: 200px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-deep);
  overflow: hidden;
}
.cm-editor-host :deep(.cm-editor) {
  height: 100%;
  font-family: var(--font-mono);
  font-size: 13px;
}
.cm-editor-host :deep(.cm-content) {
  padding: 12px;
}
.cm-editor-host :deep(.cm-focused) {
  outline: none;
}
.cm-editor-host :deep(.cm-tooltip-hover) {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-strong);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
</style>
