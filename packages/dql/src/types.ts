// DQL package internal types. Kept separate from @dql-kit/core's types
// because the lex/parse/LSP layers introduce concepts that don't belong
// in core (text ranges, tokens, diagnostics in editor coordinates).
//
// Public types are re-exported via index.ts. Anything that talks about
// text offsets, tokens, or LSP-shaped responses lives here.

import type { IdFetcher, NodePath } from '@dql-kit/core'

// ---------------------------------------------------------------------------
// Text positions
// ---------------------------------------------------------------------------

/**
 * Half-open text range, CodeMirror convention: `from` inclusive, `to`
 * exclusive. Both values are 0-based offsets into the document.
 */
export type TextRange = { from: number, to: number }

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Token kinds emitted by the lexer.
 *
 * Lexer is **schema-free** (Q9): op names, unit names and field names
 * all surface as `IDENTIFIER` — the parser uses positional context to
 * decide whether a particular identifier is a field, op, or unit.
 *
 * Reserved words (`and`, `or`, `true`, `false`, `not`) are the only
 * identifiers the lexer distinguishes structurally — they are checked
 * case-sensitively against the lowercase form (Q8).
 */
export type TokenKind =
  // Reserved keywords (Q8)
  | 'AND'
  | 'OR'
  | 'TRUE'
  | 'FALSE'
  | 'NOT'
  // Identifiers (field / op / unit — disambiguated by parser position)
  | 'IDENTIFIER'
  // Literals
  | 'NUMBER'
  | 'STRING'
  // Operators / punctuation
  | 'EQ'           // =
  | 'NEQ'          // !=
  | 'RANGE'        // ..
  | 'COMMA'        // ,
  | 'LPAREN'       // (
  | 'RPAREN'       // )
  | 'LBRACK'       // [
  | 'RBRACK'       // ]
  // Sentinel for parse error recovery — never produced for legal input.
  | 'INVALID'

/**
 * A lexed token. `value` is the source text slice for IDENTIFIER /
 * INVALID, the unescaped string for STRING, the numeric value for
 * NUMBER, and `null` for fixed-spelling tokens (the spelling is
 * determined by `kind`).
 */
export type Token = {
  kind: TokenKind
  range: TextRange
  /**
   * - STRING: parsed value with escapes resolved
   * - NUMBER: parsed numeric value
   * - IDENTIFIER / INVALID: raw source slice
   * - All other kinds: null
   */
  value: string | number | null
}

// ---------------------------------------------------------------------------
// Source map (Q9)
// ---------------------------------------------------------------------------

/**
 * Per-condition sub-ranges so diagnostics can highlight the precise
 * token that triggered an error (`unknown_field` → field range,
 * `op_not_allowed` → op range, `value_type_mismatch` → value range).
 *
 * `whole` always covers the entire condition span (including missing
 * tokens — used as the fallback / for `incomplete` errors).
 */
export type ConditionRanges = {
  whole: TextRange
  field?: TextRange
  op?: TextRange
  value?: TextRange
}

export type GroupRanges = {
  whole: TextRange
}

/**
 * RangeMap key is `path.join('.')` so it lines up with
 * `ValidationError.path` from `@dql-kit/core` directly. Empty string is
 * the root group.
 */
export type RangeMap = Map<string, ConditionRanges | GroupRanges>

export const pathKey = (path: NodePath): string => path.join('.')

// ---------------------------------------------------------------------------
// Syntax diagnostics (parse-time)
// ---------------------------------------------------------------------------

/**
 * Stable codes for parser-level diagnostics. Schema-level errors come
 * from `@dql-kit/core`'s `ValidationError` and are *not* re-encoded
 * here — the LSP layer combines both streams.
 */
export type SyntaxDiagCode =
  | 'unexpected_token'
  | 'unclosed_string'
  | 'invalid_escape'
  | 'invalid_number'
  | 'mixed_combinator'        // `a and b or c` at one level (Q5)
  | 'unmatched_paren'
  | 'unmatched_bracket'
  | 'expected_range_endpoint' // `5..` or `..10` (Q6.5)
  | 'range_outside_between'   // `5..10` not after `between`
  | 'reserved_word_as_field'  // `and contains "x"`
  | 'unsupported_field_name'  // schema field key violates Q8 identifier rules
  | 'trailing_garbage'        // tokens after a complete document
  | 'expected_field'
  | 'expected_op'
  | 'expected_value'

