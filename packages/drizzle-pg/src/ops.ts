import { isRelativeUnit, type FieldDef } from '@dql-kit/core'
import {
  and as andSql,
  arrayContains,
  between,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or as orSql,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import type { OpTranslator } from './types.ts'

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`)

// Resolve the *effective* type for op-handler dispatch. A custom typeId
// with `delegateTo: 'array'` triggers the array branch of `contains`;
// without delegateTo, custom typeIds fall through to the string branch
// (the historical default for all non-array fields).
const effectiveTypeId = (field: FieldDef): string =>
  field.delegateTo ?? field.typeId

// For date/datetime fields the AST carries an ISO string (that's what
// `checkPrimitive` validates), but drizzle's default `timestamp()` /
// `date()` columns are `mode: 'date'` and call `value.toISOString()` in
// `mapToDriverValue` — passing a string crashes with
// "value.toISOString is not a function". Coerce here so both `mode: 'date'`
// (needs Date) and `mode: 'string'` (identity passthrough; pg serialises
// Date to ISO) work transparently. Element type drives coercion for
// arrays, so `in` / `notIn` over a date field also coerce per-element.
const dateElementTypeId = (field: FieldDef): string => {
  const inner = field.typeId === 'array' && field.itemType ? field.itemType : field
  return inner.delegateTo ?? inner.typeId
}
const isDateValuedField = (field: FieldDef): boolean => {
  const t = dateElementTypeId(field)
  return t === 'date' || t === 'datetime'
}
const coerceDateScalar = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d
}
const coerceDateValue = (field: FieldDef, v: unknown): unknown => {
  if (!isDateValuedField(field)) return v
  if (Array.isArray(v)) return v.map(coerceDateScalar)
  return coerceDateScalar(v)
}

// Some ops share an op name across very different SQL semantics — `contains`
// is ILIKE for string fields but `= ANY(col)` for PG array fields, and
// `isEmpty` is `IS NULL OR = ''` for strings vs `cardinality(col) = 0` for
// arrays. `notEmpty` is the boolean negation of `isEmpty` (NULL → empty,
// not "unknown") so callers don't need a separate `not(isEmpty)` wrapper.
// The op translator branches on the effective typeId via the OpContext.

export const drizzleOps: Record<string, OpTranslator> = {
  eq:           (col, v, ctx) => eq(col, coerceDateValue(ctx.field, v) as never),
  neq:          (col, v, ctx) => ne(col, coerceDateValue(ctx.field, v) as never),
  contains:     (col, v, ctx) => {
    if (effectiveTypeId(ctx.field) === 'array') {
      // PG: scalar = ANY(array_column)
      return sql`${v} = ANY(${col})`
    }
    return ilike(col, `%${escapeLike(String(v))}%`)
  },
  notContains:  (col, v, ctx) => {
    if (effectiveTypeId(ctx.field) === 'array') {
      // PG: scalar <> ALL(array_column). NULL elements yield NULL → row
      // dropped by WHERE, which matches "value not present" intent.
      return sql`${v} <> ALL(${col})`
    }
    return sql`${col} NOT ILIKE ${`%${escapeLike(String(v))}%`}`
  },
  startsWith:   (col, v) => ilike(col, `${escapeLike(String(v))}%`),
  endsWith:     (col, v) => ilike(col, `%${escapeLike(String(v))}`),
  isEmpty:      (col, _v, ctx) => {
    if (effectiveTypeId(ctx.field) === 'array') {
      // Array empty: NULL or zero-length. cardinality(NULL) is NULL, so the
      // explicit IS NULL branch is required to match the "no items" intent.
      return orSql(isNull(col), sql`cardinality(${col}) = 0`)!
    }
    return orSql(isNull(col), eq(col as AnyColumn, '' as never))!
  },
  notEmpty:     (col, _v, ctx) => {
    if (effectiveTypeId(ctx.field) === 'array') {
      // Boolean negation of isEmpty: must be non-NULL AND have at least
      // one element. Treating NULL as "empty" (not "unknown") matches the
      // intent users have when picking this op in the UI.
      return andSql(isNotNull(col), sql`cardinality(${col}) > 0`)!
    }
    return andSql(isNotNull(col), ne(col as AnyColumn, '' as never))!
  },
  in:           (col, v, ctx) => inArray(col, coerceDateValue(ctx.field, v) as never[]),
  notIn:        (col, v, ctx) => notInArray(col, coerceDateValue(ctx.field, v) as never[]),
  gt:           (col, v, ctx) => gt(col, coerceDateValue(ctx.field, v) as never),
  gte:          (col, v, ctx) => gte(col, coerceDateValue(ctx.field, v) as never),
  lt:           (col, v, ctx) => lt(col, coerceDateValue(ctx.field, v) as never),
  lte:          (col, v, ctx) => lte(col, coerceDateValue(ctx.field, v) as never),
  between:      (col, v, ctx) => {
    const [a, b] = coerceDateValue(ctx.field, v) as [unknown, unknown]
    return between(col, a as never, b as never)
  },
  before:       (col, v, ctx) => lt(col, coerceDateValue(ctx.field, v) as never),
  after:        (col, v, ctx) => gt(col, coerceDateValue(ctx.field, v) as never),
  inLast:       (col, v) => {
    // Defence-in-depth: core/check.ts already rejects anything outside the
    // documented unit set, but `unit` is interpolated into sql.raw so we
    // re-check here too. A failed re-check signals AST tampering or a custom
    // op flowing through; throw rather than silently emit unsafe SQL.
    const { amount, unit } = (v ?? {}) as { amount: unknown, unit: unknown }
    const a = Number(amount)
    if (!Number.isFinite(a) || a <= 0) {
      throw new Error(`[dql-kit/drizzle-pg] inLast: amount must be a positive finite number, got ${String(amount)}`)
    }
    if (!isRelativeUnit(unit)) {
      throw new Error(`[dql-kit/drizzle-pg] inLast: unit must be one of minute/hour/day/week/month, got ${String(unit)}`)
    }
    return sql`${col} >= NOW() - ${sql.raw(`INTERVAL '${a} ${unit}'`)}`
  },
  // PG: array @> array — left contains every element of right (superset).
  // Use drizzle's arrayContains helper rather than inlining `@>` so the
  // parameter is encoded as a PG ARRAY literal instead of a record/tuple.
  // The helper rejects an empty array; emit a tautology to preserve PG's
  // semantics (`x @> '{}'` is always true).
  containsAll:  (col, v) => {
    const arr = (v as unknown[]) ?? []
    if (arr.length === 0) return sql`true`
    return arrayContains(col, arr as never[])
  },
}

export const passthrough = { andSql, orSql, isNotNull } as Record<string, unknown>
export type { SQL }
