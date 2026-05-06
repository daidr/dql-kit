import {
  and as andSql,
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

export const drizzleOps: Record<string, OpTranslator> = {
  eq:           (col, v) => eq(col, v as never),
  neq:          (col, v) => ne(col, v as never),
  contains:     (col, v) => ilike(col, `%${escapeLike(String(v))}%`),
  notContains:  (col, v) => sql`${col} NOT ILIKE ${`%${escapeLike(String(v))}%`}`,
  startsWith:   (col, v) => ilike(col, `${escapeLike(String(v))}%`),
  endsWith:     (col, v) => ilike(col, `%${escapeLike(String(v))}`),
  isEmpty:      (col)    => orSql(isNull(col), eq(col as AnyColumn, '' as never))!,
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
    const { amount, unit } = v as { amount: number, unit: string }
    return sql`${col} >= NOW() - ${sql.raw(`INTERVAL '${Number(amount)} ${unit}'`)}`
  },
  containsAll:  (col, v) => sql`${col} @> ${v}`,
}

export const passthrough = { andSql, orSql, isNotNull } as Record<string, unknown>
export type { SQL }
