import { defineFilterSchema, f, fromUrl, toUrl } from '@dql-kit/core'
import { createDrizzleTranslator } from '@dql-kit/drizzle'
import { PGlite } from '@electric-sql/pglite'
import { mount } from '@vue/test-utils'
import { drizzle } from 'drizzle-orm/pglite'
import { pgTable, serial, text } from 'drizzle-orm/pg-core'
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
