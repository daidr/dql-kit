// Runs the shared op-semantics cases from core against PostgreSQL
// (PGlite), so the SQL translator and the in-memory evaluator are held
// to the same expectations.
import { parseAst } from '@dql-kit/core'
import { PGlite } from '@electric-sql/pglite'
import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { boolean, date, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  rootOf,
  semanticsCases,
  semanticsRows,
  semanticsSchema,
} from '../../core/tests/semantics/cases.ts'
import { createDrizzleTranslator } from '../src/index.ts'

const rowsTable = pgTable('semantics_rows', {
  id: integer('id').primaryKey(),
  title: text('title'),
  rating: integer('rating'),
  status: text('status'),
  ownerId: integer('owner_id'),
  active: boolean('active'),
  day: date('day', { mode: 'string' }),
  at: timestamp('at', { withTimezone: true, mode: 'string' }),
  seenAt: timestamp('seen_at', { withTimezone: true, mode: 'string' }),
  tags: text('tags').array(),
})

describe('drizzle-pg — shared semantics cases', () => {
  let db: ReturnType<typeof drizzle>

  beforeAll(async () => {
    const client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE semantics_rows (
        id INTEGER PRIMARY KEY,
        title TEXT,
        rating INTEGER,
        status TEXT,
        owner_id INTEGER,
        active BOOLEAN,
        day DATE,
        at TIMESTAMPTZ,
        seen_at TIMESTAMPTZ,
        tags TEXT[]
      );
    `)
    // `seenAt` is relative to the JS clock; the cases leave wide margins
    // for the gap to the database's NOW().
    await db.insert(rowsTable).values(semanticsRows(new Date()))
  })

  const translator = createDrizzleTranslator({ schema: semanticsSchema, table: rowsTable })

  test.each(semanticsCases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const parsed = parseAst(rootOf(c.node), semanticsSchema)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    const rows = await db
      .select({ id: rowsTable.id })
      .from(rowsTable)
      .where(translator.toWhere(parsed.ast))
      .orderBy(asc(rowsTable.id))
    expect(rows.map((r) => r.id)).toEqual(c.expected)
  })
})
