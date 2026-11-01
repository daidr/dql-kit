import {
  isPeriodValue,
  isRelativeUnit,
  periodRange,
  relativeDateRange,
  startOfZonedDay,
  type FieldDef,
  type RelativeUnit,
} from '@dql-kit/core'
import {
  and as andSql,
  arrayContains,
  arrayOverlaps,
  between,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  like,
  isNotNull,
  isNull,
  lt,
  lte,
  or as orSql,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import type { OpContext, OpTranslator } from './types.ts'

type ColumnOp = (col: AnyColumn, value: unknown, ctx: OpContext) => SQL

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

// `date` values are calendar days. Compare them as half-open day ranges
// (`>= day AND < day + 1`) rather than as instants: on a PG `date` column
// the result is the same, and on a `timestamp` column the whole last day
// is kept instead of only its midnight. Only plain `date` fields (or
// customs delegating to it) take this path; arrays and datetime don't.
//
// A day starts at midnight in the translator's `timeZone` on timestamp
// columns. A PG `date` column holds plain days, so its bound is the day
// itself (sent as UTC midnight, which PG casts back to the same day).
const DAY_MS = 86_400_000
const isDayField = (field: FieldDef): boolean => effectiveTypeId(field) === 'date'
const isPgDateColumn = (col: AnyColumn): boolean => {
  const getType = (col as { getSQLType?: () => string }).getSQLType
  return typeof getType === 'function' && getType.call(col) === 'date'
}
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const dayStart = (col: AnyColumn, day: unknown, ctx: OpContext): Date => {
  const d = String(day).slice(0, 10)
  return new Date(isPgDateColumn(col) ? Date.parse(`${d}T00:00:00Z`) : startOfZonedDay(d, ctx.timeZone))
}
const nextDay = (col: AnyColumn, day: unknown, ctx: OpContext): Date =>
  dayStart(col, addDays(String(day).slice(0, 10), 1), ctx)

// Negated ops keep NULL rows. Under SQL's three-valued logic `col <> v`
// is NULL (so the row is dropped) when `col` is NULL, but users picking
// "status is not draft" expect rows with no status at all to match.
// This mirrors `notEmpty`, which already treats NULL as empty.
const orNull = (col: AnyColumn, cond: SQL): SQL => orSql(isNull(col), cond)!

// Some ops share an op name across very different SQL semantics — `contains`
// is ILIKE for string fields but `= ANY(col)` for PG array fields, and
// `isEmpty` is `IS NULL OR = ''` for strings vs `cardinality(col) = 0` for
// arrays. `notEmpty` is the boolean negation of `isEmpty` (NULL → empty,
// not "unknown") so callers don't need a separate `not(isEmpty)` wrapper.
// The op translator branches on the effective typeId via the OpContext.

// String fields ignore case unless declared `caseSensitive`: equality
// folds both sides with `lower()`, pattern ops use `ILIKE`. Only plain
// string fields (and customs delegating to `string`) fold for equality;
// pattern ops (`contains` & co.) on undelegated customs keep `ILIKE`
// unless the field says `caseSensitive`.
const foldsCase = (field: FieldDef): boolean =>
  effectiveTypeId(field) === 'string' && !field.caseSensitive
const likeOp = (field: FieldDef) => (field.caseSensitive ? like : ilike)
const likeSql = (field: FieldDef) => (field.caseSensitive ? sql`LIKE` : sql`ILIKE`)
const lowerEq = (col: AnyColumn, v: unknown): SQL => sql`lower(${col}) = lower(${String(v)})`
const lowerIn = (col: AnyColumn, vs: unknown[]): SQL =>
  sql`lower(${col}) IN (${sql.join(vs.map((v) => sql`lower(${String(v)})`), sql`, `)})`

const dayRange = (col: AnyColumn, from: unknown, toExclusive: Date, ctx: OpContext): SQL =>
  andSql(gte(col, dayStart(col, from, ctx) as never), lt(col, toExclusive as never))!

const eqSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
  const { field } = ctx
  if (isDayField(field)) return dayRange(col, v, nextDay(col, v, ctx), ctx)
  if (foldsCase(field)) return lowerEq(col, v)
  return eq(col, coerceDateValue(field, v) as never)
}
const inSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
  if (foldsCase(ctx.field)) return lowerIn(col, v as unknown[])
  return inArray(col, coerceDateValue(ctx.field, v) as never[])
}
const betweenSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
  if (isDayField(ctx.field)) {
    const [a, b] = v as [unknown, unknown]
    return dayRange(col, a, nextDay(col, b, ctx), ctx)
  }
  const [a, b] = coerceDateValue(ctx.field, v) as [unknown, unknown]
  return between(col, a as never, b as never)
}

