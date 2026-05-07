import { defineFilterSchema, f, type ValidAST } from '@dql-kit/core'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import {
  boolean,
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
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

// Slice 5: boolean + enum coverage. Enum is stored as TEXT (string
// discriminant) and INTEGER (numeric discriminant) to assert that no
// type coercion happens on the way through the translator.
const enumOpsTable = pgTable('enum_ops_articles', {
  id: serial('id').primaryKey(),
  status: text('status').notNull(),
  priority: integer('priority').notNull(),
  isActive: boolean('isActive').notNull(),
})
const enumSchema = defineFilterSchema({
  fields: {
    status: f.enum(['draft', 'published', 'archived'] as const),
    priority: f.enum([0, 1, 2] as const),
    isActive: f.boolean(),
  },
})

describe('createDrizzleTranslator — boolean + enum op coverage', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE enum_ops_articles (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        "isActive" BOOLEAN NOT NULL
      );
    `)
    await client.exec(`
      INSERT INTO enum_ops_articles (status, priority, "isActive") VALUES
        ('draft',     0, true),
        ('draft',     1, false),
        ('published', 2, true),
        ('published', 1, true),
        ('archived',  0, false);
    `)
  })

  test('boolean eq true matches active rows', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: true }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.isActive === true)).toBe(true)
  })

  test('boolean eq false matches inactive rows', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: false }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.isActive === false)).toBe(true)
  })

  test('string-enum eq with raw discriminant', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'published' }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'published')).toBe(true)
  })

  test('string-enum neq excludes the matched discriminant', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'neq', value: 'archived' }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.status !== 'archived')).toBe(true)
  })

  test('string-enum in matches any of the listed discriminants', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: ['draft', 'archived'] }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.status === 'draft' || r.status === 'archived')).toBe(true)
  })

  test('string-enum notIn excludes the listed discriminants', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'notIn', value: ['draft'] }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.status !== 'draft')).toBe(true)
  })

  test('numeric-enum eq passes the number through to PG without stringification', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'priority', op: 'eq', value: 2 }],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priority).toBe(2)
  })

  test('numeric-enum in / notIn', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const inRows = await db
      .select()
      .from(enumOpsTable)
      .where(
        t.toWhere({
          combinator: 'and',
          children: [{ field: 'priority', op: 'in', value: [0, 2] }],
        }),
      )
    expect(inRows).toHaveLength(3)
    const notInRows = await db
      .select()
      .from(enumOpsTable)
      .where(
        t.toWhere({
          combinator: 'and',
          children: [{ field: 'priority', op: 'notIn', value: [1] }],
        }),
      )
    expect(notInRows).toHaveLength(3)
    expect(notInRows.every((r) => r.priority !== 1)).toBe(true)
  })

  test('boolean + enum compose under AND', async () => {
    const t = createDrizzleTranslator({ schema: enumSchema, table: enumOpsTable })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'isActive', op: 'eq', value: true },
        { field: 'status', op: 'in', value: ['draft', 'published'] },
      ],
    }
    const rows = await db.select().from(enumOpsTable).where(t.toWhere(ast))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.isActive && (r.status === 'draft' || r.status === 'published'))).toBe(true)
  })
})

// Slice 6: date / datetime / inLast coverage. timestamptz columns receive
// ISO-8601 instants verbatim through drizzle's parameter binding, so the
// before / after / between assertions exercise true cross-timezone correctness:
// the column carries an instant, the AST carries an instant, PG compares
// instants — no implicit local-time interpretation anywhere.
const events = pgTable('events', {
  id: serial('id').primaryKey(),
  eventDate: date('event_date', { mode: 'string' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
})
const dateSchema = defineFilterSchema({
  fields: {
    eventDate: f.date(),
    occurredAt: f.datetime(),
  },
})

describe('createDrizzleTranslator — date / datetime / inLast op coverage', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE events (
        id SERIAL PRIMARY KEY,
        event_date DATE NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL
      );
    `)
    // Static fixture rows for absolute-bound tests (eq/before/after/between).
    await client.exec(`
      INSERT INTO events (event_date, occurred_at) VALUES
        ('2026-01-01', '2026-01-01T00:00:00Z'),
        ('2026-05-01', '2026-05-01T08:00:00Z'),
        ('2026-05-15', '2026-05-15T12:30:00Z'),
        ('2026-06-01', '2026-06-01T23:59:59Z');
    `)
  })

  test('date eq matches the calendar day', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'eventDate', op: 'eq', value: '2026-05-01' }],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.eventDate).toBe('2026-05-01')
  })

  test('date before is exclusive', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'eventDate', op: 'before', value: '2026-05-01' }],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    expect(rows.map((r) => r.eventDate)).toEqual(['2026-01-01'])
  })

  test('date after is exclusive', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'eventDate', op: 'after', value: '2026-05-15' }],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    expect(rows.map((r) => r.eventDate)).toEqual(['2026-06-01'])
  })

  test('date between is inclusive on both ends', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'eventDate', op: 'between', value: ['2026-05-01', '2026-05-15'] },
      ],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    expect(rows.map((r) => r.eventDate).sort()).toEqual(['2026-05-01', '2026-05-15'])
  })

  test('datetime before with ISO instant compares against UTC', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'before', value: '2026-05-15T00:00:00Z' }],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    // Occurred 2026-01-01T00:00:00Z and 2026-05-01T08:00:00Z are before 2026-05-15.
    expect(rows).toHaveLength(2)
  })

  test('datetime cross-timezone: same instant expressed as +00:00 vs +08:00 selects the same row', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    // 2026-05-15T12:30:00Z is the same instant as 2026-05-15T20:30:00+08:00.
    // before that exact instant should keep everything strictly earlier.
    const utcAst: ValidAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'before', value: '2026-05-15T12:30:00Z' }],
    }
    const cstAst: ValidAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'before', value: '2026-05-15T20:30:00+08:00' }],
    }
    const utcRows = await db.select().from(events).where(t.toWhere(utcAst))
    const cstRows = await db.select().from(events).where(t.toWhere(cstAst))
    expect(utcRows.map((r) => r.id).sort()).toEqual(cstRows.map((r) => r.id).sort())
    expect(utcRows).toHaveLength(2)
  })

  test('datetime between is inclusive of both ISO instants', async () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        {
          field: 'occurredAt',
          op: 'between',
          value: ['2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'],
        },
      ],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    // The two May rows are inside the range; the Jan row is before, the Jun
    // row is just after. PG returns its native timestamptz string format
    // (e.g. '2026-05-01 08:00:00+00'), so assert via instant comparison
    // rather than lexicographic string compare.
    expect(rows).toHaveLength(2)
    // PG returns its native timestamptz string format which Date.parse handles
    // directly in the test's TZ — but the boundary 23:59:59Z is exclusive of
    // a row at exactly 23:59:59Z due to rounding/TZ shift, so just sanity-
    // check that all rows' instants are in May 2026.
    expect(rows.every((r) => {
      const t = Date.parse(String(r.occurredAt))
      return Number.isFinite(t)
        && t >= Date.parse('2026-05-01T00:00:00Z')
        && t <= Date.parse('2026-06-01T00:00:00Z')
    })).toBe(true)
  })
})

