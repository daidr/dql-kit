// Per-instance Monaco contributions for DQL: completion + hover +
// markers + semantic tokens. All providers re-use the @dql-kit/dql
// pipeline so behaviour matches CodeMirror parity.
//
// Schema and fetchers are passed as *getters* so callers (Vue / React)
// can swap them without re-registering providers — closures read the
// latest values on each provider invocation.
//
// Returns a `DqlContribution` object with `attach(model)` (installs
// diagnostic auto-update on a specific model) and `dispose()` (tears
// down every registration this contribution created).

import type * as monacoNs from 'monaco-editor'
import { analyze, type FilterSchema, type ValidationError } from '@dql-kit/core'
import {
  format,
  lex,
  parse,
  pathKey,
  provideCompletions,
  provideHover,
  type CompletionItem,
  type ConditionRanges,
  type Diagnostic,
  type FetcherMap,
  type RangeMap,
  type Severity,
  type TextRange,
  type Token,
} from '@dql-kit/dql'
import { DQL_LANGUAGE_ID } from './language.ts'

export type DqlContributionOptions = {
  monaco: typeof monacoNs
  /** Live schema getter — called once per provider invocation. */
  schema: () => FilterSchema | null
  /** Live fetcher map getter (id-field value completion / hover label). */
  fetchers?: () => FetcherMap | undefined
  /** Marker source name surfaced in the editor's problems list. */
  markerOwner?: string
}

export type DqlContribution = {
  /** Install per-model diagnostic refresh on `onDidChangeContent`. */
  attach: (model: monacoNs.editor.ITextModel) => monacoNs.IDisposable
  /** Tear down every shared registration. */
  dispose: () => void
}

// Order is the contract for the SemanticTokensLegend — must NOT
// reorder without bumping clients.
const TOKEN_TYPES = [
  'variable',     // 0  — field name
  'operator',     // 1  — op identifier / EQ / NEQ
  'unit',         // 2  — relative unit (day, week, ...)
  'keyword',      // 3  — and / or / true / false / not
  'number',       // 4
  'string',       // 5
  'invalid',      // 6  — semantic-error overlay
] as const

const enum TokType {
  Variable = 0,
  Operator = 1,
  Unit     = 2,
  Keyword  = 3,
  Number   = 4,
  String   = 5,
  Invalid  = 6,
}

