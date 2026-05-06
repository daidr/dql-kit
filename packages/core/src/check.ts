import type { FieldDef, ValueShape } from './types.ts'

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
      return typeof r.amount === 'number' && typeof r.unit === 'string'
    }
  }
}

const checkPrimitive = (field: FieldDef, value: unknown): boolean => {
  switch (field.typeId) {
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
    return `array<${field.itemType.typeId}>`
  }
  return field.typeId
}

export const observedTypeLabel = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
