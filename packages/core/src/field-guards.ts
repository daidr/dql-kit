import type {
  ArrayField,
  BooleanField,
  DateField,
  DateTimeField,
  EnumField,
  FieldDef,
  IdField,
  NumberField,
  StringField,
} from './types.ts'

// Type guards for narrowing FieldDef → per-typeId interface. Useful in
// adapter / consumer code that needs the richer per-typeId shape
// (e.g. `enumValues` on EnumField, `itemType` on ArrayField, the `ID`
// phantom on IdField). All checks are by `typeId` string equality.

export const isStringField = (f: FieldDef): f is StringField => f.typeId === 'string'
export const isNumberField = (f: FieldDef): f is NumberField => f.typeId === 'number'
export const isBooleanField = (f: FieldDef): f is BooleanField => f.typeId === 'boolean'
export const isEnumField = <V extends string | number = string | number>(
  f: FieldDef,
): f is EnumField<V> => f.typeId === 'enum'
export const isDateField = (f: FieldDef): f is DateField => f.typeId === 'date'
export const isDateTimeField = (f: FieldDef): f is DateTimeField => f.typeId === 'datetime'
export const isIdField = <ID extends string | number = string | number>(
  f: FieldDef,
): f is IdField<ID> => f.typeId === 'id'
export const isArrayField = (f: FieldDef): f is ArrayField => f.typeId === 'array'

/**
 * True for any built-in typeId. Custom (`f.custom({ typeId, ops })`)
 * fields return false here — adapter code should treat them via the
 * op-translation path (custom typeIds are dispatched by op name + ctx).
 */
export const isBuiltinField = (f: FieldDef): boolean =>
  isStringField(f)
  || isNumberField(f)
  || isBooleanField(f)
  || isEnumField(f)
  || isDateField(f)
  || isDateTimeField(f)
  || isIdField(f)
  || isArrayField(f)