export const createDqlContribution = (
  opts: DqlContributionOptions,
): DqlContribution => {
  const monaco = opts.monaco
  const owner = opts.markerOwner ?? '@dql-kit/dql'
  const fetchersGetter = opts.fetchers ?? (() => undefined)
  const disposables: monacoNs.IDisposable[] = []

  // ---- Completion ----------------------------------------------------
  disposables.push(
    monaco.languages.registerCompletionItemProvider(DQL_LANGUAGE_ID, {
      // Trigger characters mirror the CodeMirror set (Q11).
      triggerCharacters: [' ', '[', '(', ',', '"', '\'', '='],
      async provideCompletionItems(model, position, _context, token) {
        const schema = opts.schema()
        if (!schema) return { suggestions: [] }
        const text = model.getValue()
        const offset = model.getOffsetAt(position)

        const ac = new AbortController()
        token.onCancellationRequested(() => ac.abort())

        let items: CompletionItem[]
        try {
          items = await provideCompletions(text, offset, schema, {
            fetchers: fetchersGetter(),
            signal: ac.signal,
          })
        } catch {
          return { suggestions: [] }
        }
        if (token.isCancellationRequested) return { suggestions: [] }

        // Determine the partial-token range to replace. Use the word
        // before the cursor; fall back to the cursor position.
        const word = model.getWordUntilPosition(position)
        const replaceFrom = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          position.column,
        )

        return {
          suggestions: items.map((it) => toMonacoCompletion(it, replaceFrom, monaco)),
        }
      },
    }),
  )

  // ---- Hover ---------------------------------------------------------
  disposables.push(
    monaco.languages.registerHoverProvider(DQL_LANGUAGE_ID, {
      async provideHover(model, position, token) {
        const schema = opts.schema()
        if (!schema) return null
        const text = model.getValue()
        const offset = model.getOffsetAt(position)

        const ac = new AbortController()
        token.onCancellationRequested(() => ac.abort())

        const h = await provideHover(text, offset, schema, {
          fetchers: fetchersGetter(),
          signal: ac.signal,
        })
        if (!h || token.isCancellationRequested) return null

        const start = model.getPositionAt(h.range.from)
        const end   = model.getPositionAt(h.range.to)
        return {
          range: new monaco.Range(
            start.lineNumber, start.column,
            end.lineNumber,   end.column,
          ),
          contents: [{ value: h.contents }],
        }
      },
    }),
  )

  // ---- Semantic tokens (slot-aware highlighting) --------------------
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider(DQL_LANGUAGE_ID, {
      getLegend: () => ({
        tokenTypes: TOKEN_TYPES as unknown as string[],
        tokenModifiers: [],
      }),
      provideDocumentSemanticTokens(model) {
        return computeSemanticTokens(model, opts.schema())
      },
      releaseDocumentSemanticTokens() { /* nothing to release */ },
    }),
  )

  // ---- Per-model diagnostics ----------------------------------------
  const refreshMarkers = async (model: monacoNs.editor.ITextModel) => {
    const schema = opts.schema()
    if (!schema) {
      monaco.editor.setModelMarkers(model, owner, [])
      return
    }
    const text = model.getValue()
    // Parse exactly once — `errors` and `ranges` must come from the
    // same ParseResult so paths line up. Calling parse multiple times
    // is correct only because the parser is deterministic, but it
    // wastes work on every keystroke.
    const { draft, syntaxDiag, ranges } = parse(text)
    const { errors } = analyze(draft, schema)
    void format // ensure non-dead

    const ourDiags: Diagnostic[] = [
      ...syntaxDiag.map((d): Diagnostic => ({
        range: d.range,
        severity: 'error',
        message: d.message,
        code: d.code,
      })),
      ...errorsToDiagnostics(errors, ranges),
    ]

    const markers = ourDiags.map((d) => diagnosticToMarker(d, model, monaco))
    monaco.editor.setModelMarkers(model, owner, markers)
  }

  const attach = (model: monacoNs.editor.ITextModel): monacoNs.IDisposable => {
    void refreshMarkers(model)
    const sub = model.onDidChangeContent(() => {
      void refreshMarkers(model)
    })
    return {
      dispose() {
        sub.dispose()
        monaco.editor.setModelMarkers(model, owner, [])
      },
    }
  }

  const dispose = (): void => {
    for (const d of disposables) d.dispose()
    disposables.length = 0
  }

  return { attach, dispose }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const toMonacoCompletion = (
  it: CompletionItem,
  range: monacoNs.IRange,
  monaco: typeof monacoNs,
): monacoNs.languages.CompletionItem => {
  const isSnippet = it.insertText.includes('$')
  return {
    label: it.label,
    detail: it.detail,
    kind:
      it.kind === 'field'   ? monaco.languages.CompletionItemKind.Variable
      : it.kind === 'op'    ? monaco.languages.CompletionItemKind.Function
      : it.kind === 'value' ? monaco.languages.CompletionItemKind.EnumMember
      : it.kind === 'snippet' ? monaco.languages.CompletionItemKind.Snippet
      : monaco.languages.CompletionItemKind.Keyword,
    insertText: it.insertText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : 0,
    range,
    sortText: it.sortText,
    filterText: it.filterText,
  }
}

const errorsToDiagnostics = (
  errors: ValidationError[],
  ranges: RangeMap,
): Diagnostic[] => {
  const out: Diagnostic[] = []
  for (const e of errors) {
    const r = ranges.get(pathKey(e.path))
    if (!r) continue
    // Default to `whole` so an unmapped future error code can't leave
    // the variable uninitialised (`setModelMarkers` rejects undefined
    // ranges with a hard error).
    let range: TextRange = r.whole
    let severity: Severity = 'error'
    if ('field' in r || 'op' in r || 'value' in r) {
      const cr = r as ConditionRanges
      switch (e.code) {
        case 'unknown_field':       range = cr.field ?? cr.whole; break
        case 'op_not_allowed':      range = cr.op    ?? cr.whole; break
        case 'value_type_mismatch': range = cr.value ?? cr.whole; break
        case 'value_shape_mismatch':
          range = cr.value ?? cr.op ?? cr.whole; break
        case 'incomplete':
          range = cr.whole
          severity = 'hint'
          break
        default:
          // already initialised to cr.whole
          break
      }
    }
    out.push({
      range,
      severity,
      code: e.code,
      message: humanMessage(e),
    })
  }
  return out
}

const humanMessage = (err: ValidationError): string => {
  switch (err.code) {
    case 'unknown_field':
      return `Unknown field \`${err.field}\``
    case 'op_not_allowed':
      return `Operator \`${err.op}\` is not allowed for field \`${err.field}\``
    case 'value_type_mismatch':
      return `Expected value of type ${err.expected}, got ${err.got}`
    case 'value_shape_mismatch':
      return `Operator \`${err.op}\` expects value shape ${err.expected}`
    case 'incomplete':
      switch (err.missing) {
        case 'field': return 'Field is required'
        case 'op':    return 'Operator is required'
        case 'value': return 'Value is required'
      }
  }
}

const diagnosticToMarker = (
  d: Diagnostic,
  model: monacoNs.editor.ITextModel,
  monaco: typeof monacoNs,
): monacoNs.editor.IMarkerData => {
  const start = model.getPositionAt(d.range.from)
  const end   = model.getPositionAt(d.range.to)
  return {
    severity:
      d.severity === 'error'   ? monaco.MarkerSeverity.Error
      : d.severity === 'warning' ? monaco.MarkerSeverity.Warning
      : monaco.MarkerSeverity.Hint,
    startLineNumber: start.lineNumber,
    startColumn:     start.column,
    endLineNumber:   end.lineNumber,
    endColumn:       end.column,
    message:         d.message,
    code:            d.code,
    source:          '@dql-kit/dql',
  }
}

