// Hover popups — context-sensitive tooltips for the token under the
// cursor.
//
// For field tokens: render the field's `label` (or fallback to its key)
// + its typeId.
// For op tokens: render the op's `label`.
// For id-field values: call the field's `resolve([id])` and surface the
// returned label as a tooltip.

import type { FilterSchema } from '@dql-kit/core'
import { isIdField } from '@dql-kit/core'
import { parse } from '../parse.ts'
import type {
  ConditionRanges,
  FetcherMap,
  Hover,
  RangeMap,
  TextRange,
  Token,
} from '../types.ts'
import { lex } from '../lex.ts'

export type ProvideHoverOptions = {
  fetchers?: FetcherMap
  signal?: AbortSignal
}

/**
 * Run hover lookup for the cursor offset in `text`. Returns `null`
 * when there's nothing meaningful to show (cursor in whitespace,
 * unknown field, etc.).
 */
export const provideHover = async (
  text: string,
  offset: number,
  schema: FilterSchema,
  options: ProvideHoverOptions = {},
): Promise<Hover | null> => {
  const { ranges } = parse(text)

  // Find the deepest condition whose `whole` covers the offset.
  const found = findCondition(ranges, offset)
  if (!found) return null
  const { path, ranges: cr } = found
  void path

  // Field hover
  if (cr.field && inToken(cr.field, offset)) {
    return fieldHover(text, cr.field, schema)
  }

  // Op hover
  if (cr.op && inToken(cr.op, offset)) {
    return opHover(text, cr, schema)
  }

  // Value hover — only id fields get a non-trivial tooltip.
  if (cr.value && inToken(cr.value, offset)) {
    return await valueHover(text, cr, schema, offset, options.fetchers, options.signal)
  }

  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Closed range — used for `whole` (a cursor at the boundary still
 * "belongs" to the surrounding condition). */
const inWhole = (r: TextRange, offset: number): boolean =>
  r.from <= offset && offset <= r.to

/** Strict range — used for individual tokens (a cursor exactly at the
 * end of an identifier / value is *past* it, not inside). */
const inToken = (r: TextRange, offset: number): boolean =>
  r.from <= offset && offset < r.to

const contains = inWhole // back-compat for findCondition

const findCondition = (
  ranges: RangeMap,
  offset: number,
): { path: string, ranges: ConditionRanges } | null => {
  let bestPath: string | null = null
  let best: ConditionRanges | null = null
  for (const [path, r] of ranges) {
    if (!('field' in r || 'op' in r || 'value' in r)) continue
    const cr = r as ConditionRanges
    if (!contains(cr.whole, offset)) continue
    if (best === null || isMoreSpecific(cr.whole, best.whole)) {
      bestPath = path
      best = cr
    }
  }
  if (best === null || bestPath === null) return null
  return { path: bestPath, ranges: best }
}

const isMoreSpecific = (a: TextRange, b: TextRange): boolean =>
  (a.from > b.from) || (a.to < b.to)

const fieldHover = (
  text: string,
  range: TextRange,
  schema: FilterSchema,
): Hover | null => {
  const name = text.slice(range.from, range.to)
  const def = schema.fields[name]
  if (!def) return null
  const label = typeof def.label === 'function' ? def.label() : def.label
  const ty = def.delegateTo ?? def.typeId
  const heading = label ? `**${label}** \`${name}\`` : `**${name}**`
  const lines = [heading, `Type: \`${ty}\``]
  return { range, contents: lines.join('\n\n') }
}

const opHover = (
  text: string,
  cr: ConditionRanges,
  schema: FilterSchema,
): Hover | null => {
  if (!cr.field || !cr.op) return null
  const fieldName = text.slice(cr.field.from, cr.field.to)
  const def = schema.fields[fieldName]
  if (!def) return null
  const opName = text.slice(cr.op.from, cr.op.to)
  // Symbolic forms map to canonical names.
  const canonical = opName === '=' ? 'eq' : opName === '!=' ? 'neq' : opName
  const op = def.ops.find((o) => o.name === canonical)
  if (!op) return null
  const label = typeof op.label === 'function' ? op.label() : op.label
  const heading = `**${label || op.name}** \`${op.name}\``
  return {
    range: cr.op,
    contents: [heading, `Value shape: \`${op.valueShape}\``].join('\n\n'),
  }
}

const valueHover = async (
  text: string,
  cr: ConditionRanges,
  schema: FilterSchema,
  offset: number,
  fetchers: FetcherMap | undefined,
  signal?: AbortSignal,
): Promise<Hover | null> => {
  if (!cr.field || !cr.value) return null
  const fieldName = text.slice(cr.field.from, cr.field.to)
  const def = schema.fields[fieldName]
  if (!def || !isIdField(def)) return null

  // Find the specific id token under the cursor (a list value can hold
  // many ids; pick the one we're hovering).
  const idToken = findIdTokenAt(text, cr.value, offset)
  if (!idToken) return null
  const idValue = idToken.value

  const fetcher = fetchers?.[fieldName]
  if (!fetcher || typeof fetcher.resolve !== 'function') {
    return { range: idToken.range, contents: `id: \`${String(idValue)}\`` }
  }

  const ac = new AbortController()
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  let raw: unknown
  try {
    raw = await fetcher.resolve([idValue] as never, ac.signal)
  } catch {
    return { range: idToken.range, contents: `id: \`${String(idValue)}\`` }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { range: idToken.range, contents: `id: \`${String(idValue)}\`` }
  }
  const item = raw[0] as { label?: unknown }
  const label = typeof item.label === 'string' ? item.label : null
  if (!label) return { range: idToken.range, contents: `id: \`${String(idValue)}\`` }
  return {
    range: idToken.range,
    contents: `**${label}**\n\nid: \`${String(idValue)}\``,
  }
}

const findIdTokenAt = (
  text: string,
  valueRange: TextRange,
  offset: number,
): { value: string | number, range: TextRange } | null => {
  // Lex only the value's slice.
  const slice = text.slice(valueRange.from, valueRange.to)
  const r = lex(slice)
  for (const t of r.tokens) {
    if (t.kind !== 'STRING' && t.kind !== 'NUMBER') continue
    const absRange: TextRange = {
      from: valueRange.from + t.range.from,
      to:   valueRange.from + t.range.to,
    }
    if (absRange.from <= offset && offset < absRange.to) {
      return { value: t.value as string | number, range: absRange }
    }
  }
  return null
}

// Internal helper — re-export the token shape so tests can use it.
export type _Token = Token