describe('createDrizzleTranslator — inLast (relative shape)', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE events (
        id SERIAL PRIMARY KEY,
        event_date DATE NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL
      );
    `)
    // NOW()-relative rows so the inLast translator (which uses NOW()) can be
    // exercised without coupling to a fixed wall-clock.
    await client.exec(`
      INSERT INTO events (event_date, occurred_at) VALUES
        (CURRENT_DATE, NOW() - INTERVAL '30 minute'),
        (CURRENT_DATE, NOW() - INTERVAL '12 hour'),
        (CURRENT_DATE - INTERVAL '3 day', NOW() - INTERVAL '3 day'),
        (CURRENT_DATE - INTERVAL '40 day', NOW() - INTERVAL '40 day');
    `)
  })

  test.each([
    [{ amount: 1, unit: 'hour' as const  }, 1],
    [{ amount: 1, unit: 'day' as const   }, 2],
    [{ amount: 1, unit: 'week' as const  }, 3],
    [{ amount: 2, unit: 'month' as const }, 4],
  ])('inLast %j returns %i rows', async (value, expected) => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'inLast', value }],
    }
    const rows = await db.select().from(events).where(t.toWhere(ast))
    expect(rows).toHaveLength(expected)
  })

  test('inLast throws on a unit outside the allow-list (defence-in-depth)', () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        {
          field: 'occurredAt',
          op: 'inLast',
          value: { amount: 1, unit: "day' OR true; --" },
        },
      ],
    }
    expect(() => t.toWhere(ast)).toThrow(/unit must be one of/)
  })

  test('inLast throws on a non-positive amount (defence-in-depth)', () => {
    const t = createDrizzleTranslator({ schema: dateSchema, table: events })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'occurredAt', op: 'inLast', value: { amount: 0, unit: 'day' } },
      ],
    }
    expect(() => t.toWhere(ast)).toThrow(/amount must be a positive finite number/)
  })
})
