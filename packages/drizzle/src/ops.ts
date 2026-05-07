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
import { isRelativeUnit } from '@dql-kit/core'
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
  containsAll:  (col, v) => sql`${col} @> ${v}`,
}

export const passthrough = { andSql, orSql, isNotNull } as Record<string, unknown>
export type { SQL }
