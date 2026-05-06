import { defineFilterSchema, f, type ValidAST } from '@dql-kit/core'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, test } from 'vitest'
import { createDrizzleTranslator } from '../src/index.ts'

const articles = pgTable('articles', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  rating: integer('rating').notNull(),
})

const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    rating: f.number(),
  },
})

describe('createDrizzleTranslator — construction-time errors', () => {
  test('throws when a field has no matching column on table and no override', () => {
    const incomplete = pgTable('incomplete', {
      id: serial('id').primaryKey(),
      title: text('title').notNull(),
      // no `rating` column
    })
    expect(() =>
      createDrizzleTranslator({ schema, table: incomplete }),
    ).toThrow(/Missing column mapping for field "rating"/)
  })

  test('explicit columns satisfy missing field', () => {
    const incomplete = pgTable('incomplete', {
      id: serial('id').primaryKey(),
      title: text('title').notNull(),
    })
    expect(() =>
      createDrizzleTranslator({
        schema,
        table: incomplete,
        columns: { rating: articles.rating },
      }),
    ).not.toThrow()
  })

  test('throws with helpful message when neither table nor full columns provided', () => {
    expect(() =>
      createDrizzleTranslator({
        schema,
        columns: { title: articles.title },
      }),
    ).toThrow(/Missing column mapping for field "rating"/)
  })
})

describe('createDrizzleTranslator — SQL execution', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE articles (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        rating INTEGER NOT NULL
      );
    `)
    await client.exec(`
      INSERT INTO articles (title, rating) VALUES
        ('hello',  3),
        ('world',  5),
        ('hello',  4);
    `)
  })

  test('empty AST → matches all rows', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    const rows = await db.select().from(articles).where(t.toWhere({ combinator: 'and', children: [] }))
    expect(rows).toHaveLength(3)
  })

  test('string eq matches expected rows', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    }
    const rows = await db.select().from(articles).where(t.toWhere(ast))
    expect(rows.map((r) => r.title).sort()).toEqual(['hello', 'hello'])
  })

  test('AND of string eq + number gt', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'hello' },
        { field: 'rating', op: 'gt', value: 3 },
      ],
    }
    const rows = await db.select().from(articles).where(t.toWhere(ast))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rating).toBe(4)
  })

  test('OR group', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    const ast: ValidAST = {
      combinator: 'or',
      children: [
        { field: 'title', op: 'eq', value: 'world' },
        { field: 'rating', op: 'eq', value: 3 },
      ],
    }
    const rows = await db.select().from(articles).where(t.toWhere(ast))
    expect(rows).toHaveLength(2)
  })

  test('between op on number', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [4, 5] }],
    }
    const rows = await db.select().from(articles).where(t.toWhere(ast))
    expect(rows).toHaveLength(2)
  })

  test('registerOp wires a custom op into toWhere', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    t.registerOp('isFortyTwo', (col) => sql`${col} = 42`)
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'isFortyTwo', value: undefined }],
    }
    expect(() => t.toWhere(ast)).not.toThrow()
  })

  test('AST referencing op without translator throws helpfully', async () => {
    const t = createDrizzleTranslator({ schema, table: articles })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'noSuchOp', value: 1 }],
    }
    expect(() => t.toWhere(ast)).toThrow(/No SQL translator registered for op "noSuchOp"/)
  })
})
