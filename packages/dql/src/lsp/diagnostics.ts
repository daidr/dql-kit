// Combine parser-level (syntax) and analyzer-level (schema) diagnostics
// into a single `Diagnostic[]` for the editor.
//
// Schema validation errors come from `core.analyze` as
// `ValidationError` records carrying a `path: number[]`. The parser's
// `RangeMap` resolves each path to its source-text range — using the
// 4-sub-range condition shape (Q9) to highlight the precise token that
// caused the problem (`unknown_field` → field range, `op_not_allowed`
// → op range, etc.).

import { analyze } from '@dql-kit/core'
import type {
  FilterSchema,
  ValidationError,
} from '@dql-kit/core'
import { parse } from '../parse.ts'
import type {
  ConditionRanges,
  Diagnostic,
  DqlOptions,
  GroupRanges,
  RangeMap,
  Severity,
  SyntaxDiag,
  TextRange,
} from '../types.ts'
import { DEFAULT_DQL_OPTIONS, pathKey } from '../types.ts'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run lex → parse → analyze and merge all diagnostics into the LSP
 * shape. Synchronous — schema validation is pure computation; no async
 * fetcher work happens here (only completion calls fetchers).
 */
export const provideDiagnostics = async (
  text: string,
  schema: FilterSchema,
  opts: DqlOptions = {},
): Promise<Diagnostic[]> => {
  const merged = { ...DEFAULT_DQL_OPTIONS, ...opts }
  const out: Diagnostic[] = []

  const { draft, ranges, syntaxDiag } = parse(text)
  for (const d of syntaxDiag) out.push(syntaxToDiagnostic(d))

  const { errors } = analyze(draft, schema)
  for (const e of errors) {
    const diag = validationToDiagnostic(e, ranges, merged.incompleteSeverity)
    if (diag) out.push(diag)
  }

  return out
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const syntaxToDiagnostic = (d: SyntaxDiag): Diagnostic => ({
  range: d.range,
  severity: 'error',
  message: d.message,
  code: d.code,
})

const validationToDiagnostic = (
  err: ValidationError,
  ranges: RangeMap,
  incompleteSeverity: Severity,
): Diagnostic | null => {
  const cond = ranges.get(pathKey(err.path)) as ConditionRanges | GroupRanges | undefined
  if (!cond) {
    // Path doesn't exist in source (analyze produced an error for a
    // path the parser didn't materialise). Skip — this is a parser
    // bug if it ever happens; not an end-user-visible error.
    return null
  }
  const range = pickRange(err, cond)
  const severity: Severity = err.code === 'incomplete' ? incompleteSeverity : 'error'
  return {
    range,
    severity,
    message: humanMessage(err),
    code: err.code,
  }
}

const pickRange = (
  err: ValidationError,
  cr: ConditionRanges | GroupRanges,
): TextRange => {
  const isCondition = (x: ConditionRanges | GroupRanges): x is ConditionRanges =>
    'whole' in x && (
      'field' in x || 'op' in x || 'value' in x ||
      Object.keys(x).length === 1 // bare {whole} for empty conditions
    )

  if (!isCondition(cr)) return cr.whole

  switch (err.code) {
    case 'unknown_field':
      return cr.field ?? cr.whole
    case 'op_not_allowed':
      return cr.op ?? cr.whole
    case 'value_type_mismatch':
      return cr.value ?? cr.whole
    case 'value_shape_mismatch':
      return cr.value ?? cr.op ?? cr.whole
    case 'incomplete':
      switch (err.missing) {
        case 'field': return cr.field ?? cr.whole
        case 'op':
          // Position the hint *after* the field token.
          if (cr.field) return collapseAfter(cr.field)
          return cr.whole
        case 'value':
          if (cr.op) return collapseAfter(cr.op)
          return cr.whole
        // If `core` ever adds a sixth `missing` value, fall back to
        // the whole-condition range so the editor doesn't blow up
        // with `range: undefined`.
        default: return cr.whole
      }
    // Same fallback for an unknown future error code.
    default: return cr.whole
  }
}

const collapseAfter = (r: TextRange): TextRange => ({ from: r.to, to: r.to })

// ---------------------------------------------------------------------------
// Human-readable messages
// ---------------------------------------------------------------------------

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
    case 'incomplete': {
      switch (err.missing) {
        case 'field': return 'Field is required'
        case 'op':    return 'Operator is required'
        case 'value': return 'Value is required'
        default:      return 'Condition is incomplete'
      }
    }
    // Unknown future codes — surface a generic message rather than
    // letting the function silently return undefined.
    default:
      return `Validation error (${(err as { code: string }).code})`
  }
}
