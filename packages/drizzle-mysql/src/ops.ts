import {
  buildOps,
  guardOps,
  type Dialect,
  type OpTranslator,
} from '@dql-kit/drizzle-common'
import { isNull, or as orSql, sql, type SQL } from 'drizzle-orm'

const sqlType = (col: unknown): string => {
  const getType = (col as { getSQLType?: () => string }).getSQLType
  return typeof getType === 'function' ? getType.call(col) : ''
}
// `!` instead of backslash, so patterns work with and without the
// NO_BACKSLASH_ESCAPES SQL mode.
const escapeLike = (v: string) => v.replace(/[!%_]/g, (c) => `!${c}`)
// `YYYY-MM-DD HH:MM:SS.mmm` in UTC, the literal MySQL reads into
// DATETIME / TIMESTAMP.
const utcLiteral = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '')
const jsonArray = (vs: unknown[]): SQL => sql`JSON_ARRAY(${sql.join(vs.map((v) => sql`${v}`), sql`, `)})`
const binary = (v: string): SQL => sql`CAST(${v} AS BINARY)`

// MySQL. Instants are sent as UTC literals, so DATETIME columns are
// read as UTC (and TIMESTAMP columns need a UTC session time zone).
// String comparisons follow the column's collation: with a `_ci`
// collation (the default) strings ignore case; `caseSensitive` fields
// compare as binary. Arrays are JSON columns.
export const mysqlDialect: Dialect = {
  name: 'drizzle-mysql',
  instant: (_col, d) => sql`${utcLiteral(d)}`,
  isDayColumn: (col) => sqlType(col) === 'date',
  day: (_col, day) => sql`${day}`,
  foldEq: (col, v) => sql`${col} = ${v}`,
  foldIn: (col, vs) => sql`${col} IN (${sql.join(vs.map((v) => sql`${v}`), sql`, `)})`,
  exactEq: (col, v) => sql`${col} = ${binary(v)}`,
  exactIn: (col, vs) => sql`${col} IN (${sql.join(vs.map(binary), sql`, `)})`,
  match: (col, needle, kind, fold) => {
    const e = escapeLike(needle)
    const pattern = kind === 'contains' ? `%${e}%` : kind === 'startsWith' ? `${e}%` : `%${e}`
    return fold
      ? sql`${col} LIKE ${pattern} ESCAPE '!'`
      : sql`${col} LIKE ${binary(pattern)} ESCAPE '!'`
  },
  arrayHas: (col, v) => sql`JSON_CONTAINS(${col}, ${jsonArray([v])})`,
  arrayHasAll: (col, vs) => sql`JSON_CONTAINS(${col}, ${jsonArray(vs)})`,
  arrayHasAny: (col, vs) => sql`JSON_OVERLAPS(${col}, ${jsonArray(vs)})`,
  arrayIsEmpty: (col) => orSql(isNull(col), sql`JSON_LENGTH(${col}) = 0`)!,
}

export const drizzleOps: Record<string, OpTranslator> = guardOps('drizzle-mysql', buildOps(mysqlDialect))
