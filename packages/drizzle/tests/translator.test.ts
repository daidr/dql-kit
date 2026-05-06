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

// Slice 3: full string op set against a fixture corpus that exercises
// case-insensitivity, NULL/empty handling, and LIKE-pattern injection.
const stringOpsTable = pgTable('string_ops_articles', {
  id: serial('id').primaryKey(),
  title: text('title'),
})
const stringSchema = defineFilterSchema({
  fields: {
    title: f.string(),
  },
})

describe('createDrizzleTranslator — full string op coverage', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE string_ops_articles (
        id SERIAL PRIMARY KEY,
        title TEXT
      );
    `)
    // Fixtures cover: simple words, mixed case, LIKE-special chars (%, _),
    // backslash, NULL, and empty string. Note the SQL string 'foo\\bar' lands
    // as the JS string `foo\bar` (single backslash) under default
    // standard_conforming_strings=on.
    await client.exec(`
      INSERT INTO string_ops_articles (title) VALUES
        ('hello'),
        ('Hello World'),
        ('world'),
        ('foo%bar'),
        ('foo_bar'),
        ('foo\\bar'),
        (''),
        (NULL);
    `)
  })

  // Plain code-point sort, deterministic regardless of host locale.
  const titlesOf = (rows: Array<{ title: string | null }>) =>
    rows
      .map((r) => r.title)
      .sort((a, b) => {
        if (a === null) return -1
        if (b === null) return 1
        return a < b ? -1 : a > b ? 1 : 0
      })

  test('contains is case-insensitive (ILIKE)', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: 'hello' }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(titlesOf(rows)).toEqual(['Hello World', 'hello'])
  })

  test('notContains excludes matching rows but includes NULL behaviour as PG defines it', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'notContains', value: 'foo' }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    // Postgres: NOT ILIKE on NULL evaluates to NULL, so NULL rows are excluded.
    // 'foo%bar' / 'foo_bar' / 'foo\bar' are all foo-prefixed → excluded.
    // '', 'hello', 'Hello World', 'world' remain.
    expect(titlesOf(rows)).toEqual(['', 'Hello World', 'hello', 'world'])
  })

  test('startsWith uses prefix LIKE pattern', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'startsWith', value: 'hello' }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(titlesOf(rows)).toEqual(['Hello World', 'hello'])
  })

  test('endsWith uses suffix LIKE pattern', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'endsWith', value: 'world' }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(titlesOf(rows)).toEqual(['Hello World', 'world'])
  })

  test('isEmpty matches NULL or empty string', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty', value: undefined }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.title === null || r.title === '')).toBe(true)
  })

  test('in matches any value in the list', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'in', value: ['hello', 'world'] }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(titlesOf(rows)).toEqual(['hello', 'world'])
  })

  test('notIn excludes the listed values', async () => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'notIn', value: ['hello', 'world', 'Hello World'] }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    // NULL rows are excluded by NOT IN per PG semantics; '', and the three
    // foo-prefixed rows survive.
    expect(titlesOf(rows)).toEqual(['', 'foo%bar', 'foo\\bar', 'foo_bar'])
  })

  // LIKE-pattern injection coverage: a literal '%' / '_' / '\' in the search
  // string must NOT be interpreted as a wildcard / escape.
  test.each([
    ['contains',   '%',   ['foo%bar']],
    ['contains',   '_',   ['foo_bar']],
    ['contains',   '\\',  ['foo\\bar']],
    ['startsWith', 'foo%', ['foo%bar']],
    ['startsWith', 'foo_', ['foo_bar']],
    ['endsWith',   '%bar', ['foo%bar']],
    ['endsWith',   '_bar', ['foo_bar']],
  ])('LIKE-pattern char %s in op %s is treated literally', async (op, needle, expected) => {
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: needle }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(titlesOf(rows)).toEqual(expected)
  })

  test('contains with empty needle would otherwise match every non-NULL row (escape sanity)', async () => {
    // Sanity check: escapeLike('') should produce '%%' which matches every
    // non-NULL row. NULL rows are filtered out by ILIKE's NULL semantics.
    const t = createDrizzleTranslator({ schema: stringSchema, table: stringOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: '' }],
    }
    const rows = await db.select().from(stringOpsTable).where(t.toWhere(ast))
    expect(rows.every((r) => r.title !== null)).toBe(true)
    expect(rows).toHaveLength(7)
  })
})

// Slice 4: number Field full op coverage against a corpus of integer rows.
const numberOpsTable = pgTable('number_ops_articles', {
  id: serial('id').primaryKey(),
  rating: integer('rating').notNull(),
})
const numberSchema = defineFilterSchema({
  fields: {
    rating: f.number(),
  },
})

describe('createDrizzleTranslator — full number op coverage', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE number_ops_articles (
        id SERIAL PRIMARY KEY,
        rating INTEGER NOT NULL
      );
    `)
    await client.exec(`
      INSERT INTO number_ops_articles (rating) VALUES
        (1), (2), (3), (4), (5);
    `)
  })

  const ratingsOf = (rows: Array<{ rating: number }>) =>
    rows.map((r) => r.rating).sort((a, b) => a - b)

  test('eq matches the equal row', async () => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'eq', value: 3 }],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(ratingsOf(rows)).toEqual([3])
  })

  test('neq excludes the equal row', async () => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'neq', value: 3 }],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(ratingsOf(rows)).toEqual([1, 2, 4, 5])
  })

  test.each([
    ['gt',  3, [4, 5]],
    ['gte', 3, [3, 4, 5]],
    ['lt',  3, [1, 2]],
    ['lte', 3, [1, 2, 3]],
  ])('comparison op %s with pivot 3', async (op, pivot, expected) => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op, value: pivot }],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(ratingsOf(rows)).toEqual(expected)
  })

  test('between is inclusive on both ends (BETWEEN x AND y)', async () => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [2, 4] }],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(ratingsOf(rows)).toEqual([2, 3, 4])
  })

  test('between with low > high yields no rows (PG BETWEEN semantics)', async () => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [4, 2] }],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(0)
  })

  test('in matches any of the listed values', async () => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'in', value: [1, 3, 5] }],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(ratingsOf(rows)).toEqual([1, 3, 5])
  })

  test('between composes inside an OR group', async () => {
    const t = createDrizzleTranslator({ schema: numberSchema, table: numberOpsTable })
    const ast: ValidAST = {
      combinator: 'or',
      children: [
        { field: 'rating', op: 'between', value: [1, 2] },
        { field: 'rating', op: 'eq', value: 5 },
      ],
    }
    const rows = await db.select().from(numberOpsTable).where(t.toWhere(ast))
    expect(ratingsOf(rows)).toEqual([1, 2, 5])
  })
})
