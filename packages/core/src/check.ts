import type { FieldDef, ValueShape } from './types.ts'

// Whitelist of relative-time units. Locked here in core because the value
// flows verbatim into a SQL `INTERVAL` literal in the Drizzle adapter, which
// uses sql.raw to keep PG's interval syntax — so the codec layer is the right
// place to refuse anything outside the documented set rather than relying on
// the adapter for safety.
export const RELATIVE_UNITS = ['minute', 'hour', 'day', 'week', 'month'] as const
export type RelativeUnit = (typeof RELATIVE_UNITS)[number]
const relativeUnitSet = new Set<string>(RELATIVE_UNITS)

export const isRelativeUnit = (s: unknown): s is RelativeUnit =>
  typeof s === 'string' && relativeUnitSet.has(s)

export const checkShape = (value: unknown, shape: ValueShape): boolean => {
  switch (shape) {
    case 'none':
      return value === undefined
    case 'single': {
      if (value === undefined) return false
      if (Array.isArray(value)) return false
      if (typeof value === 'object' && value !== null) {
        const r = value as Record<string, unknown>
        if ('amount' in r && 'unit' in r) return false
      }
      return true
    }
    case 'pair':
      return Array.isArray(value) && value.length === 2
    case 'list':
      return Array.isArray(value)
    case 'relative': {
      if (typeof value !== 'object' || value === null) return false
      const r = value as Record<string, unknown>
      if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0) return false
      if (!isRelativeUnit(r.unit)) return false
      return true
    }
  }
}

// ISO 8601 calendar date. The regex fixes the layout; `isCalendarDate`
// rejects days that don't exist (`2024-02-31`), which `Date` would
// silently roll over into the next month.
export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
// ISO 8601 instant with an explicit offset. Without one, `Date.parse`
// reads the string in the runtime's local zone, so a browser and a
// server could turn the same value into different instants.
export const DATETIME_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?(Z|[+-]\\d{2}:\\d{2})$'
const dateRe = new RegExp(DATE_PATTERN)
const datetimeRe = new RegExp(DATETIME_PATTERN)

const isCalendarDate = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1) return false
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= days
}

export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !dateRe.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return isCalendarDate(y, m, d)
}

export const isIsoDateTime = (value: unknown): value is string => {
  if (typeof value !== 'string' || !datetimeRe.test(value)) return false
  if (!isIsoDate(value.slice(0, 10))) return false
  const hh = Number(value.slice(11, 13))
  const mm = Number(value.slice(14, 16))
  const ss = value[16] === ':' ? Number(value.slice(17, 19)) : 0
  if (hh > 23 || mm > 59 || ss > 59) return false
  return !Number.isNaN(Date.parse(value))
}

// Resolve the *effective* primitive type for value-type checks. A custom
// typeId with `delegateTo: 'string'` validates as a string; without
// delegateTo, custom typeIds opt out of value-type checks (return true).
const checkPrimitive = (field: FieldDef, value: unknown): boolean => {
  const effective = field.delegateTo ?? field.typeId
  switch (effective) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'enum':
      return field.enumValues != null && field.enumValues.some((e) => e.value === value)
    case 'date':
      return isIsoDate(value)
    case 'datetime':
      return isIsoDateTime(value)
    case 'id':
      return typeof value === 'string' || typeof value === 'number'
    default:
      // Custom typeIds without delegateTo: caller is on their own —
      // adapter-side handlers should validate however they need.
      return true
  }
}

export const checkValueType = (
  field: FieldDef,
  shape: ValueShape,
  value: unknown,
): boolean => {
  if (shape === 'none' || shape === 'relative') return true

  const elementField: FieldDef =
    field.typeId === 'array' && field.itemType ? field.itemType : field

  if (shape === 'single') return checkPrimitive(elementField, value)
  if (shape === 'pair') {
    if (!Array.isArray(value) || value.length !== 2) return false
    return checkPrimitive(elementField, value[0]) && checkPrimitive(elementField, value[1])
  }
  if (shape === 'list') {
    if (!Array.isArray(value)) return false
    return value.every((v) => checkPrimitive(elementField, v))
  }
  return false
}

// Sort key for `pair` bounds, or `undefined` when the field's values
// have no order the library knows (custom typeIds without `delegateTo`,
// booleans, ids, enums). Only called on values that already passed
// `checkValueType`.
const orderKey = (field: FieldDef, value: unknown): number | string | undefined => {
  const element: FieldDef =
    field.typeId === 'array' && field.itemType ? field.itemType : field
  switch (element.delegateTo ?? element.typeId) {
    case 'number':
      return value as number
    case 'date':
      return value as string
    case 'datetime':
      return Date.parse(value as string)
    default:
      return undefined
  }
}

/**
 * Whether a `pair` value is in ascending order (equal bounds are fine).
 * `between [10, 1]` would otherwise reach SQL as `BETWEEN 10 AND 1`,
 * which matches nothing and reports nothing.
 */
export const checkPairOrder = (field: FieldDef, value: unknown): boolean => {
  if (!Array.isArray(value) || value.length !== 2) return true
  const lo = orderKey(field, value[0])
  const hi = orderKey(field, value[1])
  if (lo === undefined || hi === undefined) return true
  return lo <= hi
}

export const expectedTypeLabel = (field: FieldDef): string => {
  if (field.typeId === 'array' && field.itemType) {
    return `array<${field.itemType.delegateTo ?? field.itemType.typeId}>`
  }
  return field.delegateTo ?? field.typeId
}

export const observedTypeLabel = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
