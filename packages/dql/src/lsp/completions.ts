// Slot-aware completions for the DQL editor.
//
// The classifier walks tokens left-to-right and tracks a small state
// machine to know what kind of input the user is currently typing
// (field / op / value / list element / unit / continuation). For each
// slot, the source layer queries the schema (fields, ops, enum values,
// id fetcher, etc.) and produces `CompletionItem`s.
//
// All sort orders use zero-padded indexes from the natural source
// order — schema declaration order for fields, `field.ops` order for
// ops, `enumValues` order for enums, etc. The LSP `sortText` keeps the
// client's fuzzy matcher from re-ranking.

import type {
  FieldDef,
  FilterSchema,
  OpDef,
  ValueShape,
} from '@dql-kit/core'
import { isIdField } from '@dql-kit/core'
import { lex } from '../lex.ts'
import type {
  CompletionItem,
  DqlOptions,
  FetcherMap,
  TextRange,
  Token,
  TokenKind,
} from '../types.ts'
import { DEFAULT_DQL_OPTIONS } from '../types.ts'

// Singular + plural unit forms — `unit` slot offers both.
const UNIT_OPTIONS = [
  'minute', 'minutes',
  'hour',   'hours',
  'day',    'days',
  'week',   'weeks',
  'month',  'months',
] as const

// ---------------------------------------------------------------------------
// Slot classification
// ---------------------------------------------------------------------------

type Slot =
  | 'field'
  | 'op'
  | 'value'
  | 'list_element'
  | 'unit'
  | 'continuation'
  | 'unknown'

type SlotContext = {
  slot: Slot
  /** Field in scope (for `op` / `value` / `list_element` / `unit`). */
  fieldName?: string
  /** Op in scope (for `value` / `list_element` / `unit`). */
  opName?: string
  /** Cursor is *inside* a string literal (replaces the partial value). */
  inString?: boolean
  /** Range to be replaced by the inserted completion (the partial token). */
  partialRange?: TextRange
  /** Text already typed in the partial slot — fed to the matcher. */
  partialText?: string
}

/** Optional bag of behaviour tunables for a single completion call. */
export type ProvideCompletionsOptions = {
  /** Fetcher map for id-typed fields (Q11 — async value source). */
  fetchers?: FetcherMap
  /** Misc options (see `DqlOptions`). */
  opts?: DqlOptions
  /** Abort signal forwarded to id-fetcher `search()` calls. */
  signal?: AbortSignal
}

/** Public entry point for completions. */
export const provideCompletions = async (
  text: string,
  offset: number,
  schema: FilterSchema,
  options: ProvideCompletionsOptions = {},
): Promise<CompletionItem[]> => {
  void DEFAULT_DQL_OPTIONS // keep import non-dead until options are wired
  void options.opts        // ditto
  const ctx = classifySlot(text, offset)
  const { fetchers, signal } = options

  switch (ctx.slot) {
    case 'field':        return fieldCompletions(schema, ctx)
    case 'op':           return opCompletions(schema, ctx)
    case 'value':        return await valueCompletions(schema, ctx, fetchers, signal)
    case 'list_element': return await valueCompletions(schema, ctx, fetchers, signal)
    case 'unit':         return unitCompletions(ctx)
    case 'continuation': return continuationCompletions()
    case 'unknown':      return []
  }
}

/**
 * Walk the token stream up to (but not into) `offset` and return the
 * slot the cursor sits in, plus enough surrounding info for the source
 * layer to query the schema.
 */
