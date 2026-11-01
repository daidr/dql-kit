import {
  isPeriodValue,
  isRelativeUnit,
  periodRange,
  relativeDateRange,
  shiftByInterval,
  startOfZonedDay,
  type FieldDef,
  type RelativeUnit,
} from '@dql-kit/core'
import {
  and as andSql,
  between,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or as orSql,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import type { ColumnOp, OpContext, OpTranslator } from './types.ts'

/** A relative value (`{ amount, unit }`) after re-validation. */
export type RelativeValue = { amount: number, unit: RelativeUnit }

/**
 * What a SQL dialect supplies to the shared op table: how to match
 * strings, how to query array columns, how dates and instants are
 * passed, and how "now" is read. Everything else (NULL handling of
 * negated ops, half-open day ranges, calendar bounds, value coercion)
 * is shared, so every adapter follows the same op semantics.
 */
export type Dialect = {
  /** Package name used in error messages, e.g. `drizzle-pg`. */
  name: string
  /**
   * A comparison operand for instant `d` against `col`. Return a value
   * for drizzle to encode with the column, or a `sql` chunk to send
   * as-is.
   */
  instant: (col: AnyColumn, d: Date) => unknown
  /** Whether `col` holds plain calendar days (not shifted by the zone). */
  isDayColumn: (col: AnyColumn) => boolean
  /** Operand for plain day `day` (`YYYY-MM-DD`) on a day column. */
  day: (col: AnyColumn, day: string) => unknown
  /** Case-insensitive equality / list membership for strings. */
  foldEq: (col: AnyColumn, v: string) => SQL
  foldIn: (col: AnyColumn, vs: string[]) => SQL
  /** Case-sensitive equality / list membership for strings. */
  exactEq?: (col: AnyColumn, v: string) => SQL
  exactIn?: (col: AnyColumn, vs: string[]) => SQL
  /**
   * Substring match. `kind` says where `needle` must occur; `fold` is
   * true when the match ignores case.
   */
  match: (col: AnyColumn, needle: string, kind: 'contains' | 'startsWith' | 'endsWith', fold: boolean) => SQL
  /** Array columns. `v` / `vs` are element values. */
  arrayHas: (col: AnyColumn, v: unknown) => SQL
  arrayHasAll: (col: AnyColumn, vs: unknown[]) => SQL
  arrayHasAny: (col: AnyColumn, vs: unknown[]) => SQL
  arrayIsEmpty: (col: AnyColumn) => SQL
  /**
   * Relative ops on instants, measured from the database clock. When
   * absent, bounds are computed from the translator's clock (`now`)
   * and sent as parameters.
   */
  relativeInstant?: (col: AnyColumn, op: 'inLast' | 'inNext', v: RelativeValue) => SQL
}

// Resolve the *effective* type for op-handler dispatch. A custom typeId
// with `delegateTo: 'array'` triggers the array branch of `contains`;
// without delegateTo, custom typeIds fall through to the string branch.
export const effectiveTypeId = (field: FieldDef): string =>
  field.delegateTo ?? field.typeId

export const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`)

// For date/datetime fields the AST carries an ISO string (that's what
// `checkPrimitive` validates). Coerce to `Date` so the dialect can turn
// it into whatever the column expects. Element type drives coercion for
// arrays, so `in` / `notIn` over a date field also coerce per-element.
const dateElementTypeId = (field: FieldDef): string => {
  const inner = field.typeId === 'array' && field.itemType ? field.itemType : field
  return inner.delegateTo ?? inner.typeId
}
const isDateValuedField = (field: FieldDef): boolean => {
  const t = dateElementTypeId(field)
  return t === 'date' || t === 'datetime'
}

/** `date` values are calendar days, compared as half-open day ranges. */
export const isDayField = (field: FieldDef): boolean => effectiveTypeId(field) === 'date'

// String fields ignore case unless declared `caseSensitive`. Only plain
// string fields (and customs delegating to `string`) fold for equality;
// pattern ops on undelegated customs fold unless the field says
// `caseSensitive`.
export const foldsCase = (field: FieldDef): boolean =>
  effectiveTypeId(field) === 'string' && !field.caseSensitive

// Negated ops keep NULL rows. Under SQL's three-valued logic `col <> v`
// is NULL (so the row is dropped) when `col` is NULL, but users picking
// "status is not draft" expect rows with no status at all to match.
// This mirrors `notEmpty`, which already treats NULL as empty.
export const orNull = (col: AnyColumn, cond: SQL): SQL => orSql(isNull(col), cond)!

const DAY_MS = 86_400_000
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

/**
 * Re-check a relative value before it reaches SQL, even though core
 * already validated it: a failure means a tampered AST or a custom op
 * flowing through.
 */
export const checkRelative = (name: string, v: unknown): RelativeValue => {
  const { amount, unit } = (v ?? {}) as { amount: unknown, unit: unknown }
  const a = Number(amount)
  if (!Number.isFinite(a) || a <= 0) {
    throw new Error(`[dql-kit/${name}] relative value: amount must be a positive finite number, got ${String(amount)}`)
  }
  if (!isRelativeUnit(unit)) {
    throw new Error(`[dql-kit/${name}] relative value: unit must be one of minute/hour/day/week/month/year, got ${String(unit)}`)
  }
  return { amount: a, unit }
}

/**
 * The built-in op table for a dialect. Handlers always get a column;
 * `guardOps` turns them into public `OpTranslator`s.
 */
export const buildOps = (d: Dialect): Record<string, ColumnOp> => {
  const toInstant = (col: AnyColumn, v: unknown): unknown => {
    if (typeof v !== 'string') return v
    const t = new Date(v)
    return Number.isNaN(t.getTime()) ? v : d.instant(col, t)
  }
  const coerce = (col: AnyColumn, field: FieldDef, v: unknown): unknown => {
    if (!isDateValuedField(field)) return v
    if (Array.isArray(v)) return v.map((x) => toInstant(col, x))
    return toInstant(col, v)
  }

  // A day starts at midnight in the translator's `timeZone` on instant
  // columns. A plain day column holds days, so its bound is the day itself.
  const dayStart = (col: AnyColumn, day: unknown, ctx: OpContext): unknown => {
    const s = String(day).slice(0, 10)
    return d.isDayColumn(col) ? d.day(col, s) : d.instant(col, new Date(startOfZonedDay(s, ctx.timeZone)))
  }
  const nextDay = (col: AnyColumn, day: unknown, ctx: OpContext): unknown =>
    dayStart(col, addDays(String(day).slice(0, 10), 1), ctx)
  const dayRange = (col: AnyColumn, from: unknown, toExclusive: unknown, ctx: OpContext): SQL =>
    andSql(gte(col, dayStart(col, from, ctx) as never), lt(col, toExclusive as never))!

  const exactEq = d.exactEq ?? ((col: AnyColumn, v: string) => eq(col, v as never))
  const exactIn = d.exactIn ?? ((col: AnyColumn, vs: string[]) => inArray(col, vs as never[]))

  const eqSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
    const { field } = ctx
    if (isDayField(field)) return dayRange(col, v, nextDay(col, v, ctx), ctx)
    if (foldsCase(field)) return d.foldEq(col, String(v))
    if (effectiveTypeId(field) === 'string') return exactEq(col, String(v))
    return eq(col, coerce(col, field, v) as never)
  }
  const inSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
    if (foldsCase(ctx.field)) return d.foldIn(col, (v as unknown[]).map(String))
    if (effectiveTypeId(ctx.field) === 'string') return exactIn(col, (v as unknown[]).map(String))
    return inArray(col, coerce(col, ctx.field, v) as never[])
  }
  const betweenSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
    if (isDayField(ctx.field)) {
      const [a, b] = v as [unknown, unknown]
      return dayRange(col, a, nextDay(col, b, ctx), ctx)
    }
    const [a, b] = coerce(col, ctx.field, v) as [unknown, unknown]
    return between(col, a as never, b as never)
  }

  // `date` fields: whole days around today in the translator's zone,
  // computed with the same helper as the in-memory evaluator and passed
  // as parameters, so a day column and an instant column cut days the
  // same way.
  const relativeDays = (op: 'inLast' | 'inNext', v: unknown, ctx: OpContext) =>
    relativeDateRange(op, checkRelative(d.name, v), ctx.now, { timeZone: ctx.timeZone })
  const relativeInstant = (col: AnyColumn, op: 'inLast' | 'inNext', v: unknown, ctx: OpContext): SQL => {
    const rel = checkRelative(d.name, v)
    if (d.relativeInstant) return d.relativeInstant(col, op, rel)
    const now = d.instant(col, ctx.now)
    const bound = d.instant(col, shiftByInterval(ctx.now, rel.amount, rel.unit, op === 'inLast' ? -1 : 1))
    return op === 'inLast'
      ? gte(col, bound as never)
      : andSql(gte(col, now as never), lte(col, bound as never))!
  }
  const inLastSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
    if (isDayField(ctx.field)) return gte(col, dayStart(col, relativeDays('inLast', v, ctx).from, ctx) as never)
    return relativeInstant(col, 'inLast', v, ctx)
  }
  // Calendar periods, `[start of from, start of to)`. Bounds are computed
  // in JS (see `periodRange`) and sent as parameters; the zone never
  // reaches the SQL text.
  const inPeriodSql = (col: AnyColumn, v: unknown, ctx: OpContext): SQL => {
    if (!isPeriodValue(v)) {
      throw new Error(`[dql-kit/${d.name}] inPeriod value must be { unit, offset }, got ${JSON.stringify(v)}`)
    }
    const r = periodRange(v, ctx.now, { timeZone: ctx.timeZone, weekStartsOn: ctx.weekStartsOn })
    if (isDayField(ctx.field)) return dayRange(col, r.from, dayStart(col, r.to, ctx), ctx)
    return andSql(
      gte(col, d.instant(col, new Date(startOfZonedDay(r.from, ctx.timeZone))) as never),
      lt(col, d.instant(col, new Date(startOfZonedDay(r.to, ctx.timeZone))) as never),
    )!
  }
  const isEmptySql = (col: AnyColumn, field: FieldDef): SQL => {
    const t = effectiveTypeId(field)
    if (t === 'array') return d.arrayIsEmpty(col)
    if (t === 'string') return orSql(isNull(col), eq(col, '' as never))!
    // Everything else (numbers, dates, enums, ids, ...): only NULL is
    // empty. Comparing those columns with '' would be a type error.
    return isNull(col)
  }
  const matchSql = (kind: 'contains' | 'startsWith' | 'endsWith') => (col: AnyColumn, v: unknown, ctx: OpContext) =>
    d.match(col, String(v), kind, !ctx.field.caseSensitive)
  const isArray = (ctx: OpContext) => effectiveTypeId(ctx.field) === 'array'

  return {
    eq:           (col, v, ctx) => eqSql(col, v, ctx),
    neq:          (col, v, ctx) => orNull(col, sql`NOT (${eqSql(col, v, ctx)})`),
    in:           (col, v, ctx) => inSql(col, v, ctx),
    notIn:        (col, v, ctx) => orNull(col, sql`NOT (${inSql(col, v, ctx)})`),
    contains:     (col, v, ctx) => (isArray(ctx) ? d.arrayHas(col, v) : matchSql('contains')(col, v, ctx)),
    // An array column that is NULL has no elements, so it can't contain
    // the value: keep the row.
    notContains:  (col, v, ctx) =>
      orNull(col, sql`NOT (${isArray(ctx) ? d.arrayHas(col, v) : matchSql('contains')(col, v, ctx)})`),
    startsWith:   matchSql('startsWith'),
    endsWith:     matchSql('endsWith'),
    isEmpty:      (col, _v, ctx) => isEmptySql(col, ctx.field),
    // Boolean negation of isEmpty: NULL counts as empty, not "unknown".
    notEmpty:     (col, _v, ctx) => sql`NOT (${isEmptySql(col, ctx.field)})`,
    gt:           (col, v, ctx) => gt(col, coerce(col, ctx.field, v) as never),
    gte:          (col, v, ctx) => gte(col, coerce(col, ctx.field, v) as never),
    lt:           (col, v, ctx) => lt(col, coerce(col, ctx.field, v) as never),
    lte:          (col, v, ctx) => lte(col, coerce(col, ctx.field, v) as never),
    between:      (col, v, ctx) => betweenSql(col, v, ctx),
    notBetween:   (col, v, ctx) => orNull(col, sql`NOT (${betweenSql(col, v, ctx)})`),
    before:       (col, v, ctx) => {
      if (isDayField(ctx.field)) return lt(col, dayStart(col, v, ctx) as never)
      return lt(col, coerce(col, ctx.field, v) as never)
    },
    after:        (col, v, ctx) => {
      if (isDayField(ctx.field)) return gte(col, nextDay(col, v, ctx) as never)
      return gt(col, coerce(col, ctx.field, v) as never)
    },
    onOrBefore:   (col, v, ctx) => {
      if (isDayField(ctx.field)) return lt(col, nextDay(col, v, ctx) as never)
      return lte(col, coerce(col, ctx.field, v) as never)
    },
    onOrAfter:    (col, v, ctx) => {
      if (isDayField(ctx.field)) return gte(col, dayStart(col, v, ctx) as never)
      return gte(col, coerce(col, ctx.field, v) as never)
    },
    inLast:       (col, v, ctx) => inLastSql(col, v, ctx),
    inNext:       (col, v, ctx) => {
      if (isDayField(ctx.field)) {
        const r = relativeDays('inNext', v, ctx)
        return dayRange(col, r.from, nextDay(col, r.to, ctx), ctx)
      }
      return relativeInstant(col, 'inNext', v, ctx)
    },
    // Exact negation of inLast: NULL rows match ("not seen recently"
    // includes "never seen").
    notInLast:    (col, v, ctx) => orNull(col, sql`NOT (${inLastSql(col, v, ctx)})`),
    inPeriod:     (col, v, ctx) => inPeriodSql(col, v, ctx),
    // `parseAst` refuses empty lists, so an empty one only comes from a
    // cast AST; answer like PG does (`x @> '{}'` is true, `&&` false).
    containsAll:  (col, v) => {
      const arr = (v as unknown[]) ?? []
      if (arr.length === 0) return sql`true`
      return d.arrayHasAll(col, arr)
    },
    containsAny:  (col, v) => {
      const arr = (v as unknown[]) ?? []
      if (arr.length === 0) return sql`false`
      return d.arrayHasAny(col, arr)
    },
  }
}

/**
 * Public handlers from built-in ones. A field mapped to `null` in
 * `columns` must have a custom handler for every op (checked when the
 * translator is built); this guard covers a custom handler that hands
 * such a field on to a built-in one.
 */
export const guardOps = (name: string, ops: Record<string, ColumnOp>): Record<string, OpTranslator> =>
  Object.fromEntries(
    Object.entries(ops).map(([op, fn]): [string, OpTranslator] => [
      op,
      (col, v, ctx) => {
        if (!col) {
          throw new Error(
            `[dql-kit/${name}] Built-in op "${op}" needs a column, but this field is mapped to null. `
              + 'Handle it in a custom op instead.',
          )
        }
        return fn(col, v, ctx)
      },
    ]),
  )
