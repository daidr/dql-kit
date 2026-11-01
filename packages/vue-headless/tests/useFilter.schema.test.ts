import { defineFilterSchema, f, omitFields, toUrl, type DraftAST, type FilterSchema, type Item, type ValidAST } from '@dql-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createMemoryUrlAdapter, useFilter } from '../src/index.ts'

const full = defineFilterSchema({
  fields: {
    title: f.string(),
    salary: f.number(),
    author: f.id<number>(),
  },
})
const restricted = omitFields(full, ['salary'])

const urlAst: ValidAST = {
  combinator: 'and',
  children: [
    { field: 'title', op: 'eq', value: 'hello' },
    { field: 'salary', op: 'gt', value: 100 },
  ],
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('useFilter — schema loaded later', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('reads the URL once the schema arrives, and does not overwrite it before', async () => {
    const adapter = createMemoryUrlAdapter(toUrl(urlAst))
    const schema = ref<FilterSchema | undefined>(undefined)
    const filter = useFilter({ schema, sync: adapter })
    expect(filter.committedValid.value).toEqual({ combinator: 'and', children: [] })
    await nextTick()
    expect(adapter.read()).toBe(toUrl(urlAst))

    schema.value = full
    expect(filter.committedValid.value).toEqual(urlAst)
    expect(filter.draft.value).toEqual(urlAst)
    await nextTick()
    expect(adapter.read()).toBe(toUrl(urlAst))
  })

  it('reports URL conditions the loaded schema rejects', async () => {
    const adapter = createMemoryUrlAdapter(toUrl(urlAst))
    const schema = ref<FilterSchema | undefined>(undefined)
    const filter = useFilter({ schema, sync: adapter })
    schema.value = restricted
    expect(filter.committedValid.value.children).toEqual([{ field: 'title', op: 'eq', value: 'hello' }])
    expect(filter.dropped.value).toEqual([{ path: [1], code: 'unknown_field', field: 'salary' }])
  })

  it('restores the saved draft once the schema arrives', async () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'edited' }, { field: null, op: null }],
    }
    sessionStorage.setItem('dql-kit:draft:filter', JSON.stringify({ v: 1, base: urlAst, draft }))
    const adapter = createMemoryUrlAdapter(toUrl(urlAst))
    const schema = ref<FilterSchema | undefined>(undefined)
    const filter = useFilter({ schema, sync: adapter, commitMode: 'manual', persistDraft: 'session' })
    // Nothing read or cleared yet.
    expect(sessionStorage.getItem('dql-kit:draft:filter')).not.toBeNull()
    schema.value = full
    expect(filter.draft.value).toEqual(draft)
    expect(filter.committedValid.value).toEqual(urlAst)
    expect(filter.isDirty.value).toBe(true)
  })

  it('keeps the committed filter while the schema is unset again', async () => {
    const adapter = createMemoryUrlAdapter(toUrl(urlAst))
    const schema = ref<FilterSchema | undefined>(full)
    const filter = useFilter({ schema, sync: adapter })
    schema.value = undefined
    await nextTick()
    expect(filter.committedValid.value).toEqual(urlAst)
    expect(adapter.read()).toBe(toUrl(urlAst))
  })
})

describe('useFilter — schema switched', () => {
  it('removes conditions on fields the new schema lacks and reports them', async () => {
    const adapter = createMemoryUrlAdapter(toUrl(urlAst))
    const schema = ref<FilterSchema>(full)
    const filter = useFilter({ schema, sync: adapter })
    schema.value = restricted
    const kept: ValidAST = { combinator: 'and', children: [{ field: 'title', op: 'eq', value: 'hello' }] }
    expect(filter.draft.value).toEqual(kept)
    expect(filter.committedValid.value).toEqual(kept)
    expect(filter.dropped.value).toEqual([{ path: [1], code: 'unknown_field', field: 'salary' }])
    await nextTick()
    expect(adapter.read()).toBe(toUrl(kept))
  })

  it('keeps uncommitted edits in manual mode, minus removed fields', () => {
    const schema = ref<FilterSchema>(full)
    const filter = useFilter({ schema, sync: 'none', commitMode: 'manual', initial: urlAst })
    filter.actions.updateNode([0], { value: 'edited' })
    filter.actions.addCondition([])
    filter.actions.addGroup([], 'or', [{ field: 'salary', op: 'lt', value: 5 }])
    schema.value = restricted
    expect(filter.draft.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'edited' }, { field: null, op: null }],
    })
    expect(filter.committedValid.value.children).toEqual([{ field: 'title', op: 'eq', value: 'hello' }])
    expect(filter.isDirty.value).toBe(true)
  })

  it('renames conditions to the field that lists the old name as an alias', () => {
    const schema = ref<FilterSchema>(full)
    const filter = useFilter({ schema, sync: 'none', initial: urlAst })
    schema.value = defineFilterSchema({ fields: { name: f.string({ aliases: ['title'] }), salary: f.number() } })
    expect(filter.draft.value.children[0]).toEqual({ field: 'name', op: 'eq', value: 'hello' })
    expect(filter.committedValid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'name', op: 'eq', value: 'hello' }, { field: 'salary', op: 'gt', value: 100 }],
    })
    expect(filter.dropped.value).toEqual([])
  })

  it('leaves the state alone when nothing is removed', () => {
    const schema = ref<FilterSchema>(full)
    const filter = useFilter({ schema, sync: 'none', initial: urlAst })
    const before = filter.draft.value
    schema.value = defineFilterSchema({ fields: { ...full.fields, extra: f.boolean() } })
    expect(filter.draft.value).toBe(before)
    expect(filter.dropped.value).toEqual([])
  })

  it('drops cached id labels of a redefined field and re-resolves them', async () => {
    const resolve = vi.fn(async (ids: number[]): Promise<Item<number>[]> =>
      ids.map((id) => ({ id, label: `user ${id} v${resolve.mock.calls.length}` })))
    const schema = ref<FilterSchema>(full)
    const filter = useFilter({
      schema,
      sync: 'none',
      fetchers: { author: { search: async () => [], resolve } },
      initial: { combinator: 'and', children: [{ field: 'author', op: 'eq', value: 7 }] },
    })
    await flush()
    expect(filter.labelOf('author', 7)).toMatchObject({ status: 'resolved', label: 'user 7 v1' })
    schema.value = defineFilterSchema({ fields: { ...full.fields, author: f.id<number>({ label: 'Owner' }) } })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(filter.labelOf('author', 7)).toMatchObject({ status: 'resolved', label: 'user 7 v2' })
  })

  it('clears the search slot of a removed field', async () => {
    const search = vi.fn(async () => [{ id: 1, label: 'one' }])
    const schema = ref<FilterSchema>(full)
    const filter = useFilter({
      schema,
      sync: 'none',
      debounceMs: 0,
      fetchers: { author: { search, resolve: async () => [] } },
    })
    filter.search.value.setQuery('author', 'o')
    expect(filter.search.value.fieldKey).toBe('author')
    schema.value = omitFields(full, ['author'])
    expect(filter.search.value).toMatchObject({ fieldKey: null, query: '', results: [], loading: false })
    await flush()
    expect(filter.search.value.results).toEqual([])
  })
})