// `unit` is interpolated into `sql.raw`, so re-check it even though core
// already validated it: a failed re-check means a tampered AST or a
// custom op flowing through, and must not become SQL.
const intervalSql = (v: unknown): SQL => {
  const { amount, unit } = (v ?? {}) as { amount: unknown, unit: unknown }
  const a = Number(amount)
  if (!Number.isFinite(a) || a <= 0) {
    throw new Error(`[dql-kit/drizzle-pg] relative value: amount must be a positive finite number, got ${String(amount)}`)
  }
  if (!isRelativeUnit(unit)) {
    throw new Error(`[dql-kit/drizzle-pg] relative value: unit must be one of minute/hour/day/week/month/year, got ${String(unit)}`)
  }
  return sql.raw(`INTERVAL '${a} ${unit}'`)
}
// `date` fields: whole days around today in the translator's zone,
// computed with the same helper as the in-memory evaluator and passed as
// parameters, so a `date` and a `timestamp` column cut days the same way.
const relativeDays = (op: 'inLast' | 'inNext', v: unknown, ctx: OpContext) => {
  intervalSql(v) // validate
  return relativeDateRange(op, v as { amount: number, unit: RelativeUnit }, ctx.now, { timeZone: ctx.timeZone })
}
const inLastSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
  if (isDayField(ctx.field)) return gte(col, dayStart(col, relativeDays('inLast', v, ctx).from, ctx) as never)
  return sql`${col} >= NOW() - ${intervalSql(v)}`
}
// Calendar periods, `[start of from, start of to)`. Bounds are computed
// in JS (see `periodRange`) and sent as parameters; the zone never
// reaches the SQL text.
const inPeriodSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
  if (!isPeriodValue(v)) {
    throw new Error(`[dql-kit/drizzle-pg] inPeriod value must be { unit, offset }, got ${JSON.stringify(v)}`)
  }
  const r = periodRange(v, ctx.now, { timeZone: ctx.timeZone, weekStartsOn: ctx.weekStartsOn })
  if (isDayField(ctx.field)) return dayRange(col, r.from, dayStart(col, r.to, ctx), ctx)
  return andSql(
    gte(col, new Date(startOfZonedDay(r.from, ctx.timeZone)) as never),
    lt(col, new Date(startOfZonedDay(r.to, ctx.timeZone)) as never),
  )!
}
const isEmptySql = (col: AnyColumn, field: FieldDef): SQL => {
  const t = effectiveTypeId(field)
  // Array empty: NULL or zero-length. cardinality(NULL) is NULL, so the
  // explicit IS NULL branch is required to match the "no items" intent.
  if (t === 'array') return orSql(isNull(col), sql`cardinality(${col}) = 0`)!
  if (t === 'string') return orSql(isNull(col), eq(col, '' as never))!
  // Everything else (numbers, dates, enums, ids, ...): only NULL is empty.
  // Comparing those columns with '' would be a type error in PG.
  return isNull(col)
}

