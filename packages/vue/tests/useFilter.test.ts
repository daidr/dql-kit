import { defineFilterSchema, f, type Item, type ValidAST } from '@dql-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isProxy, isReactive, isRef, nextTick, ref } from 'vue'
import { useFilter } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number(),
  },
})

describe('useFilter — reactive surface', () => {
  it('exposes draft and valid as reactive', () => {
    const filter = useFilter({ schema, sync: 'none' })
    expect(isRef(filter.draft)).toBe(true)
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })

  it('valid is plain data — no Vue proxy/ref leak', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    const v = filter.valid.value
    expect(isProxy(v)).toBe(false)
    expect(isReactive(v)).toBe(false)
    expect(isRef(v)).toBe(false)
    // children too
    expect(isProxy(v.children[0])).toBe(false)
  })

  it('schema accepts a Ref<S | undefined>', () => {
    const schemaRef = ref<typeof schema | undefined>(schema)
    const filter = useFilter({ schema: schemaRef, sync: 'none' })
    expect(filter.schema.value).toStrictEqual(schema)
    schemaRef.value = undefined
    expect(filter.schema.value).toBeUndefined()
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })
})

describe('useFilter — actions', () => {
  it('addCondition + updateNode produces a single eq condition in valid', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([])
    filter.actions.updateNode([0], { field: 'title' })
    filter.actions.updateNode([0], { op: 'eq', value: 'hello' })
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    })
  })

  it('updateNode with field change resets op and value', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    filter.actions.updateNode([0], { field: 'rating' })
    const cond = filter.draft.value.children[0] as {
      field: string | null
      op: string | null
      value?: unknown
    }
    expect(cond.field).toBe('rating')
    expect(cond.op).toBeNull()
    expect(cond.value).toBeUndefined()
  })

  it('removeNode removes the condition at path', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'b' })
    filter.actions.removeNode([0])
    expect(filter.valid.value.children).toEqual([
      { field: 'title', op: 'eq', value: 'b' },
    ])
  })

  it('clear empties the draft', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    filter.actions.clear()
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })

  it('addGroup nests a sub-group', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addGroup([], 'or')
    filter.actions.addCondition([0], { field: 'title', op: 'eq', value: 'a' })
    expect(filter.draft.value.children).toHaveLength(1)
    const group = filter.draft.value.children[0] as { combinator: string, children: unknown[] }
    expect(group.combinator).toBe('or')
    expect(group.children).toHaveLength(1)
  })

  it('setCombinator flips root and/or', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.setCombinator([], 'or')
    expect(filter.draft.value.combinator).toBe('or')
  })
})

describe('useFilter — applyAst / toJSON', () => {
  it('applyAst loads a Valid AST as the new draft', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const ast: ValidAST = {
      combinator: 'or',
      children: [{ field: 'title', op: 'eq', value: 'preset' }],
    }
    filter.applyAst(ast)
    expect(filter.valid.value).toEqual(ast)
  })

  it('toJSON returns the current Valid AST snapshot', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'x' })
    const json = filter.toJSON()
    expect(json).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'x' }],
    })
  })
})

describe('useFilter — errors surface', () => {
  it('returns [] for a valid draft', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    expect(filter.errors.value).toEqual([])
  })

  it('reports incomplete for a half-built condition', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([])
    expect(filter.errors.value.length).toBeGreaterThan(0)
    expect(filter.errors.value[0]?.code).toBe('incomplete')
  })

  it('errors recompute on every draft edit without an explicit re-validate', () => {
    const filter = useFilter({ schema, sync: 'none' })
    // Start with an incomplete condition.
    filter.actions.addCondition([])
    expect(filter.errors.value[0]?.code).toBe('incomplete')
    // Pick a field — still incomplete (op missing).
    filter.actions.updateNode([0], { field: 'title' })
    expect(filter.errors.value[0]).toMatchObject({ code: 'incomplete', missing: 'op' })
    // Pick an op — value still missing.
    filter.actions.updateNode([0], { op: 'eq' })
    expect(filter.errors.value[0]).toMatchObject({ code: 'incomplete', missing: 'value' })
    // Type-mismatched value — code flips to value_type_mismatch.
    filter.actions.updateNode([0], { field: 'rating', op: 'eq', value: 'oops' })
    expect(filter.errors.value[0]).toMatchObject({ code: 'value_type_mismatch' })
    // Fix the value — errors clears.
    filter.actions.updateNode([0], { value: 5 })
    expect(filter.errors.value).toEqual([])
  })

  it('multiple errors at distinct paths surface together', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'mystery', op: 'eq', value: 'x' },
          { field: 'rating', op: 'eq', value: 'oops' },
        ],
      },
    })
    expect(filter.errors.value).toHaveLength(2)
    expect(filter.errors.value.map((e) => [e.code, e.path])).toEqual([
      ['unknown_field', [0]],
      ['value_type_mismatch', [1]],
    ])
  })
})

