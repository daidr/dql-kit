// Runs the shared op-semantics cases from core against MySQL, so this
// adapter, the other SQL adapters and the in-memory evaluator are held
// to the same expectations.
import { parseAst } from '@dql-kit/core'
import { asc } from 'drizzle-orm'
import { boolean, date, datetime, int, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  calendarCases,
  calendarRows,
  calendarSchema,
  rootOf,
  semanticsCases,
  semanticsRows,
  semanticsSchema,
} from '../../core/tests/semantics/cases.ts'
import { createDrizzleTranslator } from '../src/index.ts'
import { connect, mysqlUrl, utc } from './db.ts'

const rowsTable = mysqlTable('semantics_rows', {
  id: int('id').primaryKey(),
  title: varchar('title', { length: 255 }),
  code: varchar('code', { length: 255 }),
  rating: int('rating'),
  status: varchar('status', { length: 32 }),
  ownerId: int('owner_id'),
  active: boolean('active'),
  day: date('day', { mode: 'string' }),
  at: datetime('at', { mode: 'string', fsp: 3 }),
  seenAt: datetime('seen_at', { mode: 'string', fsp: 3 }),
  dueDay: date('due_day', { mode: 'string' }),
  tags: json('tags').$type<string[]>(),
})

// `stamp` uses drizzle's Date mode, to cover both column modes.
const calendarTable = mysqlTable('calendar_rows', {
  id: int('id').primaryKey(),
  at: datetime('at', { mode: 'string', fsp: 3 }),
  stamp: datetime('stamp', { mode: 'date', fsp: 3 }),
  day: date('day', { mode: 'string' }),
})

describe.skipIf(!mysqlUrl)('drizzle-mysql — shared cases', () => {
  let conn: Awaited<ReturnType<typeof connect>>

  beforeAll(async () => {
    conn = await connect()
    await conn.pool.query(`
      DROP TABLE IF EXISTS semantics_rows;
      DROP TABLE IF EXISTS calendar_rows;
      CREATE TABLE semantics_rows (
        id INT PRIMARY KEY, title VARCHAR(255), code VARCHAR(255), rating INT, status VARCHAR(32),
        owner_id INT, active BOOLEAN, day DATE, at DATETIME(3), seen_at DATETIME(3), due_day DATE, tags JSON
      );
      CREATE TABLE calendar_rows (id INT PRIMARY KEY, at DATETIME(3), stamp DATETIME(3), day DATE);
    `)
    await conn.db.insert(rowsTable).values(
      semanticsRows(new Date()).map((r) => ({ ...r, at: utc(r.at), seenAt: utc(r.seenAt) })),
    )
    await conn.db.insert(calendarTable).values(calendarRows.map((r) => ({
      id: r.id,
      at: utc(r.at),
      stamp: r.stamp === null ? null : new Date(r.stamp),
      day: r.day,
    })))
  })

  afterAll(async () => {
    await conn?.pool.end()
  })

  const translator = createDrizzleTranslator({ schema: semanticsSchema, table: rowsTable })

  test.each(semanticsCases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const parsed = parseAst(rootOf(c.node), semanticsSchema)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    const rows = await conn.db
      .select({ id: rowsTable.id })
      .from(rowsTable)
      .where(translator.toWhere(parsed.ast))
      .orderBy(asc(rowsTable.id))
    expect(rows.map((r) => r.id)).toEqual(c.expected)
  })

  test.each(calendarCases.map((c) => [c.name, c] as const))('calendar: %s', async (_name, c) => {
    const t = createDrizzleTranslator({
      schema: calendarSchema,
      table: calendarTable,
      now: () => new Date(c.now),
      timeZone: c.timeZone,
      weekStartsOn: c.weekStartsOn,
    })
    const parsed = parseAst(rootOf(c.node), calendarSchema)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    const rows = await conn.db
      .select({ id: calendarTable.id })
      .from(calendarTable)
      .where(t.toWhere(parsed.ast))
      .orderBy(asc(calendarTable.id))
    expect(rows.map((r) => r.id)).toEqual(c.expected)
  })
})
