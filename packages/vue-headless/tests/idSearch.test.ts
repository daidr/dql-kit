import { defineFilterSchema, f, type Item, type SearchPage } from '@dql-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAsyncOrchestrator, useFilter, type SearchSlotState } from '../src/index.ts'

const flush = () => new Promise((r) => setTimeout(r, 0))

const sink = () => {
  let state: Partial<SearchSlotState> = {}
  return {
    onPatch: (p: Partial<SearchSlotState>) => {
      state = { ...state, ...p }
    },
    get: () => state,
  }
}

const people = Array.from({ length: 5 }, (_, i): Item<number> => ({ id: i + 1, label: `P${i + 1}` }))

// Pages of two; the cursor is the next offset.
const pager = vi.fn(async (q: string, cursor: unknown): Promise<SearchPage<number>> => {
  const from = typeof cursor === 'number' ? cursor : 0
  const matching = people.filter((p) => p.label.includes(q.toUpperCase()))
  const items = matching.slice(from, from + 2)
  return from + 2 < matching.length ? { items, nextCursor: from + 2 } : { items }
})

describe('orchestrator — paged search', () => {
  beforeEach(() => {
    pager.mockClear()
  })

  it('loads the first page, then appends pages until the last', async () => {
    const orch = createAsyncOrchestrator()
    const s = sink()
    orch.setQuery('p', '', { searchPage: pager }, 0, s.onPatch)
    await flush()
    expect(s.get()).toMatchObject({ hasMore: true, loading: false })
    expect(s.get().results!.map((i) => i.id)).toEqual([1, 2])
    expect(pager).toHaveBeenLastCalledWith('', undefined, expect.any(AbortSignal))

    orch.loadMore()
    expect(s.get().loading).toBe(true)
    await flush()
    expect(s.get().results!.map((i) => i.id)).toEqual([1, 2, 3, 4])
    expect(pager).toHaveBeenLastCalledWith('', 2, expect.any(AbortSignal))

    orch.loadMore()
    await flush()
    expect(s.get().results!.map((i) => i.id)).toEqual([1, 2, 3, 4, 5])
    expect(s.get().hasMore).toBe(false)
    orch.loadMore()
    expect(pager).toHaveBeenCalledTimes(3)
  })

  it('prefers searchPage over search', async () => {
    const search = vi.fn(async () => [])
    const orch = createAsyncOrchestrator()
    orch.setQuery('p', 'x', { search, searchPage: pager }, 0, sink().onPatch)
    await flush()
    expect(search).not.toHaveBeenCalled()
    expect(pager).toHaveBeenCalledTimes(1)
  })

  it('a plain search has no more pages', async () => {
    const orch = createAsyncOrchestrator()
    const s = sink()
    orch.setQuery('p', 'x', { search: async () => people }, 0, s.onPatch)
    await flush()
    expect(s.get()).toMatchObject({ hasMore: false })
    orch.loadMore()
    expect(s.get().results).toHaveLength(5)
  })

  it('a new query drops a page still loading for the old one', async () => {
    let release!: (p: SearchPage<number>) => void
    const slowPager = vi.fn((_q: string, cursor: unknown): Promise<SearchPage<number>> =>
      cursor === undefined
        ? Promise.resolve({ items: [people[0]!], nextCursor: 1 })
        : new Promise((r) => {
          release = r
        }))
    const orch = createAsyncOrchestrator()
    const s = sink()
    orch.setQuery('p', 'a', { searchPage: slowPager }, 0, s.onPatch)
    await flush()
    orch.loadMore()
    orch.setQuery('p', 'b', { searchPage: slowPager }, 0, s.onPatch)
    await flush()
    release({ items: [people[4]!] })
    await flush()
    expect(s.get().query).toBe('b')
    expect(s.get().results!.map((i) => i.id)).toEqual([1])
  })

  it('a failed page keeps the results shown and can be retried', async () => {
    let fail = true
    const flaky = vi.fn(async (_q: string, cursor: unknown): Promise<SearchPage<number>> => {
      if (cursor === undefined) return { items: [people[0]!], nextCursor: 1 }
      if (fail) throw new Error('boom')
      return { items: [people[1]!] }
    })
    const orch = createAsyncOrchestrator()
    const s = sink()
    orch.setQuery('p', '', { searchPage: flaky }, 0, s.onPatch)
    await flush()
    orch.loadMore()
    await flush()
    expect(s.get().error?.message).toBe('boom')
    expect(s.get().results!.map((i) => i.id)).toEqual([1])
    fail = false
    orch.loadMore()
    await flush()
    expect(s.get().results!.map((i) => i.id)).toEqual([1, 2])
    expect(s.get().error).toBeNull()
  })

  it('results repeated across pages are listed once', async () => {
    const overlapping = async (_q: string, cursor: unknown): Promise<SearchPage<number>> =>
      cursor === undefined ? { items: [people[0]!, people[1]!], nextCursor: 1 } : { items: [people[1]!, people[2]!] }
    const orch = createAsyncOrchestrator()
    const s = sink()
    orch.setQuery('p', '', { searchPage: overlapping }, 0, s.onPatch)
    await flush()
    orch.loadMore()
    await flush()
    expect(s.get().results!.map((i) => i.id)).toEqual([1, 2, 3])
  })
})

