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

// Slice 11: schema-evolution end-to-end. Build an "old" URL by encoding
// against a previous schema, mount useFilter against the "new" (narrower)
// schema, and watch the dropped[] surface populate, the notice render,
// and the user dismiss it.
describe('end-to-end: schema evolution dropped[] flow', () => {
  // "Old" schema as it would have looked when the URL was generated:
  // includes a `legacyTag` field that's been removed since.
  const oldSchema = defineFilterSchema({
    fields: {
      title: f.string(),
      legacyTag: f.string(),
    },
  })
  // Current schema (no legacyTag).
  const newSchema = defineFilterSchema({
    fields: {
      title: f.string(),
    },
  })

  it('loads an old URL → dropped populated → notice rendered → dismiss clears it', async () => {
    // 1. Encode against the old schema.
    const oldUrl = toUrl({
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'kept' },
        { field: 'legacyTag', op: 'eq', value: 'gone' },
      ],
    })

    // 2. Boot useFilter against the new schema with the old URL as the
    // initial AST shape (we feed it through fromUrl manually to exercise
    // the same path as a real URL load — the sync='none' harness doesn't
    // run the URL watcher, so populate dropped via the public surface).
    const decoded = fromUrl(oldUrl, newSchema)
    expect(decoded.dropped).toHaveLength(1)
    expect(decoded.dropped[0]).toMatchObject({
      reason: 'unknown_field',
      detail: { field: 'legacyTag' },
    })
    void oldSchema // referenced for documentation; the encoder is the contract.

    const filter = useFilter({
      schema: newSchema,
      sync: 'none',
      initial: decoded.ast,
    })
    filter.dropped.value = decoded.dropped

    const wrapper = mount(FilterBuilder, { props: { filter } })

    // 3. Notice renders with the right count.
    const notice = wrapper.find('[data-testid="dropped-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.attributes('data-dropped-count')).toBe('1')
    expect(notice.text()).toContain('1 condition(s) dropped due to schema changes')

    // 4. The surviving condition still shows in the UI.
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'kept' }],
    })

    // 5. User clicks dismiss — notice unmounts, dropped is empty.
    await wrapper.find('[data-testid="dropped-dismiss"]').trigger('click')
    expect(filter.dropped.value).toEqual([])
    expect(wrapper.find('[data-testid="dropped-notice"]').exists()).toBe(false)
  })
})

// Slice 10: drive each of the 5 error codes through the composable and
// assert the UI reflects the right code on the right row, then watch the
// indicator clear reactively as the user fixes each issue.
describe('end-to-end: validation error UI', () => {
  it('walks a single condition through every error code and back to clean', async () => {
    const filter = useFilter({ schema: nestedSchema, sync: 'none' })
    const wrapper = mount(FilterBuilder, { props: { filter } })

    const codeAt = (i: number) =>
      wrapper.findAll('[data-testid="condition"]')[i]
        ?.find('[data-testid="condition-error"]')
        ?.attributes('data-error-code')

    // 1. incomplete (missing field) — addCondition with no field/op/value.
    filter.actions.addCondition([])
    await wrapper.vm.$nextTick()
    expect(codeAt(0)).toBe('incomplete')

    // 2. unknown_field — set a field that doesn't exist in the schema.
    filter.actions.updateNode([0], { field: 'mystery' })
    await wrapper.vm.$nextTick()
    expect(codeAt(0)).toBe('unknown_field')

    // 3. op_not_allowed — pick a real string field but a numeric op.
    filter.actions.updateNode([0], { field: 'title', op: 'gt', value: 'x' })
    await wrapper.vm.$nextTick()
    expect(codeAt(0)).toBe('op_not_allowed')

    // 4. value_type_mismatch — switch to a number field but supply a string.
    filter.actions.updateNode([0], { field: 'rating', op: 'eq', value: 'oops' })
    await wrapper.vm.$nextTick()
    expect(codeAt(0)).toBe('value_type_mismatch')

    // 5. value_shape_mismatch — between expects a pair, supply a scalar.
    filter.actions.updateNode([0], { op: 'between', value: 5 })
    await wrapper.vm.$nextTick()
    expect(codeAt(0)).toBe('value_shape_mismatch')

    // Fix the value — UI clears.
    filter.actions.updateNode([0], { value: [1, 5] })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="condition-error"]').exists()).toBe(false)
    expect(filter.errors.value).toEqual([])
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [1, 5] }],
    })
  })
})