const columnOps: Record<string, ColumnOp> = {
  eq:           (col, v, ctx) => eqSql(col, v, ctx),
  neq:          (col, v, ctx) => orNull(col, sql`NOT (${eqSql(col, v, ctx)})`),
  in:           (col, v, ctx) => inSql(col, v, ctx),
  notIn:        (col, v, ctx) => orNull(col, sql`NOT (${inSql(col, v, ctx)})`),
  contains:     (col, v, ctx) => {
    if (effectiveTypeId(ctx.field) === 'array') {
      // PG: scalar = ANY(array_column)
      return sql`${v} = ANY(${col})`
    }
    return likeOp(ctx.field)(col, `%${escapeLike(String(v))}%`)
  },
  notContains:  (col, v, ctx) => {
    if (effectiveTypeId(ctx.field) === 'array') {
      // PG: scalar <> ALL(array_column). A NULL column has no elements,
      // so it can't contain the value: keep the row. (NULL *elements*
      // still make `<> ALL` NULL; arrays with NULL items are not modelled.)
      return orNull(col, sql`${v} <> ALL(${col})`)
    }
    return orNull(col, sql`${col} NOT ${likeSql(ctx.field)} ${`%${escapeLike(String(v))}%`}`)
  },
  startsWith:   (col, v, ctx) => likeOp(ctx.field)(col, `${escapeLike(String(v))}%`),
  endsWith:     (col, v, ctx) => likeOp(ctx.field)(col, `%${escapeLike(String(v))}`),
  isEmpty:      (col, _v, ctx) => isEmptySql(col, ctx.field),
  // Boolean negation of isEmpty: NULL counts as empty, not "unknown".
  notEmpty:     (col, _v, ctx) => sql`NOT (${isEmptySql(col, ctx.field)})`,
  gt:           (col, v, ctx) => gt(col, coerceDateValue(ctx.field, v) as never),
  gte:          (col, v, ctx) => gte(col, coerceDateValue(ctx.field, v) as never),
  lt:           (col, v, ctx) => lt(col, coerceDateValue(ctx.field, v) as never),
  lte:          (col, v, ctx) => lte(col, coerceDateValue(ctx.field, v) as never),
  between:      (col, v, ctx) => betweenSql(col, v, ctx),
  notBetween:   (col, v, ctx) => orNull(col, sql`NOT (${betweenSql(col, v, ctx)})`),
  before:       (col, v, ctx) => {
    if (isDayField(ctx.field)) return lt(col, dayStart(col, v, ctx) as never)
    return lt(col, coerceDateValue(ctx.field, v) as never)
  },
  after:        (col, v, ctx) => {
    if (isDayField(ctx.field)) return gte(col, nextDay(col, v, ctx) as never)
    return gt(col, coerceDateValue(ctx.field, v) as never)
  },
  onOrBefore:   (col, v, ctx) => {
    if (isDayField(ctx.field)) return lt(col, nextDay(col, v, ctx) as never)
    return lte(col, coerceDateValue(ctx.field, v) as never)
  },
  onOrAfter:    (col, v, ctx) => {
    if (isDayField(ctx.field)) return gte(col, dayStart(col, v, ctx) as never)
    return gte(col, coerceDateValue(ctx.field, v) as never)
  },
  inLast:       (col, v, ctx) => inLastSql(col, v, ctx),
  inNext:       (col, v, ctx) => {
    if (isDayField(ctx.field)) {
      const r = relativeDays('inNext', v, ctx)
      return dayRange(col, r.from, nextDay(col, r.to, ctx), ctx)
    }
    return sql`(${col} >= NOW() AND ${col} <= NOW() + ${intervalSql(v)})`
  },
  // Exact negation of inLast: NULL rows match ("not seen recently"
  // includes "never seen").
  notInLast:    (col, v, ctx) => orNull(col, sql`NOT (${inLastSql(col, v, ctx)})`),
  inPeriod:     (col, v, ctx) => inPeriodSql(col, v, ctx),
  // PG: array @> array — left contains every element of right (superset).
  // Use drizzle's arrayContains helper rather than inlining `@>` so the
  // parameter is encoded as a PG ARRAY literal instead of a record/tuple.
  // The helper rejects an empty array. `parseAst` already refuses empty
  // lists, so this only guards ASTs that were cast to `CheckedAST`; emit
  // PG's own answer (`x @> '{}'` is always true) instead of throwing.
  containsAll:  (col, v) => {
    const arr = (v as unknown[]) ?? []
    if (arr.length === 0) return sql`true`
    return arrayContains(col, arr as never[])
  },
  // PG: array && array — at least one shared element. An empty list
  // shares nothing (only reachable through a cast AST, see containsAll).
  containsAny:  (col, v) => {
    const arr = (v as unknown[]) ?? []
    if (arr.length === 0) return sql`false`
    return arrayOverlaps(col, arr as never[])
  },
}

// The built-in handlers all need a column. A field mapped to `null` in
// `columns` must have a custom handler for every op (checked when the
// translator is built); this guard covers a custom handler that hands
// such a field on to a built-in one.
export const drizzleOps: Record<string, OpTranslator> = Object.fromEntries(
  Object.entries(columnOps).map(([name, fn]): [string, OpTranslator] => [
    name,
    (col, v, ctx) => {
      if (!col) {
        throw new Error(
          `[dql-kit/drizzle-pg] Built-in op "${name}" needs a column, but this field is mapped to null. `
            + 'Handle it in a custom op instead.',
        )
      }
      return fn(col, v, ctx)
    },
  ]),
)

export const passthrough = { andSql, orSql, isNotNull } as Record<string, unknown>
export type { SQL }
