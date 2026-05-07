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
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
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
