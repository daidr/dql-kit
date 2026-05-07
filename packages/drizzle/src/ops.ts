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

// Some ops share an op name across very different SQL semantics — `contains`
// is ILIKE for string fields but `= ANY(col)` for PG array fields, and
// `isEmpty` is `IS NULL OR = ''` for strings vs `cardinality(col) = 0` for
// arrays. The op translator branches on the effective typeId via the
// OpContext.

export const drizzleOps: Record<string, OpTranslator> = {
  eq:           (col, v) => eq(col, v as never),
  neq:          (col, v) => ne(col, v as never),
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
  in:           (col, v) => inArray(col, v as never[]),
  notIn:        (col, v) => notInArray(col, v as never[]),
  gt:           (col, v) => gt(col, v as never),
  gte:          (col, v) => gte(col, v as never),
  lt:           (col, v) => lt(col, v as never),
  lte:          (col, v) => lte(col, v as never),
  between:      (col, v) => {
    const [a, b] = v as [unknown, unknown]
    return between(col, a as never, b as never)
  },
  before:       (col, v) => lt(col, v as never),
  after:        (col, v) => gt(col, v as never),
  inLast:       (col, v) => {
    // Defence-in-depth: core/check.ts already rejects anything outside the
    // documented unit set, but `unit` is interpolated into sql.raw so we
    // re-check here too. A failed re-check signals AST tampering or a custom
    // op flowing through; throw rather than silently emit unsafe SQL.
    const { amount, unit } = (v ?? {}) as { amount: unknown, unit: unknown }
    const a = Number(amount)
    if (!Number.isFinite(a) || a <= 0) {
      throw new Error(`[dql-kit/drizzle] inLast: amount must be a positive finite number, got ${String(amount)}`)
    }
    if (!isRelativeUnit(unit)) {
      throw new Error(`[dql-kit/drizzle] inLast: unit must be one of minute/hour/day/week/month, got ${String(unit)}`)
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