export type SyntaxDiag = {
  range: TextRange
  code: SyntaxDiagCode
  message: string
}

// ---------------------------------------------------------------------------
// Parser output
// ---------------------------------------------------------------------------

/**
 * Parser output. Schema-free — contains everything needed to feed
 * either `analyze` (with a schema) or the LSP layer.
 *
 * `draft` is a `DraftAST` from `@dql-kit/core` so it shares the same
 * shape that `useFilter.draft` exposes — DQL editor and FilterBuilder
 * UI bind to the *same* object structure.
 */
export type ParseResult = {
  draft: import('@dql-kit/core').DraftAST
  ranges: RangeMap
  syntaxDiag: SyntaxDiag[]
}

// ---------------------------------------------------------------------------
// LSP-shaped types (Q10)
// ---------------------------------------------------------------------------

/**
 * Severity is a fixed three-level alphabet — matches CodeMirror's
 * `@codemirror/lint` directly, and is a strict subset of LSP's
 * `DiagnosticSeverity`. Mid-edit `incomplete` errors map to `'hint'`
 * by default (Q9) so they don't paint the buffer red while typing.
 */
export type Severity = 'error' | 'warning' | 'hint'

export type Diagnostic = {
  range: TextRange
  severity: Severity
  message: string
  /** Stable identifier — either a `SyntaxDiagCode` or a `ValidationError` code. */
  code: string
}

export type CompletionKind =
  | 'field'
  | 'op'
  | 'value'
  | 'keyword'
  | 'snippet'

export type CompletionItem = {
  label: string
  /** Optional secondary label shown to the right of `label`. */
  detail?: string
  /**
   * Inserted text. May contain CM6 snippet placeholders (`${0}`,
   * `${1:placeholder}`) — the dql-codemirror layer interprets them.
   */
  insertText: string
  kind: CompletionKind
  /**
   * Sort key — the LSP layer fills this with zero-padded source-order
   * indexes so completion clients don't reorder by label.
   */
  sortText?: string
  /** Custom filter text used by the client's fuzzy matcher. */
  filterText?: string
}

export type Hover = {
  range: TextRange
  /** Plain-text or markdown — adapter decides how to render. */
  contents: string
}

/**
 * Map of field-key → `IdFetcher`. Mirrors the `fetchers` argument of
 * `useFilter` (vue-headless owns the strict-typed variant; we use the
 * loose structural shape because the DQL package mustn't depend on
 * vue-headless). Fields without an entry simply skip async behaviour
 * — completion returns no value suggestions, hover shows the raw id.
 */
export type FetcherMap = Record<string, IdFetcher<string | number>>

/**
 * Context passed to every LSP provider. Schema is required (the
 * provider uses it to resolve fields and ops); `fetchers` is optional
 * and only consulted for `id`-typed fields. `offset` is the cursor's
 * 0-based offset.
 */
export type DqlContext = {
  schema: import('@dql-kit/core').FilterSchema
  text: string
  offset: number
  fetchers?: FetcherMap
  /**
   * Optional abort signal for asynchronous work (id-field `search` /
   * `resolve` calls). When present, providers must abort their
   * fetchers if the signal fires.
   */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Tunables for the LSP layer. All have sensible defaults so callers
 * generally pass `{}`.
 */
export type DqlOptions = {
  /**
   * Debounce window in milliseconds for id-field `search()` calls
   * during completion. Default `150ms` (Q11) — separate from
   * `useFilter.debounceMs` (default 250ms) on purpose.
   */
  searchDebounceMs?: number
  /**
   * Severity for `incomplete` ValidationErrors. `'hint'` (default)
   * keeps the editor calm while typing; `'error'` is stricter for
   * non-interactive validation.
   */
  incompleteSeverity?: Severity
}

export const DEFAULT_DQL_OPTIONS: Required<DqlOptions> = {
  searchDebounceMs: 150,
  incompleteSeverity: 'hint',
}
