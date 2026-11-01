import type { CheckedAST, FieldDef, FilterSchema, ValidNode } from './types.ts'

/**
 * In-memory evaluation of a parsed AST against plain rows: the same
 * filter a SQL translator turns into a WHERE clause, applied to data
 * already in memory (client-side lists, optimistic updates, tests).
 *
 * Semantics follow the "Op semantics" table in DESIGN.md exactly, and
 * a shared case suite runs both this evaluator and the SQL adapters, so
 * the two can't drift apart.
 *
 * Row values are read as a database driver would return them:
 * - `null` and `undefined` are both "no value" (SQL NULL);
 * - `date` / `datetime` columns may hold a `Date` or an ISO string;
 *   `date` values compare as UTC calendar days, `datetime` as instants;
 * - array columns are JS arrays (or `null`).
 */

export type MatchContext = {
  field: FieldDef
  /** The evaluation clock, for relative ops such as `inLast`. */
  now: Date
}

/**
 * Evaluates one condition on one row. `actual` is the row's value for
 * the field (`null` / `undefined` for no value), `value` the condition's
 * value as checked by `parseAst`.
 */
export type OpMatcher = (actual: unknown, value: unknown, ctx: MatchContext) => boolean

export type CreateMatcherOptions<S extends FilterSchema, Row> = {
  schema: S
  /**
   * Extra or replacement op matchers, merged over the built-ins at
   * construction (the matcher counterpart of the translator's `ops`).
   */
  ops?: Record<string, OpMatcher>
  /** Read a field's value from a row. Defaults to `row[fieldKey]`. */
  get?: (row: Row, fieldKey: string) => unknown
  /** Clock for relative ops. Defaults to the current time on each call. */
  now?: () => Date
}

export type Matcher<S extends FilterSchema = FilterSchema, Row = Record<string, unknown>> = {
  /** Whether `row` satisfies `ast`. An empty root group matches every row. */
  matches(ast: CheckedAST<S>, row: Row): boolean
  /** The rows that satisfy `ast`, in their original order. */
  filter(ast: CheckedAST<S>, rows: readonly Row[]): Row[]
}

const DAY_MS = 86_400_000
const isNull = (v: unknown): v is null | undefined => v === null || v === undefined

const effectiveTypeId = (field: FieldDef): string => field.delegateTo ?? field.typeId
const elementField = (field: FieldDef): FieldDef =>
  field.typeId === 'array' && field.itemType ? field.itemType : field
const elementTypeId = (field: FieldDef): string => effectiveTypeId(elementField(field))

// Comparable form of a scalar, by the field's (element) type: `date` →
// UTC day number, `datetime` → epoch ms, everything else unchanged.
// Returns `undefined` for a value that isn't a valid date, so a garbage
// row value never matches instead of comparing as NaN.
const toInstant = (v: unknown): number | undefined => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : Number.NaN
  return Number.isNaN(t) ? undefined : t
}
const toDay = (v: unknown): number | undefined => {
  // A bare `YYYY-MM-DD` is already a UTC day (`Date.parse` reads it as
  // UTC midnight); a timestamp is cut to the UTC day it falls in, the
  // same as the half-open range the SQL adapter emits.
  const t = toInstant(v)
  return t === undefined ? undefined : Math.floor(t / DAY_MS)
}
const keyOf = (field: FieldDef, v: unknown): unknown => {
  switch (elementTypeId(field)) {
    case 'date':
      return toDay(v)
    case 'datetime':
      return toInstant(v)
    default:
      return v
  }
}

const same = (field: FieldDef, a: unknown, b: unknown): boolean => {
  const ka = keyOf(field, a)
  return ka !== undefined && ka === keyOf(field, b)
}
const compare = (field: FieldDef, a: unknown, b: unknown): number | undefined => {
  const ka = keyOf(field, a)
  const kb = keyOf(field, b)
  if (ka === undefined || kb === undefined || isNull(ka) || isNull(kb)) return undefined
  if (typeof ka === 'number' && typeof kb === 'number') return ka - kb
  if (typeof ka === 'string' && typeof kb === 'string') return ka < kb ? -1 : ka > kb ? 1 : 0
  return undefined
}
const cmp = (pred: (c: number) => boolean) => (actual: unknown, value: unknown, ctx: MatchContext) => {
  if (isNull(actual)) return false
  const c = compare(ctx.field, actual, value)
  return c !== undefined && pred(c)
}

const lower = (v: unknown): string => String(v).toLowerCase()
const isArrayField = (field: FieldDef): boolean => effectiveTypeId(field) === 'array'
const asArray = (v: unknown): unknown[] | undefined => (Array.isArray(v) ? v : undefined)

const eqOp: OpMatcher = (actual, value, ctx) => !isNull(actual) && same(ctx.field, actual, value)
const inOp: OpMatcher = (actual, value, ctx) =>
  !isNull(actual) && (value as unknown[]).some((v) => same(ctx.field, actual, v))
