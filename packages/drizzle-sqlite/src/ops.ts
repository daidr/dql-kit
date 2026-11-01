import {
  buildOps,
  escapeLike,
  guardOps,
  type Dialect,
  type OpTranslator,
} from '@dql-kit/drizzle-common'
import { isNull, or as orSql, sql, type AnyColumn, type SQL } from 'drizzle-orm'

const columnType = (col: AnyColumn): string => (col as { columnType?: string }).columnType ?? ''
const sqlType = (col: AnyColumn): string => {
  const getType = (col as { getSQLType?: () => string }).getSQLType
  return typeof getType === 'function' ? getType.call(col) : ''
}
const isTimestampColumn = (col: AnyColumn) => columnType(col) === 'SQLiteTimestamp'
const list = (vs: unknown[]): SQL => sql.join(vs.map((v) => sql`${v}`), sql`, `)

// SQLite has no date or array types. Instants live in
// `integer({ mode: 'timestamp' | 'timestamp_ms' })` columns (drizzle
// encodes the `Date`) or in text columns as `toISOString()` strings,
// which compare correctly as text. A `date` field on a text column holds
// `YYYY-MM-DD` days. Arrays are JSON text columns, read with `json_each`.
// `lower()` and `LIKE` fold ASCII letters only.
export const sqliteDialect: Dialect = {
  name: 'drizzle-sqlite',
  instant: (col, d) => (isTimestampColumn(col) ? d : d.toISOString()),
  isDayColumn: (col) => sqlType(col) === 'text',
  day: (_col, day) => day,
  foldEq: (col, v) => sql`lower(${col}) = lower(${v})`,
  foldIn: (col, vs) => sql`lower(${col}) IN (${sql.join(vs.map((v) => sql`lower(${v})`), sql`, `)})`,
  match: (col, needle, kind, fold) => {
    if (fold) {
      const e = escapeLike(needle)
      const pattern = kind === 'contains' ? `%${e}%` : kind === 'startsWith' ? `${e}%` : `%${e}`
      return sql`${col} LIKE ${pattern} ESCAPE '\\'`
    }
    // Exact matches without LIKE, which ignores ASCII case.
    if (kind === 'contains') return sql`instr(${col}, ${needle}) > 0`
    if (kind === 'startsWith') return sql`substr(${col}, 1, length(${needle})) = ${needle}`
    return sql`substr(${col}, length(${col}) - length(${needle}) + 1) = ${needle}`
  },
  arrayHas: (col, v) => sql`EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ${v})`,
  arrayHasAll: (col, vs) => {
    const distinct = [...new Set(vs)]
    return sql`(SELECT COUNT(DISTINCT value) FROM json_each(${col}) WHERE value IN (${list(distinct)})) = ${distinct.length}`
  },
  arrayHasAny: (col, vs) => sql`EXISTS (SELECT 1 FROM json_each(${col}) WHERE value IN (${list(vs)}))`,
  arrayIsEmpty: (col) => orSql(isNull(col), sql`json_array_length(${col}) = 0`)!,
}

export const drizzleOps: Record<string, OpTranslator> = guardOps('drizzle-sqlite', buildOps(sqliteDialect))
