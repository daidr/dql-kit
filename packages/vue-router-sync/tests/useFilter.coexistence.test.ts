import { defineFilterSchema, f, fromUrl, toUrl, type Item } from '@dql-kit/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { defineComponent, h } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  type Router,
} from 'vue-router'
import { useFilter, type UseFilterReturn } from '@dql-kit/vue-headless'
import { vueRouterUrlAdapter } from '../src/index.ts'

const schemaA = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number(),
  },
})
const schemaB = defineFilterSchema({
  fields: {
    status: f.enum(['draft', 'published'] as const),
    title: f.string(),
  },
})

const STORAGE_PREFIX = 'dql-kit:draft:'

type FilterA = UseFilterReturn<typeof schemaA>
type FilterB = UseFilterReturn<typeof schemaB>

const buildPair = async (
  options: {
    keyA?: string
    keyB?: string
    persistA?: 'session' | 'none'
    persistB?: 'session' | 'none'
    initialPath?: string
    sync?: 'url' | 'none'
  } = {},
): Promise<{
  router: Router
  filterA: FilterA
  filterB: FilterB
  wrapper: VueWrapper
}> => {
  const sync = options.sync ?? 'url'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push(options.initialPath ?? '/')
  await router.isReady()

  let filterA!: FilterA
  let filterB!: FilterB
  const Harness = defineComponent({
    setup() {
      const adapterA = sync === 'url' ? vueRouterUrlAdapter({ queryKey: options.keyA ?? 'a' }) : 'none'
      const adapterB = sync === 'url' ? vueRouterUrlAdapter({ queryKey: options.keyB ?? 'b' }) : 'none'
      filterA = useFilter({
        schema: schemaA,
        sync: adapterA,
        queryKey: options.keyA ?? 'a',
        persistDraft: options.persistA,
      }) as FilterA
      filterB = useFilter({
        schema: schemaB,
        sync: adapterB,
        queryKey: options.keyB ?? 'b',
        persistDraft: options.persistB,
      }) as FilterB
      return () => h('div')
    },
  })
  const wrapper = mount(Harness, { global: { plugins: [router] } })
  return { router, filterA, filterB, wrapper }
}

describe('useFilter — multi-filter URL key isolation', () => {
  it('two filters write to disjoint URL keys', async () => {
    const { filterA, filterB, router, wrapper } = await buildPair()
    // Mutations serialised across microtasks, mirroring real UI events.
    // Two filters mutated in the same synchronous block would race on the
    // shared route.query snapshot — out-of-scope for this slice.
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'A-val' })
    await flushPromises()
    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'published',
    })
    await flushPromises()

    expect(typeof router.currentRoute.value.query.a).toBe('string')
    expect(typeof router.currentRoute.value.query.b).toBe('string')
    // The two encoded values are different.
    expect(router.currentRoute.value.query.a).not.toBe(router.currentRoute.value.query.b)

    // Decoding A's key only yields A's AST.
    const decodedA = fromUrl(router.currentRoute.value.query.a as string, schemaA)
    expect(decodedA.ast).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'A-val' }],
    })
    const decodedB = fromUrl(router.currentRoute.value.query.b as string, schemaB)
    expect(decodedB.ast).toEqual({
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'published' }],
    })
    wrapper.unmount()
  })

  it('mutation in A does not change B\'s URL key (and vice versa)', async () => {
    const { filterA, filterB, router, wrapper } = await buildPair()
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'first' })
    await flushPromises()
    const aSnapshot1 = router.currentRoute.value.query.a
    expect(router.currentRoute.value.query.b).toBeUndefined()

    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'draft',
    })
    await flushPromises()
    // A's key untouched.
    expect(router.currentRoute.value.query.a).toBe(aSnapshot1)
    expect(typeof router.currentRoute.value.query.b).toBe('string')

    // Now another A mutation; B's key untouched.
    const bSnapshot = router.currentRoute.value.query.b
    filterA.actions.addCondition([], { field: 'rating', op: 'gt', value: 5 })
    await flushPromises()
    expect(router.currentRoute.value.query.b).toBe(bSnapshot)
    wrapper.unmount()
  })

  it('clearing A removes only A\'s URL key, leaves B intact', async () => {
    const { filterA, filterB, router, wrapper } = await buildPair()
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'A' })
    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'draft',
    })
    await flushPromises()
    filterA.actions.clear()
    await flushPromises()
    expect(router.currentRoute.value.query.a).toBeUndefined()
    expect(typeof router.currentRoute.value.query.b).toBe('string')
    wrapper.unmount()
  })

  it('two filters with custom queryKey on disjoint keys both load from URL on mount', async () => {
    const astA = {
      combinator: 'and' as const,
      children: [{ field: 'title', op: 'eq', value: 'init-A' }],
    }
    const astB = {
      combinator: 'and' as const,
      children: [{ field: 'status', op: 'eq', value: 'published' }],
    }
    const path = `/?leftPanel=${toUrl(astA)}&rightPanel=${toUrl(astB)}`
    const { filterA, filterB, wrapper } = await buildPair({
      keyA: 'leftPanel',
      keyB: 'rightPanel',
      initialPath: path,
    })
    expect(filterA.valid.value).toEqual(astA)
    expect(filterB.valid.value).toEqual(astB)
    wrapper.unmount()
  })
})

