import type { RelativeUnit } from './check.ts'
import type {
  BuiltinFieldTypeId,
  FilterSchema,
  IdField,
  OpDef,
  ValueShape,
} from './types.ts'

// Type-level derivation of schema-typed conditions. Everything here is
// erased at runtime; the runtime checks that back these types live in
// `check.ts` (`checkShape` / `checkValueType`), and the two must agree:
// a value `analyze` accepts must type-check here and vice versa.

/** Value of a `relative`-shape op such as `inLast`. */
export type RelativeValue = { amount: number, unit: RelativeUnit }

// Scalar type of each builtin, as accepted by `checkValueType`. `date`
// and `datetime` travel as ISO strings. `enum` / `id` are the open
// forms, used when a custom field delegates to them (no concrete enum
// values or ID type to narrow to).
type BuiltinScalar = {
  string: string
  number: number
  boolean: boolean
  enum: string | number
  date: string
  datetime: string
  id: string | number
  array: unknown
}

/**
 * Scalar value type of a field — what a `single` op compares against.
 * Enum fields give the declared value union, `IdField<ID>` gives `ID`,
 * array fields give their item's scalar, custom fields follow their
 * `delegateTo`. Custom fields without `delegateTo` (and the open
 * `FieldDef`) give `unknown`, matching the runtime, which does not
 * type-check their values.
 */
export type FieldScalar<F> =
  F extends { delegateTo: infer D extends BuiltinFieldTypeId } ? BuiltinScalar[D]
  : F extends { typeId: 'enum', enumValues: ReadonlyArray<{ value: infer V }> } ? V
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  : F extends IdField<infer ID, any> ? ID
  : F extends { typeId: 'array', itemType: infer I } ? FieldScalar<I>
  : F extends { typeId: infer T extends keyof BuiltinScalar } ? BuiltinScalar[T]
  : unknown

/** Value an op of shape `Shape` takes on a field whose scalar is `T`. */
export type OpValue<Shape extends ValueShape, T> =
  Shape extends 'none' ? undefined
  : Shape extends 'single' ? T
  : Shape extends 'pair' ? [T, T]
  : Shape extends 'list' ? T[]
  : Shape extends 'relative' ? RelativeValue
  : never

/** Field keys of a schema. `string` for the open `FilterSchema`. */
export type FieldKey<S extends FilterSchema> = Extract<keyof S['fields'], string>

/** Op names a schema field accepts. */
export type FieldOpName<S extends FilterSchema, K extends FieldKey<S>> =
  S['fields'][K]['ops'][number]['name']

type ConditionForOp<K extends string, F, O> =
  O extends OpDef<infer N, infer Shape>
    // An op typed as the open `OpDef` (e.g. a list annotated `OpDef[]`)
    // carries no name or shape to narrow on: fall back to the loose form
    // for that op rather than rejecting everything.
    ? string extends N ? { field: K, op: string, value?: unknown }
    : ValueShape extends Shape ? { field: K, op: N, value?: unknown }
    : Shape extends 'none' ? { field: K, op: N, value?: undefined }
    : { field: K, op: N, value: OpValue<Shape, FieldScalar<F>> }
    : never

/**
 * Discriminated union of every valid condition for schema `S` (or for
 * the subset of fields `K`): one member per (field, op) pair, each with
 * the value type that op takes on that field. Narrowing on `field` and
 * then `op` narrows `value`.
 *
 * For the open `FilterSchema` this collapses to
 * `{ field: string, op: string, value?: unknown }`.
 */
export type ConditionOf<S extends FilterSchema, K extends FieldKey<S> = FieldKey<S>> =
  K extends unknown
    ? ConditionForOp<K, S['fields'][K], S['fields'][K]['ops'][number]>
    : never
