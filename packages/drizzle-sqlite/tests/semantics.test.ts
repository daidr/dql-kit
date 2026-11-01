// Runs the shared op-semantics cases from core against SQLite (bun's
// in-memory database), so this adapter, the PG one and the in-memory
// evaluator are held to the same expectations.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { parseAst } from '@dql-kit/core'
import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
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

const rowsTable = sqliteTable('semantics_rows', {
  id: integer('id').primaryKey(),
  title: text('title'),
  code: text('code'),
  rating: integer('rating'),
  status: text('status'),
  ownerId: integer('owner_id'),
  active: integer('active', { mode: 'boolean' }),
  day: text('day'),
  at: text('at'),
  seenAt: text('seen_at'),
  dueDay: text('due_day'),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
})

// `at` is an ISO text column; `stamp` an integer timestamp (instants);
// `day` a text column of plain days.
const calendarTable = sqliteTable('calendar_rows', {
  id: integer('id').primaryKey(),
  at: text('at'),
  stamp: integer('stamp', { mode: 'timestamp_ms' }),
  day: text('day'),
})

// Instants are stored as `toISOString()` text, the format the adapter
// compares against.
const iso = (v: string | null) => (v === null ? null : new Date(v).toISOString())

describe('drizzle-sqlite — shared semantics cases', () => {
  const client = new Database(':memory:')
  const db = drizzle(client)
  client.run(`
    CREATE TABLE semantics_rows (
      id INTEGER PRIMARY KEY, title TEXT, code TEXT, rating INTEGER, status TEXT, owner_id INTEGER,
      active INTEGER, day TEXT, at TEXT, seen_at TEXT, due_day TEXT, tags TEXT
    )
  `)
  db.insert(rowsTable).values(semanticsRows(new Date()).map((r) => ({ ...r, at: iso(r.at), seenAt: iso(r.seenAt) }))).run()

  const translator = createDrizzleTranslator({ schema: semanticsSchema, table: rowsTable })

  test.each(semanticsCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = parseAst(rootOf(c.node), semanticsSchema)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    const rows = db
      .select({ id: rowsTable.id })
      .from(rowsTable)
      .where(translator.toWhere(parsed.ast))
      .orderBy(asc(rowsTable.id))
      .all()
    expect(rows.map((r) => r.id)).toEqual(c.expected)
  })
})

describe('drizzle-sqlite — shared calendar cases', () => {
  const client = new Database(':memory:')
  const db = drizzle(client)
  client.run('CREATE TABLE calendar_rows (id INTEGER PRIMARY KEY, at TEXT, stamp INTEGER, day TEXT)')
  db.insert(calendarTable).values(calendarRows.map((r) => ({
    id: r.id,
    at: iso(r.at),
    stamp: r.stamp === null ? null : new Date(r.stamp),
    day: r.day,
  }))).run()

  test.each(calendarCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const translator = createDrizzleTranslator({
      schema: calendarSchema,
      table: calendarTable,
      now: () => new Date(c.now),
      timeZone: c.timeZone,
      weekStartsOn: c.weekStartsOn,
    })
    const parsed = parseAst(rootOf(c.node), calendarSchema)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    const rows = db
      .select({ id: calendarTable.id })
      .from(calendarTable)
      .where(translator.toWhere(parsed.ast))
      .orderBy(asc(calendarTable.id))
      .all()
    expect(rows.map((r) => r.id)).toEqual(c.expected)
  })
})