describe('useFilter — multi-filter sessionStorage isolation', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('persistDraft on both: sessionStorage keys are disjoint', async () => {
    const { filterA, filterB, wrapper } = await buildPair({
      persistA: 'session',
      persistB: 'session',
    })
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'A' })
    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'draft',
    })
    await flushPromises()

    const rawA = sessionStorage.getItem(`${STORAGE_PREFIX}a`)
    const rawB = sessionStorage.getItem(`${STORAGE_PREFIX}b`)
    expect(rawA).not.toBeNull()
    expect(rawB).not.toBeNull()
    expect(JSON.parse(rawA!).draft.children[0]).toMatchObject({ field: 'title' })
    expect(JSON.parse(rawB!).draft.children[0]).toMatchObject({ field: 'status' })
    wrapper.unmount()
  })

  it('persistDraft on A only: B does not write to sessionStorage', async () => {
    const { filterA, filterB, wrapper } = await buildPair({
      persistA: 'session',
      persistB: 'none',
    })
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'A' })
    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'draft',
    })
    await flushPromises()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}a`)).not.toBeNull()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}b`)).toBeNull()
    wrapper.unmount()
  })

  it('clearing A removes only A\'s storage key', async () => {
    const { filterA, filterB, wrapper } = await buildPair({
      persistA: 'session',
      persistB: 'session',
    })
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'A' })
    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'draft',
    })
    await flushPromises()
    filterA.actions.clear()
    await flushPromises()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}a`)).toBeNull()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}b`)).not.toBeNull()
    wrapper.unmount()
  })
})

