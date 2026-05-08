// CodeMirror autocompletion source — feeds our `provideCompletions`
// into `@codemirror/autocomplete`.
//
// Notable adapter behaviours:
//   - `insertText` may contain CM6 snippet placeholders (`$0`,
//     `${1:placeholder}`); we convert items containing `$` into
//     snippet completions via `snippetCompletion`.
//   - Activation characters: extra triggers beyond the default
//     identifier characters — space, `[`, `(`, `,`, `"`, `'`,
//     and `=` — so the user gets immediate suggestions after a
//     field, op, or `[` literal.
//   - Space-trigger applies the CM `selected: 'auto'` behaviour
//     so a single-result field/op list auto-fills.

import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import {
  provideCompletions,
  type CompletionItem,
  type FetcherMap,
} from '@dql-kit/dql'
import type { FilterSchema } from '@dql-kit/core'

const TRIGGER_CHARS = [' ', '[', '(', ',', '"', '\'', '=']

export type DqlCompletionOptions = {
  schema: FilterSchema
  /**
   * Field-key → IdFetcher map. Required for id-field value completion
   * (Q11). Mirrors the `fetchers` argument of `useFilter`. When a
   * field has no fetcher entry, that field's value slot returns
   * empty (the user can still type a raw id manually).
   */
  fetchers?: FetcherMap
  /** Debounce ms for id-field `search()` calls (default: 150). */
  searchDebounceMs?: number
}

/**
 * Build a CodeMirror autocompletion extension powered by
 * `@dql-kit/dql`'s slot-aware completion API.
 */
export const dqlCompletion = (opts: DqlCompletionOptions): Extension =>
  autocompletion({
    override: [makeSource(opts)],
    activateOnTyping: true,
    closeOnBlur: false,
  })

const makeSource = (opts: DqlCompletionOptions): CompletionSource => {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const text = ctx.state.doc.toString()
    const offset = ctx.pos

    // Determine a token-replace range — CM6 needs an explicit `from`
    // to drive the inserted-text positioning. We use the start of the
    // current word, falling back to `pos` when there's no word.
    const word = ctx.matchBefore(/[a-zA-Z_0-9]+/)

    // Skip auto-pop when there's no triggering context: not at the
    // start of identifier / not after a trigger char / not explicit.
    if (!ctx.explicit) {
      const prevChar = text[offset - 1] ?? ''
      const triggerOk = TRIGGER_CHARS.includes(prevChar) || word !== null
      if (!triggerOk) return null
    }

    // CodeMirror exposes `aborted` (boolean) on the completion context
    // — wire it into an AbortController so id-fetcher `search()` calls
    // are cancelled when the user types past this completion or closes
    // the popup. Avoids leaving stale fetchers in flight, parity with
    // the Monaco adapter.
    const ac = new AbortController()
    const probeAborted = (): void => {
      if (ctx.aborted) ac.abort()
    }
    probeAborted()

    let items: CompletionItem[]
    try {
      items = await provideCompletions(text, offset, opts.schema, {
        fetchers: opts.fetchers,
        signal: ac.signal,
      })
    } catch {
      return null
    }
    probeAborted()
    if (items.length === 0) return null

    return {
      from: word ? word.from : offset,
      to: offset,
      options: items.map(toCmCompletion),
      // Allow typed quotes / dots / commas / spaces to keep the
      // completion live. The previous `[\w-]` set excluded the chars
      // a user types when entering a string / list literal, so the
      // popup re-fired its source unnecessarily on every quote.
      validFor: /^[\w\-"'., ]*$/,
    }
  }
}

const toCmCompletion = (it: CompletionItem): Completion => {
  // CodeMirror runs its fuzzy match against `label` and uses
  // `displayLabel` (>= 6.7) for what's actually painted in the popup
  // row. We promote our `filterText` into `label` so users can match
  // by either the human-readable name OR the id literal (mirrors
  // Monaco's `filterText` behaviour), and pass the original `label`
  // as `displayLabel` so the row renders cleanly.
  const filterLabel = it.filterText ?? it.label
  const displayLabel = it.label
  if (it.insertText.includes('$')) {
    return snippetCompletion(it.insertText, {
      label: filterLabel,
      displayLabel,
      detail: it.detail,
      type: typeFromKind(it.kind),
      boost: it.sortText ? -parseInt(it.sortText, 10) : 0,
    })
  }
  return {
    label: filterLabel,
    displayLabel,
    detail: it.detail,
    apply: it.insertText,
    type: typeFromKind(it.kind),
    boost: it.sortText ? -parseInt(it.sortText, 10) : 0,
  }
}

const typeFromKind = (kind: CompletionItem['kind']): string | undefined => {
  switch (kind) {
    case 'field':   return 'variable'
    case 'op':      return 'function'
    case 'value':   return 'enum'
    case 'keyword': return 'keyword'
    case 'snippet': return 'text'
  }
}