const containsOp: OpMatcher = (actual, value, ctx) => {
  if (isNull(actual)) return false
  if (isArrayField(ctx.field)) {
    return (asArray(actual) ?? []).some((el) => same(ctx.field, el, value))
  }
  return lower(actual).includes(lower(value))
}
const isEmptyOp: OpMatcher = (actual, _value, ctx) => {
  if (isNull(actual)) return true
  if (isArrayField(ctx.field)) return (asArray(actual) ?? []).length === 0
  return actual === ''
}

// `inLast` subtracts the interval from `now` the way PostgreSQL does:
// fixed-length units in milliseconds, months on the calendar (clamped to
// the end of a shorter month; a fractional month adds 30-day days).
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
}
const subtractInterval = (now: Date, amount: number, unit: string): number => {
  const fixed = UNIT_MS[unit]
  if (fixed !== undefined) return now.getTime() - amount * fixed
  // month
  const whole = Math.trunc(amount)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() - whole
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const shifted = Date.UTC(
    y, m, Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds(),
  )
  return shifted - (amount - whole) * 30 * DAY_MS
}

export const builtinMatchers: Readonly<Record<string, OpMatcher>> = Object.freeze({
  eq: eqOp,
  neq: (actual, value, ctx) => !eqOp(actual, value, ctx),
  in: inOp,
  notIn: (actual, value, ctx) => !inOp(actual, value, ctx),
  contains: containsOp,
  notContains: (actual, value, ctx) => !containsOp(actual, value, ctx),
  startsWith: (actual, value) => !isNull(actual) && lower(actual).startsWith(lower(value)),
  endsWith: (actual, value) => !isNull(actual) && lower(actual).endsWith(lower(value)),
  isEmpty: isEmptyOp,
  notEmpty: (actual, value, ctx) => !isEmptyOp(actual, value, ctx),
  gt: cmp((c) => c > 0),
  gte: cmp((c) => c >= 0),
  lt: cmp((c) => c < 0),
  lte: cmp((c) => c <= 0),
  before: cmp((c) => c < 0),
  after: cmp((c) => c > 0),
  between: (actual, value, ctx) => {
    const [lo, hi] = value as [unknown, unknown]
    return cmp((c) => c >= 0)(actual, lo, ctx) && cmp((c) => c <= 0)(actual, hi, ctx)
  },
  inLast: (actual, value, ctx) => {
    if (isNull(actual)) return false
    const t = toInstant(actual)
    const { amount, unit } = value as { amount: number, unit: string }
    return t !== undefined && t >= subtractInterval(ctx.now, amount, unit)
  },
  containsAll: (actual, value, ctx) => {
    const arr = asArray(actual)
    if (!arr) return false
    return (value as unknown[]).every((v) => arr.some((el) => same(ctx.field, el, v)))
  },
})

/**
 * Build a matcher for a schema. Like the SQL translators it only takes
 * a `CheckedAST` (run untrusted input through `parseAst` first), checks
 * at runtime that each op is declared on its field, and throws on an op
 * with no matcher.
 */
export const createMatcher = <S extends FilterSchema, Row = Record<string, unknown>>(
  opts: CreateMatcherOptions<S, Row>,
): Matcher<S, Row> => {
  const ops: Record<string, OpMatcher> = { ...builtinMatchers, ...opts.ops }
  const get = opts.get ?? ((row: Row, key: string) => (row as Record<string, unknown>)[key])
  const clock = opts.now ?? (() => new Date())
  const fields = opts.schema.fields as Record<string, FieldDef>

  const evalNode = (node: ValidNode, row: Row, now: Date): boolean => {
    if ('combinator' in node) {
      if (node.children.length === 0) return true
      return node.combinator === 'and'
        ? node.children.every((c) => evalNode(c, row, now))
        : node.children.some((c) => evalNode(c, row, now))
    }
    const field = Object.prototype.hasOwnProperty.call(fields, node.field) ? fields[node.field] : undefined
    if (!field) {
      throw new Error(`[dql-kit/core] AST references unknown field "${node.field}" not present in schema.`)
    }
    if (!field.ops.some((o) => o.name === node.op)) {
      throw new Error(
        `[dql-kit/core] Op "${node.op}" is not allowed on field "${node.field}". `
          + 'Parse untrusted input with parseAst() before matching.',
      )
    }
    const fn = Object.prototype.hasOwnProperty.call(ops, node.op) ? ops[node.op] : undefined
    if (!fn) {
      throw new Error(
        `[dql-kit/core] No matcher registered for op "${node.op}". `
          + `Pass it via createMatcher({ ops: { ${node.op}: ... } }).`,
      )
    }
    return fn(get(row, node.field), node.value, { field, now })
  }

  return {
    matches(ast, row) {
      return evalNode(ast, row, clock())
    },
    filter(ast, rows) {
      // One clock reading per call, so every row sees the same `now`.
      const now = clock()
      return rows.filter((row) => evalNode(ast, row, now))
    },
  }
}
