// DraftAST → DQL text. Single-line, compact (Q15).
//
// Rules (from ADR 0002 / Q15):
//   - Lowercase keywords always.
//   - Strings always double-quoted with JSON escape subset.
//   - Numbers as JSON numerics.
//   - Booleans `true` / `false`.
//   - Pair → `lo..hi` (no whitespace around `..`).
//   - List → `[a, b, c]` (single space after `,`, no padding).
//   - Relative → `7 days` (singular for amount === 1, plural otherwise).
//   - Non-root groups always parenthesised; root group never.
//   - Incomplete conditions (null field / null op / missing required value)
//     are dropped entirely from the output (Q15 v1 limitation).
//   - `parse(format(prune(draft))) ≡ prune(draft)` is the round-trip
//     contract (semantic equivalence, NOT byte equivalence).
//
// Schema is consulted to disambiguate pair vs list valueShape — both
// surface as `Array.isArray(value)` in the AST, but the literal forms
// differ (`5..10` vs `[5, 10]`). When the field/op pair isn't found in
// the schema, falls back to heuristics.

import type {
  DraftAST,
  DraftCondition,
  DraftGroup,
  DraftNode,
  FieldDef,
  FilterSchema,
  OpDef,
  ValueShape,
} from '@dql-kit/core'
import { isRelativeUnit } from '@dql-kit/core'

// Plural form for the relative-unit pluraliser.
const PLURALS: Record<string, string> = {
  minute: 'minutes',
  hour: 'hours',
  day: 'days',
  week: 'weeks',
  month: 'months',
}

/**
 * Format a `DraftAST` as DQL text. Always succeeds — incomplete nodes
 * are dropped silently (Q15).
 */
export const format = (draft: DraftAST, schema: FilterSchema): string =>
  formatGroupBody(draft, schema)

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const formatNode = (
  node: DraftNode,
  schema: FilterSchema,
): string | null => {
  if (isGroupNode(node)) {
    const body = formatGroupBody(node, schema)
    if (body === '') return null
    return `(${body})`
  }
  return formatCondition(node, schema)
}

const formatGroupBody = (
  group: DraftGroup,
  schema: FilterSchema,
): string => {
  const pieces: string[] = []
  for (const child of group.children) {
    const piece = formatNode(child, schema)
    if (piece !== null) pieces.push(piece)
  }
  if (pieces.length === 0) return ''
  if (pieces.length === 1) return pieces[0]!
  const sep = ` ${group.combinator} `
  return pieces.join(sep)
}

const formatCondition = (
  cond: DraftCondition,
  schema: FilterSchema,
): string | null => {
  // Incomplete check (Q15): drop silently.
  if (cond.field == null || cond.op == null) return null

  const fieldDef = schema.fields[cond.field]
  const opDef = fieldDef?.ops.find((o) => o.name === cond.op)
  const shape: ValueShape | null = opDef?.valueShape ?? inferShape(cond.value)

  // Symbolic op aliases on output: `eq` → `=`, `neq` → `!=`. Other ops
  // stay as keywords.
  const opText =
    cond.op === 'eq' ? '=' :
    cond.op === 'neq' ? '!=' :
    cond.op

  if (shape === 'none') {
    return `${cond.field} ${opText}`
  }

  if (cond.value === undefined) {
    // Required value missing — incomplete condition (Q15: drop).
    return null
  }

  const valueText = formatValue(cond.value, shape, fieldDef)
  if (valueText === null) return null

  return `${cond.field} ${opText} ${valueText}`
}

const formatValue = (
  value: unknown,
  shape: ValueShape | null,
  fieldDef: FieldDef | undefined,
): string | null => {
  if (shape === 'pair') {
    if (!Array.isArray(value) || value.length !== 2) return null
    const lo = formatScalar(value[0], fieldDef)
    const hi = formatScalar(value[1], fieldDef)
    if (lo === null || hi === null) return null
    return `${lo}..${hi}`
  }

  if (shape === 'list') {
    if (!Array.isArray(value)) return null
    const items = value.map((v) => formatScalar(v, fieldDef?.itemType ?? fieldDef))
    if (items.some((s) => s === null)) return null
    return `[${items.join(', ')}]`
  }

  if (shape === 'relative') {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('amount' in value) ||
      !('unit' in value)
    ) {
      return null
    }
    const r = value as { amount: unknown, unit: unknown }
    if (typeof r.amount !== 'number' || typeof r.unit !== 'string') return null
    const unitText = r.amount === 1 ? r.unit : (PLURALS[r.unit] ?? r.unit)
    return `${formatNumber(r.amount)} ${unitText}`
  }

  // 'single' or unknown — treat as scalar.
  return formatScalar(value, fieldDef)
}

const formatScalar = (
  value: unknown,
  fieldDef: FieldDef | undefined,
): string | null => {
  if (typeof value === 'string') return quoteString(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return formatNumber(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  // Custom typeIds without delegateTo may carry arbitrary values —
  // fall back to JSON. This will round-trip as a string literal,
  // which is the closest sane default.
  if (value === null || value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const formatNumber = (n: number): string => {
  // Avoid `Number.prototype.toString`'s exponent form for moderately
  // large integers (consistency with parser-friendly literal shapes).
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n)
  return String(n)
}

const quoteString = (s: string): string => {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ch = s[i]!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out + '"'
}

// ---------------------------------------------------------------------------
// Type guards / heuristics
// ---------------------------------------------------------------------------

const isGroupNode = (n: DraftNode): n is DraftGroup =>
  n != null && typeof n === 'object' && 'combinator' in n

/**
 * Best-effort shape inference when the schema doesn't tell us. Used
 * for unknown fields / unknown ops so format never throws.
 */
const inferShape = (value: unknown): ValueShape | null => {
  if (value === undefined) return 'none'
  if (Array.isArray(value)) return 'list' // bias toward `[...]` when ambiguous
  if (
    typeof value === 'object' &&
    value !== null &&
    'amount' in value &&
    'unit' in value &&
    isRelativeUnit((value as { unit: unknown }).unit)
  ) {
    return 'relative'
  }
  return 'single'
}