const classifySlot = (text: string, offset: number): SlotContext => {
  const { tokens } = lex(text)

  let containing: Token | undefined
  let cutoff = tokens.length
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.range.from <= offset && offset < t.range.to) {
      containing = t
      cutoff = i
      break
    }
    // Cursor at the *end* of an identifier counts as partial input —
    // user is mid-typing the token, e.g. `publishedAt inLast 7 d|`.
    if (offset === t.range.to && t.kind === 'IDENTIFIER') {
      containing = t
      cutoff = i
      break
    }
    // Same for an *unclosed* string literal — the cursor is still
    // logically inside the string. A closed string ends with a matching
    // quote char; an unclosed one doesn't.
    if (offset === t.range.to && t.kind === 'STRING') {
      const last = text[t.range.to - 1]
      if (last !== '"' && last !== '\'') {
        containing = t
        cutoff = i
        break
      }
    }
    if (t.range.to <= offset) {
      cutoff = i + 1
    } else {
      cutoff = i
      break
    }
  }
  const before = tokens.slice(0, cutoff)

  // ---- cursor inside a string literal ----------------------------------
  if (containing?.kind === 'STRING') {
    const machine = runStateMachine(before)
    const partialText =
      typeof containing.value === 'string'
        ? containing.value.slice(0, Math.max(0, offset - containing.range.from - 1))
        : ''
    return {
      slot: machine.expecting === 'value' || machine.expecting === 'list_element'
        ? machine.expecting
        : 'value',
      fieldName: machine.fieldName,
      opName: machine.opName,
      inString: true,
      partialRange: containing.range,
      partialText,
    }
  }

  // ---- cursor inside an IDENTIFIER (partial) ---------------------------
  if (containing?.kind === 'IDENTIFIER') {
    const machine = runStateMachine(before)
    const partialText = (containing.value as string) ?? ''
    return {
      slot: machine.expecting,
      fieldName: machine.fieldName,
      opName: machine.opName,
      partialRange: containing.range,
      partialText,
    }
  }

  // ---- cursor in whitespace / between tokens ---------------------------
  const machine = runStateMachine(before)
  return {
    slot: machine.expecting,
    fieldName: machine.fieldName,
    opName: machine.opName,
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type State =
  | 'field'              // expecting field name
  | 'op'                 // expecting op (after field)
  | 'value'              // expecting scalar / list / range
  | 'after_scalar_value' // scalar consumed; next could be RANGE / unit / connector / RBRACK / EOF
  | 'continuation'       // condition complete; expecting AND/OR
  | 'list_element'       // inside [], expecting element
  | 'list_separator'     // inside [], element consumed; expecting , or ]

type Machine = {
  expecting: Slot
  fieldName?: string
  opName?: string
}

const runStateMachine = (tokens: Token[]): Machine => {
  let state: State = 'field'
  let fieldName: string | undefined
  let opName: string | undefined

  const reset = (): void => {
    state = 'field'
    fieldName = undefined
    opName = undefined
  }

  for (const t of tokens) {
    state = step(t, state, {
      setField: (n) => { fieldName = n },
      setOp: (n) => { opName = n },
      reset,
    })
  }

  // Map internal state to public slot.
  let expecting: Slot
  switch (state) {
    case 'field':              expecting = 'field';        break
    case 'op':                 expecting = 'op';           break
    case 'value':              expecting = 'value';        break
    case 'list_element':       expecting = 'list_element'; break
    case 'list_separator':     expecting = 'continuation'; break // close-or-and
    case 'after_scalar_value':
      // After a NUMBER in `inLast` op-context, a unit identifier is
      // expected. Otherwise treat as continuation.
      expecting = opName === 'inLast' ? 'unit' : 'continuation'
      break
    case 'continuation':       expecting = 'continuation'; break
  }
  return { expecting, fieldName, opName }
}

type StateActions = {
  setField: (name: string) => void
  setOp: (name: string) => void
  reset: () => void
}

const step = (t: Token, state: State, a: StateActions): State => {
  const k = t.kind

  switch (state) {
    case 'field':
      if (k === 'IDENTIFIER') { a.setField(t.value as string); return 'op' }
      if (k === 'LPAREN') return 'field'
      // Reserved-as-field is a parser error; classifier just stays.
      return 'field'

    case 'op':
      if (k === 'IDENTIFIER') { a.setOp(t.value as string); return 'value' }
      if (k === 'EQ')  { a.setOp('eq');  return 'value' }
      if (k === 'NEQ') { a.setOp('neq'); return 'value' }
      if (k === 'AND' || k === 'OR') { a.reset(); return 'field' }
      return 'op'

    case 'value':
      if (k === 'LBRACK') return 'list_element'
      if (k === 'STRING' || k === 'TRUE' || k === 'FALSE') return 'after_scalar_value'
      if (k === 'NUMBER') return 'after_scalar_value'
      if (k === 'AND' || k === 'OR') { a.reset(); return 'field' }
      return 'value'

    case 'after_scalar_value':
      if (k === 'RANGE') return 'value'
      if (k === 'IDENTIFIER') return 'continuation' // unit consumed
      if (k === 'AND' || k === 'OR') { a.reset(); return 'field' }
      if (k === 'RPAREN') return 'continuation'
      if (k === 'COMMA')  return 'list_element' // inside list, prev was scalar
      if (k === 'RBRACK') return 'continuation'
      return 'continuation'

    case 'continuation':
      if (k === 'AND' || k === 'OR') { a.reset(); return 'field' }
      if (k === 'RPAREN') return 'continuation'
      return 'continuation'

    case 'list_element':
      if (k === 'STRING' || k === 'NUMBER' || k === 'TRUE' || k === 'FALSE') {
        return 'list_separator'
      }
      if (k === 'RBRACK') return 'continuation'
      return 'list_element'

    case 'list_separator':
      if (k === 'COMMA')  return 'list_element'
      if (k === 'RBRACK') return 'continuation'
      return 'list_separator'
  }
}

// ---------------------------------------------------------------------------
// Source layers
// ---------------------------------------------------------------------------

const padIdx = (i: number): string => String(i).padStart(4, '0')

const fieldCompletions = (
  schema: FilterSchema,
  ctx: SlotContext,
): CompletionItem[] => {
  const out: CompletionItem[] = []
  let i = 0
  for (const [key, def] of Object.entries(schema.fields)) {
    out.push({
      label: key,
      detail: detailForField(def),
      // Trailing space + `${0}` cursor — the editor's auto-trigger
      // jumps to op slot immediately (Q11 decision).
      insertText: `${key} `,
      kind: 'field',
      sortText: padIdx(i++),
    })
  }
  return filterByPartial(out, ctx.partialText)
}

const detailForField = (def: FieldDef): string => {
  const label = typeof def.label === 'function' ? def.label() : def.label
  const ty = def.delegateTo ?? def.typeId
  return label ? `${label} — ${ty}` : ty
}

const opCompletions = (
  schema: FilterSchema,
  ctx: SlotContext,
): CompletionItem[] => {
  if (!ctx.fieldName) return []
  const field = schema.fields[ctx.fieldName]
  if (!field) return []

  const out: CompletionItem[] = []
  let i = 0
  for (const op of field.ops) {
    out.push({
      label: op.name,
      detail: opLabel(op),
      insertText: opInsertSnippet(op, field),
      kind: 'op',
      sortText: padIdx(i++),
    })
  }
  return filterByPartial(out, ctx.partialText)
}

const opLabel = (op: OpDef): string =>
  typeof op.label === 'function' ? op.label() : op.label

/**
 * Build the inserted text for an op selection. Includes a value
 * placeholder shaped to the op's valueShape (Q11) so the user is
 * dropped into the right next slot without thinking.
 */
const opInsertSnippet = (op: OpDef, field: FieldDef): string => {
  const eff = field.delegateTo ?? field.typeId
  const wantsString =
    eff === 'string' ||
    eff === 'date' ||
    eff === 'datetime' ||
    eff === 'enum' ||
    (eff === 'id' && true) // string-id default; numbers parse fine without quotes
  // For enums / ids of *number* type, callers will filter out the
  // wrong side via completion; the snippet just biases toward strings
  // because that's the more common dashboard case.
  switch (op.valueShape) {
    case 'none':
      return op.name
    case 'single':
      return wantsString ? `${op.name} "$0"` : `${op.name} $0`
    case 'pair':
      return wantsString
        ? `${op.name} "$1".."$2"`
        : `${op.name} $1..$2`
    case 'list':
      return wantsString ? `${op.name} ["$0"]` : `${op.name} [$0]`
    case 'relative':
      return `${op.name} $1 days`
  }
}

const valueCompletions = async (
  schema: FilterSchema,
  ctx: SlotContext,
  fetchers?: FetcherMap,
  signal?: AbortSignal,
): Promise<CompletionItem[]> => {
  if (!ctx.fieldName || !ctx.opName) return []
  const field = schema.fields[ctx.fieldName]
  if (!field) return []
  const op = field.ops.find((o) => o.name === ctx.opName)
  const eff = field.delegateTo ?? field.typeId

  // Boolean field → true/false
  if (eff === 'boolean') {
    return filterByPartial(
      [
        { label: 'true',  insertText: 'true',  kind: 'keyword', sortText: '0000' },
        { label: 'false', insertText: 'false', kind: 'keyword', sortText: '0001' },
      ],
      ctx.partialText,
    )
  }

  // Enum field → list enumValues
  if (eff === 'enum' && field.enumValues) {
    const out: CompletionItem[] = []
    let i = 0
    for (const e of field.enumValues) {
      const literal =
        typeof e.value === 'number' ? String(e.value) : `"${e.value}"`
      const valueLabel =
        typeof e.label === 'function' ? e.label()
        : (e.label ?? String(e.value))
      out.push({
        label: literal,
        detail: valueLabel,
        insertText: ctx.inString ? String(e.value) : literal,
        kind: 'value',
        sortText: padIdx(i++),
      })
    }
    return filterByPartial(out, ctx.partialText)
  }

  // Id field → run the externally-supplied fetcher's `search()`.
  if (eff === 'id' && isIdField(field)) {
    return await idCompletions(ctx, fetchers, signal)
  }

  // Date / datetime → snippet
  if (eff === 'date') {
    return [{
      label: 'YYYY-MM-DD',
      detail: 'ISO calendar date',
      insertText: ctx.inString ? '$0' : '"$0"',
      kind: 'snippet',
      sortText: '0000',
    }]
  }
  if (eff === 'datetime') {
    return [{
      label: 'YYYY-MM-DDTHH:mm:ssZ',
      detail: 'ISO instant',
      insertText: ctx.inString ? '$0' : '"$0"',
      kind: 'snippet',
      sortText: '0000',
    }]
  }

  // string / number — no fixed completions; let user type freely.
  // (Boolean is handled above; nothing else to suggest.)
  void op
  return []
}

const idCompletions = async (
  ctx: SlotContext,
  fetchers: FetcherMap | undefined,
  signal?: AbortSignal,
): Promise<CompletionItem[]> => {
  if (!ctx.fieldName) return []
  const fetcher = fetchers?.[ctx.fieldName]
  // No fetcher registered for this id field → nothing to suggest. The
  // user can still type a raw id manually (no completion ≠ no input).
  if (!fetcher || typeof fetcher.search !== 'function') return []

  const query = ctx.partialText ?? ''
  const ac = new AbortController()
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  let raw: unknown
  try {
    raw = await fetcher.search(query, ac.signal)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out: CompletionItem[] = []
  let i = 0
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as { id?: unknown, label?: unknown }
    if (r.id == null) continue
    const literal =
      typeof r.id === 'number' ? String(r.id) : `"${String(r.id)}"`
    const humanLabel =
      typeof r.label === 'string' && r.label.length > 0 ? r.label : literal

    // Promote the human-readable label to the primary `label` slot so
    // it's visible on every row of the completion popup (Monaco / CM
    // both render `detail` only for the active row, leaving non-active
    // rows showing the bare id otherwise — confusing for id fields).
    // The id literal moves to `detail` and is duplicated into
    // `filterText` so users can still type an id to find a row.
    out.push({
      label: humanLabel,
      detail: humanLabel === literal ? undefined : literal,
      insertText: ctx.inString ? String(r.id) : literal,
      filterText:
        humanLabel === literal
          ? humanLabel
          : `${humanLabel} ${literal}`,
      kind: 'value',
      sortText: padIdx(i++),
    })
  }
  return out
}

const unitCompletions = (ctx: SlotContext): CompletionItem[] => {
  let i = 0
  const out = UNIT_OPTIONS.map((u) => ({
    label: u,
    insertText: u,
    kind: 'keyword' as const,
    sortText: padIdx(i++),
  }))
  return filterByPartial(out, ctx.partialText)
}

const continuationCompletions = (): CompletionItem[] => [
  { label: 'and', insertText: 'and ', kind: 'keyword', sortText: '0000' },
  { label: 'or',  insertText: 'or ',  kind: 'keyword', sortText: '0001' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter items by a case-insensitive prefix on `label`. CodeMirror
 * does its own fuzzy match too, but pre-filtering tightens what the
 * user sees while typing partial identifiers.
 */
const filterByPartial = (
  items: CompletionItem[],
  partial: string | undefined,
): CompletionItem[] => {
  if (!partial) return items
  const lower = partial.toLowerCase()
  return items.filter((it) => it.label.toLowerCase().startsWith(lower))
}

// Internal export for tests.
export const __internal = { classifySlot }

/**
 * Token kind alias — keeps the file self-contained for test imports
 * without leaking parser internals through the public surface.
 */
export type _TokenKind = TokenKind