// ---------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------

const computeSemanticTokens = (
  model: monacoNs.editor.ITextModel,
  schema: FilterSchema | null,
): monacoNs.languages.SemanticTokens => {
  const text = model.getValue()
  const tokens = lex(text).tokens
  const { ranges, draft } = parse(text)

  const slotMap = buildSlotMap(ranges)
  const invalidRanges = schema
    ? collectInvalidRanges(analyze(draft, schema).errors, ranges)
    : []

  type Entry = { line: number, col: number, length: number, type: number }
  const entries: Entry[] = []

  for (const tok of tokens) {
    const baseType = typeForToken(tok, slotMap)
    if (baseType === null) continue
    const type = isInsideAny(tok.range, invalidRanges) ? TokType.Invalid : baseType
    const start = model.getPositionAt(tok.range.from)
    entries.push({
      line: start.lineNumber - 1, // protocol is 0-based
      col: start.column - 1,
      length: tok.range.to - tok.range.from,
      type,
    })
  }

  // Order by (line, col).
  entries.sort((a, b) => a.line - b.line || a.col - b.col)

  const data: number[] = []
  let prevLine = 0
  let prevCol = 0
  for (const e of entries) {
    const dLine = e.line - prevLine
    const dCol  = dLine === 0 ? e.col - prevCol : e.col
    data.push(dLine, dCol, e.length, e.type, 0)
    prevLine = e.line
    prevCol  = e.col
  }

  return { data: new Uint32Array(data) }
}

const typeForToken = (
  tok: Token,
  slotMap: SlotMap,
): TokType | null => {
  switch (tok.kind) {
    case 'AND':
    case 'OR':
    case 'TRUE':
    case 'FALSE':
    case 'NOT':
      return TokType.Keyword
    case 'NUMBER':       return TokType.Number
    case 'STRING':       return TokType.String
    case 'EQ':
    case 'NEQ':
    case 'RANGE':        return TokType.Operator
    case 'IDENTIFIER': {
      const slot = slotMap.lookup(tok.range)
      if (slot === 'op')    return TokType.Operator
      if (slot === 'value') return TokType.Unit
      return TokType.Variable // field by default
    }
    case 'COMMA':
    case 'LPAREN':
    case 'RPAREN':
    case 'LBRACK':
    case 'RBRACK':
    case 'INVALID':
      return null // handled by Monaco's bracket / fallback colouring
  }
}

// ---------------------------------------------------------------------------
// Slot map (mirror of dql-codemirror/syntax.ts)
// ---------------------------------------------------------------------------

type Slot = 'field' | 'op' | 'value'

class SlotMap {
  private entries: Array<{ from: number, to: number, slot: Slot }>
  constructor(entries: SlotMap['entries']) { this.entries = entries }
  lookup(r: TextRange): Slot | null {
    for (const e of this.entries) {
      if (e.from <= r.from && r.to <= e.to) return e.slot
    }
    return null
  }
}

const buildSlotMap = (ranges: RangeMap): SlotMap => {
  const entries: Array<{ from: number, to: number, slot: Slot }> = []
  for (const r of ranges.values()) {
    if (!('field' in r || 'op' in r || 'value' in r)) continue
    const cr = r as ConditionRanges
    if (cr.field) entries.push({ ...cr.field, slot: 'field' })
    if (cr.op)    entries.push({ ...cr.op,    slot: 'op'    })
    if (cr.value) entries.push({ ...cr.value, slot: 'value' })
  }
  entries.sort((a, b) => a.from - b.from)
  return new SlotMap(entries)
}

const collectInvalidRanges = (
  errors: ValidationError[],
  ranges: RangeMap,
): TextRange[] => {
  const out: TextRange[] = []
  for (const e of errors) {
    if (e.code === 'incomplete') continue
    const r = ranges.get(pathKey(e.path))
    if (!r) continue
    if (!('field' in r || 'op' in r || 'value' in r)) continue
    const cr = r as ConditionRanges
    let pick: TextRange | undefined
    switch (e.code) {
      case 'unknown_field':       pick = cr.field ?? cr.whole; break
      case 'op_not_allowed':      pick = cr.op    ?? cr.whole; break
      case 'value_type_mismatch': pick = cr.value ?? cr.whole; break
      case 'value_shape_mismatch':
        pick = cr.value ?? cr.op ?? cr.whole; break
    }
    if (pick) out.push(pick)
  }
  return out
}

const isInsideAny = (r: TextRange, ranges: TextRange[]): boolean =>
  ranges.some((x) => x.from <= r.from && r.to <= x.to)
