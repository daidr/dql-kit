import {
  buildOps,
  escapeLike,
  guardOps,
  type Dialect,
  type OpTranslator,
} from '@dql-kit/drizzle-common'
import {
  arrayContains,
  arrayOverlaps,
  ilike,
  isNull,
  like,
  or as orSql,
  sql,
  type AnyColumn,
} from 'drizzle-orm'

const lower = (v: string) => sql`lower(${v})`

// PostgreSQL. Instants go through the column's own encoder (drizzle's
// `timestamp` / `date` columns turn a `Date` into what the driver
// wants), plain days are sent as UTC midnight, which PG casts back to
// the same `date`. Relative ops on instants use the database's `NOW()`.
export const pgDialect: Dialect = {
  name: 'drizzle-pg',
  instant: (_col, d) => d,
  isDayColumn: (col) => {
    const getType = (col as { getSQLType?: () => string }).getSQLType
    return typeof getType === 'function' && getType.call(col) === 'date'
  },
  day: (_col, day) => new Date(Date.parse(`${day}T00:00:00Z`)),
  foldEq: (col, v) => sql`lower(${col}) = ${lower(v)}`,
  foldIn: (col, vs) => sql`lower(${col}) IN (${sql.join(vs.map(lower), sql`, `)})`,
  match: (col, needle, kind, fold) => {
    const e = escapeLike(needle)
    const pattern = kind === 'contains' ? `%${e}%` : kind === 'startsWith' ? `${e}%` : `%${e}`
    return (fold ? ilike : like)(col, pattern)
  },
  // scalar = ANY(array_column)
  arrayHas: (col, v) => sql`${v} = ANY(${col})`,
  // array @> array / array && array. drizzle's helpers encode the
  // parameter as a PG ARRAY literal rather than a record/tuple.
  arrayHasAll: (col, vs) => arrayContains(col, vs as never[]),
  arrayHasAny: (col, vs) => arrayOverlaps(col, vs as never[]),
  // cardinality(NULL) is NULL, so the explicit IS NULL branch is needed
  // to match the "no items" intent.
  arrayIsEmpty: (col: AnyColumn) => orSql(isNull(col), sql`cardinality(${col}) = 0`)!,
  // `unit` is interpolated into `sql.raw`; `checkRelative` has re-checked it.
  relativeInstant: (col, op, { amount, unit }) => {
    const interval = sql.raw(`INTERVAL '${amount} ${unit}'`)
    return op === 'inLast'
      ? sql`${col} >= NOW() - ${interval}`
      : sql`(${col} >= NOW() AND ${col} <= NOW() + ${interval})`
  },
}

export const drizzleOps: Record<string, OpTranslator> = guardOps('drizzle-pg', buildOps(pgDialect))