describe('useFilter — multi-filter reactive surface independence', () => {
  it('errors and dropped surfaces are per-instance', async () => {
    // Build a path that puts a stale field in A's key only — only A should
    // see a dropped node.
    const compactStaleA = { c: 'and', n: [{ f: 'mystery', o: 'eq', v: 'x' }] }
    const path = `/?a=${encodeURIComponent(JSON.stringify(compactStaleA))}`
    const { filterA, filterB, wrapper } = await buildPair({ initialPath: path })
    expect(filterA.dropped.value).toHaveLength(1)
    expect(filterA.dropped.value[0]?.reason).toBe('unknown_field')
    expect(filterB.dropped.value).toEqual([])

    // Errors: introduce an in-progress condition on A only.
    filterA.actions.addCondition([])
    await flushPromises()
    expect(filterA.errors.value.length).toBeGreaterThan(0)
    expect(filterB.errors.value).toEqual([])
    wrapper.unmount()
  })

  it('dismissDropped on A does not touch B', async () => {
    const compactStaleA = { c: 'and', n: [{ f: 'mystery', o: 'eq', v: 'x' }] }
    const compactStaleB = { c: 'and', n: [{ f: 'unknown', o: 'eq', v: 'y' }] }
    const path = `/?a=${encodeURIComponent(JSON.stringify(compactStaleA))}&b=${encodeURIComponent(JSON.stringify(compactStaleB))}`
    const { filterA, filterB, wrapper } = await buildPair({ initialPath: path })
    expect(filterA.dropped.value).toHaveLength(1)
    expect(filterB.dropped.value).toHaveLength(1)

    filterA.dismissDropped()
    expect(filterA.dropped.value).toEqual([])
    // B's surface untouched.
    expect(filterB.dropped.value).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('useFilter — multi-filter async fetcher isolation', () => {
  beforeAll(() => vi.useFakeTimers())
  afterAll(() => vi.useRealTimers())

  it('search slots are per-instance — setQuery on A does not change B.search', async () => {
    const authorRows = (ids: (string | number)[]): Item[] =>
      ids.map((id) => ({ id, label: `A:${String(id)}` }))
    const tagRows = (ids: (string | number)[]): Item[] =>
      ids.map((id) => ({ id, label: `T:${String(id)}` }))

    const sA = vi.fn(async (q: string) => authorRows([q]))
    const rA = vi.fn(async (ids: (string | number)[]) => authorRows(ids))
    const sB = vi.fn(async (q: string) => tagRows([q]))
    const rB = vi.fn(async (ids: (string | number)[]) => tagRows(ids))

    const idSchemaA = defineFilterSchema({
      fields: {
        authorId: f.id(),
      },
    })
    const idSchemaB = defineFilterSchema({
      fields: {
        tagId: f.id(),
      },
    })
    const fetchersA = {
      authorId: {
        search: sA as (q: string, signal: AbortSignal) => Promise<Item[]>,
        resolve: rA as (ids: (string | number)[], signal: AbortSignal) => Promise<Item[]>,
      },
    }
    const fetchersB = {
      tagId: {
        search: sB as (q: string, signal: AbortSignal) => Promise<Item[]>,
        resolve: rB as (ids: (string | number)[], signal: AbortSignal) => Promise<Item[]>,
      },
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }],
    })
    await router.push('/')
    await router.isReady()

    let fA!: UseFilterReturn<typeof idSchemaA>
    let fB!: UseFilterReturn<typeof idSchemaB>
    const Harness = defineComponent({
      setup() {
        fA = useFilter({
          schema: idSchemaA,
          fetchers: fetchersA,
          sync: 'none',
          queryKey: 'a',
          debounceMs: 0,
        }) as UseFilterReturn<typeof idSchemaA>
        fB = useFilter({
          schema: idSchemaB,
          fetchers: fetchersB,
          sync: 'none',
          queryKey: 'b',
          debounceMs: 0,
        }) as UseFilterReturn<typeof idSchemaB>
        return () => h('div')
      },
    })
    const wrapper = mount(Harness, { global: { plugins: [router] } })

    fA.search.value.setQuery('authorId', 'foo')
    await vi.advanceTimersByTimeAsync(0)

    expect(sA).toHaveBeenCalledTimes(1)
    expect(sB).not.toHaveBeenCalled()
    expect(fA.search.value.fieldKey).toBe('authorId')
    expect(fB.search.value.fieldKey).toBeNull()
    expect(fA.search.value.results).toHaveLength(1)
    expect(fB.search.value.results).toHaveLength(0)

    // invalidating A's labels does not touch B's resolve cache.
    fA.invalidateLabels()
    await vi.advanceTimersByTimeAsync(0)
    // B fetcher untouched throughout.
    expect(rB).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('useFilter — multi-filter integration (full slice 14 acceptance)', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('two filters on one router: independent URL + sessionStorage + reactive surfaces', async () => {
    const { filterA, filterB, router, wrapper } = await buildPair({
      keyA: 'leftPanel',
      keyB: 'rightPanel',
      persistA: 'session',
      persistB: 'session',
    })

    // 1. Mutate each independently — serialised so the URL writers don't
    // race on the shared route.query snapshot. Real UI events are already
    // serialised across microtasks, so this matches production behaviour.
    filterA.actions.addCondition([], { field: 'title', op: 'eq', value: 'left-1' })
    await flushPromises()
    filterB.actions.addCondition([], {
      field: 'status',
      op: 'eq',
      value: 'draft',
    })
    await flushPromises()
    filterA.actions.addCondition([]) // A in-progress only
    await flushPromises()

    // 2. URL — disjoint keys carrying disjoint payloads.
    const aRaw = router.currentRoute.value.query.leftPanel
    const bRaw = router.currentRoute.value.query.rightPanel
    expect(typeof aRaw).toBe('string')
    expect(typeof bRaw).toBe('string')
    expect(aRaw).not.toBe(bRaw)
    expect(router.currentRoute.value.query.filter).toBeUndefined()

    // 3. SessionStorage — disjoint keys.
    const aSaved = sessionStorage.getItem(`${STORAGE_PREFIX}leftPanel`)
    const bSaved = sessionStorage.getItem(`${STORAGE_PREFIX}rightPanel`)
    expect(aSaved).not.toBeNull()
    expect(bSaved).not.toBeNull()
    // A's saved draft includes its in-progress child (URL would not).
    expect(JSON.parse(aSaved!).draft.children).toHaveLength(2)
    // B is single-finished-child only.
    expect(JSON.parse(bSaved!).draft.children).toHaveLength(1)

    // 4. Reactive surfaces — A has a dangling in-progress error, B is clean.
    expect(filterA.errors.value.length).toBeGreaterThan(0)
    expect(filterB.errors.value).toEqual([])

    // 5. Clear A — only A's URL + sessionStorage + state vanish; B untouched.
    filterA.actions.clear()
    await flushPromises()
    expect(router.currentRoute.value.query.leftPanel).toBeUndefined()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}leftPanel`)).toBeNull()
    expect(filterA.valid.value).toEqual({ combinator: 'and', children: [] })

    expect(typeof router.currentRoute.value.query.rightPanel).toBe('string')
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}rightPanel`)).not.toBeNull()
    expect(filterB.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'draft' }],
    })

    wrapper.unmount()
  })
})