describe('useFilter — async id integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Fixture authors keyed by id; the fetcher reads from this so we can
  // observe call-arguments + control returned items per test.
  const authorRows = (ids: (string | number)[]): Item[] =>
    ids.map((id) => ({ id, label: `Author ${String(id)}` }))

  // Schema is a plain constant — fetcher is now provided per-useFilter,
  // not on the schema (post-refactor).
  const idSchema = defineFilterSchema({
    fields: {
      authorId: f.id(),
    },
  })

  const fetchers = (
    search: (q: string, signal: AbortSignal) => Promise<Item[]> | Item[],
    resolve: (
      ids: (string | number)[],
      signal: AbortSignal,
    ) => Promise<Item[]> | Item[],
  ) => ({
    authorId: {
      search: search as (q: string, signal: AbortSignal) => Promise<Item[]>,
      resolve: resolve as (
        ids: (string | number)[],
        signal: AbortSignal,
      ) => Promise<Item[]>,
    },
  })

  it('eager resolve fires once per field on mount when initial AST contains id values', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'in', value: [1, 2, 3] }],
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0]?.[0]).toEqual([1, 2, 3])
  })

  it('labelOf transitions pending → resolved reactively after fetcher settles', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: 42 }],
      },
    })
    expect(filter.labelOf('authorId', 42)).toEqual({ status: 'pending' })
    await vi.advanceTimersByTimeAsync(0)
    expect(filter.labelOf('authorId', 42)).toMatchObject({
      status: 'resolved',
      label: 'Author 42',
    })
  })

  it('search.setQuery debounces (250ms default) and emits a single fetcher call with the latest query', async () => {
    const search = vi.fn(async (q: string) => authorRows([q]))
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
    })

    filter.search.value.setQuery('authorId', 'a')
    filter.search.value.setQuery('authorId', 'ab')
    filter.search.value.setQuery('authorId', 'abc')
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0]?.[0]).toBe('abc')
    expect(filter.search.value.fieldKey).toBe('authorId')
    expect(filter.search.value.results).toHaveLength(1)
  })

  it('debounceMs option overrides the default', async () => {
    const search = vi.fn(async (q: string) => authorRows([q]))
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
      debounceMs: 0,
    })
    filter.search.value.setQuery('authorId', 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('invalidateLabels() clears the cache and re-issues resolve for current AST', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: 1 }],
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolve).toHaveBeenCalledTimes(1)
    filter.invalidateLabels()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('newly added id values trigger an additional resolve call', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
    })
    filter.actions.addCondition([], { field: 'authorId', op: 'eq', value: 7 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0]?.[0]).toEqual([7])
    filter.actions.addCondition([], { field: 'authorId', op: 'eq', value: 8 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    // Second call only contains the new id (cache hit on 7).
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve.mock.calls[1]?.[0]).toEqual([8])
  })

  it('search rejection: error populated, loading false, results unchanged', async () => {
    const boom = new Error('search-failed')
    const search = vi.fn(async () => {
      throw boom
    })
    const resolve = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
      debounceMs: 0,
    })
    filter.search.value.setQuery('authorId', 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(filter.search.value.error).toBe(boom)
    expect(filter.search.value.loading).toBe(false)
    expect(filter.search.value.results).toEqual([])
  })

  it('sync resolve fetcher: labelOf is resolved on first read (no flicker)', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = (ids: (string | number)[]): Item[] => authorRows(ids)
    const filter = useFilter({
      schema: idSchema,
      fetchers: fetchers(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: 1 }],
      },
    })
    // No timer advance; sync fetcher writes through immediately.
    expect(filter.labelOf('authorId', 1)).toMatchObject({
      status: 'resolved',
      label: 'Author 1',
    })
  })

  it('id field with no fetcher entry: AST flows through, label resolves to error/pending fallback', async () => {
    const filter = useFilter({
      schema: idSchema,
      // No fetchers map at all
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: 99 }],
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    // No fetcher → orchestrator never primed; labelOf falls back to pending.
    expect(filter.labelOf('authorId', 99)).toEqual({ status: 'pending' })
    // search.setQuery is still safe to call — it no-ops without a fetcher.
    expect(() => filter.search.value.setQuery('authorId', 'foo')).not.toThrow()
  })
})
