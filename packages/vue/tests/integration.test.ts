import { defineFilterSchema, f, fromUrl, toUrl } from '@dql-kit/core'
import { createDrizzleTranslator } from '@dql-kit/drizzle'
import { PGlite } from '@electric-sql/pglite'
import { mount } from '@vue/test-utils'
import { drizzle } from 'drizzle-orm/pglite'
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { FilterBuilder, useFilter } from '../src/index.ts'

const articles = pgTable('articles', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
})

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
  },
})

describe('end-to-end: FilterBuilder → composable → URL round-trip → Drizzle → pglite', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE articles (id SERIAL PRIMARY KEY, title TEXT NOT NULL);
    `)
    await client.exec(`
      INSERT INTO articles (title) VALUES ('hello'), ('world'), ('hello');
    `)
  })

  it('drives the full vertical slice', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: '' }],
      },
    })

    const wrapper = mount(FilterBuilder, { props: { filter } })

    // 1. Drive the input through the mounted UI.
    const input = wrapper.find('input.dql-input--string')
    expect(input.exists()).toBe(true)
    await input.setValue('hello')

    // 2. Composable's valid AST should reflect the typed value.
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    })

    // 3. URL round-trip is lossless.
    const url = toUrl(filter.valid.value)
    expect(url.length).toBeGreaterThan(0)
    const decoded = fromUrl(url, schema)
    expect(decoded.dropped).toEqual([])
    expect(decoded.ast).toEqual(filter.valid.value)

    // 4. Hand the round-tripped AST to a Drizzle translator + execute against pglite.
    const translator = createDrizzleTranslator({ schema, table: articles })
    const where = translator.toWhere(decoded.ast)
    const rows = await db.select().from(articles).where(where)

    // 5. Assert the matched row count.
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.title === 'hello')).toBe(true)
  })
})

// Slice 9: nested vertical slice. Build a (A or B) and C-shape filter
// purely through composable actions, round-trip it through the URL codec,
// and assert the Drizzle output picks exactly the rows the boolean tree
// describes — verifying parenthesisation end-to-end.
const nestedArticles = pgTable('nested_articles_e2e', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  rating: integer('rating').notNull(),
  status: text('status').notNull(),
})
const nestedSchema = defineFilterSchema({
  fields: {
    title: f.string(),
    rating: f.number(),
    status: f.enum(['draft', 'published', 'archived'] as const),
  },
})

describe('end-to-end: nested filter via actions → URL → pglite', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE nested_articles_e2e (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        rating INTEGER NOT NULL,
        status TEXT NOT NULL
      );
    `)
    await client.exec(`
      INSERT INTO nested_articles_e2e (title, rating, status) VALUES
        ('alpha',   2, 'draft'),
        ('alpha',   8, 'published'),
        ('beta',    3, 'draft'),
        ('beta',    9, 'archived'),
        ('gamma',   1, 'archived');
    `)
  })

  it('drives addGroup + addCondition action chain through URL into a parenthesised SQL match', async () => {
    const filter = useFilter({ schema: nestedSchema, sync: 'none' })

    // Build the AST: (title='alpha' OR rating > 5) AND status = 'draft'.
    filter.actions.addCondition([], { field: 'status', op: 'eq', value: 'draft' })
    filter.actions.addGroup([], 'or')
    filter.actions.addCondition([1], { field: 'title', op: 'eq', value: 'alpha' })
    filter.actions.addCondition([1], { field: 'rating', op: 'gt', value: 5 })

    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [
        { field: 'status', op: 'eq', value: 'draft' },
        {
          combinator: 'or',
          children: [
            { field: 'title', op: 'eq', value: 'alpha' },
            { field: 'rating', op: 'gt', value: 5 },
          ],
        },
      ],
    })

    // URL round-trip preserves the nested shape.
    const url = toUrl(filter.valid.value)
    const decoded = fromUrl(url, nestedSchema)
    expect(decoded.dropped).toEqual([])
    expect(decoded.ast).toEqual(filter.valid.value)

    // Drizzle output should pick exactly the row matching the boolean tree:
    // status=draft AND (title=alpha OR rating > 5).
    // Drafts in fixtures: ('alpha', 2), ('beta', 3). Of those, only 'alpha'
    // satisfies the OR (no draft has rating > 5).
    const translator = createDrizzleTranslator({ schema: nestedSchema, table: nestedArticles })
    const rows = await db
      .select()
      .from(nestedArticles)
      .where(translator.toWhere(decoded.ast))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'alpha', rating: 2, status: 'draft' })
  })

  it('renders the (A or B) and C tree visually with a per-group combinator toggle', () => {
    const filter = useFilter({
      schema: nestedSchema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'status', op: 'eq', value: 'draft' },
          {
            combinator: 'or',
            children: [
              { field: 'title', op: 'eq', value: 'alpha' },
              { field: 'rating', op: 'gt', value: 5 },
            ],
          },
        ],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    // Two groups: root + nested. Two combinator selects.
    expect(wrapper.findAll('[data-testid="combinator-select"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="group-nested"]').exists()).toBe(true)
  })
})
