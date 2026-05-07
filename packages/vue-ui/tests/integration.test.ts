import { defineFilterSchema, f, fromUrl, toUrl } from '@dql-kit/core'
import { createDrizzleTranslator } from '@dql-kit/drizzle'
import { PGlite } from '@electric-sql/pglite'
import { mount } from '@vue/test-utils'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createDqlKit, useFilter } from '@dql-kit/vue-headless'
import { FilterBuilder } from '../src/index.ts'

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

// Slice 12: custom type end-to-end. Declare a money typeId, register
// its UI + SQL, drive a value through the composable, round-trip via
// URL, and execute against a pglite fixture.
const moneyTable = pgTable('money_e2e', {
  id: serial('id').primaryKey(),
  priceAmount: integer('price_amount').notNull(),
  priceCurrency: text('price_currency').notNull(),
})
const moneySchema = defineFilterSchema({
  fields: {
    price: f.custom({
      typeId: 'moneyE2E',
      ops: [{ name: 'moneyEq', valueShape: 'single', label: 'is' }],
    }),
  },
})

const MoneyInput = defineComponent({
  props: {
    fieldKey: { type: String, required: true as const },
    field: { type: Object, required: true as const },
    op: { type: String, required: true as const },
    value: { type: null as unknown as () => unknown, default: undefined },
    onUpdate: {
      type: Function as unknown as () => (v: unknown) => void,
      required: true as const,
    },
  },
  setup(props) {
    return () =>
      h('div', { class: 'dql-money', 'data-testid': 'money-control' }, [
        h('input', {
          type: 'number',
          'data-testid': 'money-amount',
          value:
            typeof props.value === 'object' && props.value !== null
              ? String((props.value as { amount?: number }).amount ?? '')
              : '',
          onInput: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value
            const cur =
              typeof props.value === 'object' && props.value !== null
                ? (props.value as { currency?: string }).currency ?? 'USD'
                : 'USD'
            ;(props.onUpdate as (v: unknown) => void)({
              amount: Number(raw),
              currency: cur,
            })
          },
        }),
        h(
          'select',
          {
            'data-testid': 'money-currency',
            value:
              typeof props.value === 'object' && props.value !== null
                ? (props.value as { currency?: string }).currency ?? 'USD'
                : 'USD',
            onChange: (e: Event) => {
              const cur = (e.target as HTMLSelectElement).value
              const amt =
                typeof props.value === 'object' && props.value !== null
                  ? (props.value as { amount?: number }).amount ?? 0
                  : 0
              ;(props.onUpdate as (v: unknown) => void)({ amount: amt, currency: cur })
            },
          },
          [
            h('option', { value: 'USD' }, 'USD'),
            h('option', { value: 'EUR' }, 'EUR'),
            h('option', { value: 'JPY' }, 'JPY'),
          ],
        ),
      ])
  },
})