const schema = defineFilterSchema({ fields: { author: f.id<number>(), editor: f.id<number>() } })
const resolve = vi.fn(async (ids: number[]) =>
  people.filter((p) => ids.some((id) => String(id) === String(p.id))))

describe('useFilter — search slot paging', () => {
  it('exposes hasMore and loadMore', async () => {
    const filter = useFilter({ schema, sync: 'none', debounceMs: 0, fetchers: { author: { searchPage: pager, resolve } } })
    filter.search.value.setQuery('author', '')
    await flush()
    expect(filter.search.value.hasMore).toBe(true)
    filter.search.value.loadMore()
    await flush()
    expect(filter.search.value.results.map((i) => i.id)).toEqual([1, 2, 3, 4])
  })
})

describe('useFilter — recently picked ids', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('keeps the newest first, per field, without duplicates, up to the limit', () => {
    const filter = useFilter({ schema, sync: 'none', recentIds: { limit: 3 } })
    filter.rememberIds('author', [1])
    filter.rememberIds('author', [2])
    filter.rememberIds('author', [1])
    filter.rememberIds('author', [3, 4])
    filter.rememberIds('editor', [9])
    expect(filter.recentIds('author')).toEqual([4, 3, 1])
    expect(filter.recentIds('editor')).toEqual([9])
    expect(filter.recentIds('nope')).toEqual([])
  })

  it('limit 0 turns it off; memory only by default', () => {
    const off = useFilter({ schema, sync: 'none', recentIds: { limit: 0 } })
    off.rememberIds('author', [1])
    expect(off.recentIds('author')).toEqual([])
    const mem = useFilter({ schema, sync: 'none' })
    mem.rememberIds('author', [1])
    expect(sessionStorage.length).toBe(0)
  })

  it('persist: session survives a new instance and ignores junk', () => {
    const a = useFilter({ schema, sync: 'none', queryKey: 'q', recentIds: { persist: 'session' } })
    a.rememberIds('author', [1, 2])
    const b = useFilter({ schema, sync: 'none', queryKey: 'q', recentIds: { persist: 'session' } })
    expect(b.recentIds('author')).toEqual([2, 1])
    sessionStorage.setItem('dql-kit:recent:q', '{nope')
    const c = useFilter({ schema, sync: 'none', queryKey: 'q', recentIds: { persist: 'session' } })
    expect(c.recentIds('author')).toEqual([])
  })

  it('an empty query resolves the labels of recent ids', async () => {
    resolve.mockClear()
    const filter = useFilter({ schema, sync: 'none', debounceMs: 0, fetchers: { author: { search: async () => [], resolve } } })
    filter.rememberIds('author', [3])
    filter.search.value.setQuery('author', '')
    await flush()
    expect(resolve).toHaveBeenCalledWith([3], expect.any(AbortSignal))
    expect(filter.labelOf('author', 3)).toMatchObject({ status: 'resolved', label: 'P3' })
  })
})

describe('useFilter — lookupIds', () => {
  it('splits found and missing, matching on String(id), and fills the label cache', async () => {
    resolve.mockClear()
    const filter = useFilter({ schema, sync: 'none', fetchers: { author: { search: async () => [], resolve } } })
    const res = await filter.lookupIds('author', [' 2 ', '7', '2', '', '5'])
    expect(res.found.map((i) => i.id)).toEqual([2, 5])
    expect(res.missing).toEqual(['7'])
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0]![0]).toEqual(['2', '7', '5'])
    expect(filter.labelOf('author', 2)).toMatchObject({ status: 'resolved', label: 'P2' })
  })

  it('without a fetcher everything is missing', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    expect(await filter.lookupIds('author', ['1'])).toEqual({ found: [], missing: ['1'] })
  })
})