describe('end-to-end: f.custom + createDqlKit({ renderers }) + ops', () => {
  let db: ReturnType<typeof drizzle>
  let client: PGlite
  // Built once for the suite — registers MoneyInput for the
  // `moneyE2E` typeId. Provided to mount() via global.plugins so the
  // dqlKit injection key is in scope for FilterBuilder.
  const dqlKit = createDqlKit({
    renderers: { moneyE2E: MoneyInput },
  })

  beforeAll(async () => {
    client = new PGlite()
    db = drizzle(client)
    await client.exec(`
      CREATE TABLE money_e2e (
        id SERIAL PRIMARY KEY,
        price_amount INTEGER NOT NULL,
        price_currency TEXT NOT NULL
      );
    `)
    await client.exec(`
      INSERT INTO money_e2e (price_amount, price_currency) VALUES
        (100, 'USD'),
        (100, 'EUR'),
        (250, 'USD'),
        (250, 'JPY');
    `)
  })

  it('drives the full extensibility path with one shared schema instance', async () => {
    // 1. Mount FilterBuilder against the custom-type schema.
    const filter = useFilter({
      schema: moneySchema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'price', op: 'moneyEq', value: { amount: 0, currency: 'USD' } },
        ],
      },
    })
    const wrapper = mount(FilterBuilder, {
      props: { filter },
      global: { plugins: [dqlKit] },
    })

    // 2. The registered renderer drives the value object through the UI.
    expect(wrapper.find('[data-testid="money-control"]').exists()).toBe(true)
    await wrapper.find('[data-testid="money-amount"]').setValue('250')
    await wrapper.find('[data-testid="money-currency"]').setValue('USD')
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [
        { field: 'price', op: 'moneyEq', value: { amount: 250, currency: 'USD' } },
      ],
    })

    // 3. URL round-trip preserves the structured value verbatim.
    const url = toUrl(filter.valid.value)
    const decoded = fromUrl(url, moneySchema)
    expect(decoded.dropped).toEqual([])
    expect(decoded.ast).toEqual(filter.valid.value)

    // 4. A custom Drizzle translator pulls both halves of the value into
    // the right columns. The query executes against pglite and returns
    // exactly the row matching both amount and currency.
    const translator = createDrizzleTranslator({
      schema: moneySchema,
      columns: { price: moneyTable.priceAmount },
      ops: {
        moneyEq: (col, value) => {
          const v = value as { amount: number, currency: string }
          return sql`${col} = ${v.amount} AND ${moneyTable.priceCurrency} = ${v.currency}`
        },
      },
    })
    const rows = await db.select().from(moneyTable).where(translator.toWhere(decoded.ast))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ priceAmount: 250, priceCurrency: 'USD' })
  })
})

// Slice 13: both variants on the same router-aware filter, with a
// shared #value slot override that renders identical custom inputs in
// both UIs. Exercises the slot system + popover behaviour + URL sync
// in one integrated harness.
describe('end-to-end: vertical-stack + popover-trigger sharing one slot override', () => {
  it('renders identical slot content in both variants and keeps URL state shared', async () => {
    const variantSchema = defineFilterSchema({
      fields: {
        title: f.string(),
      },
    })
    const filter = useFilter({
      schema: variantSchema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'shared' }],
      },
    })
    const valueSlot = {
      value: ({
        value,
        setValue,
      }: {
        value: unknown
        setValue: (v: unknown) => void
      }) =>
        h('input', {
          type: 'text',
          'data-testid': 'shared-slot',
          value: typeof value === 'string' ? value : '',
          onInput: (e: Event) => setValue((e.target as HTMLInputElement).value),
        }),
    }

    const stack = mount(FilterBuilder, {
      props: { filter, variant: 'vertical-stack' },
      slots: valueSlot,
      attachTo: document.body,
    })
    expect(stack.find('[data-testid="shared-slot"]').exists()).toBe(true)
    await stack.find('[data-testid="shared-slot"]').setValue('via-stack')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'eq',
      value: 'via-stack',
    })

    // Mount the popover variant against the same filter — slot override
    // applies identically and shares state via the composable.
    const pop = mount(FilterBuilder, {
      props: { filter, variant: 'popover-trigger' },
      slots: valueSlot,
      attachTo: document.body,
    })
    expect(pop.find('[data-testid="popover-trigger"]').text()).toBe('1 filter')
    await pop.find('[data-testid="popover-trigger"]').trigger('click')
    expect(pop.find('[data-testid="popover-panel"]').exists()).toBe(true)
    expect(pop.find('[data-testid="shared-slot"]').exists()).toBe(true)
    await pop.find('[data-testid="shared-slot"]').setValue('via-popover')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'eq',
      value: 'via-popover',
    })
    // Both UIs reflect the shared filter state immediately.
    const stackInput = stack.find('[data-testid="shared-slot"]').element as HTMLInputElement
    expect(stackInput.value).toBe('via-popover')

    stack.unmount()
    pop.unmount()
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
