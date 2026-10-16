import { defineFilterSchema, f, toUrl, type ValidAST } from '@dql-kit/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  type Router,
} from 'vue-router'
import {
  useFilter,
  type UseFilterOptions,
  type UseFilterReturn,
} from '@dql-kit/vue-headless'
import { vueRouterUrlAdapter } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
  },
})

type Filter = UseFilterReturn<typeof schema>

type HarnessOptions = Omit<UseFilterOptions<typeof schema>, 'schema' | 'sync'> & {
  initialPath?: string
  /**
   * `'url'` wires the canonical vue-router adapter; `'none'` (default)
   * skips URL sync. Tests that previously passed `sync: 'url'` should
   * keep passing it as a string here — the harness translates.
   */
  sync?: 'url' | 'none'
}

const buildHarness = async (
  options: HarnessOptions = {},
): Promise<{
  router: Router
  filter: Filter
  wrapper: VueWrapper
  replaceCalls: { query?: Record<string, unknown> }[]
  pushCalls: { query?: Record<string, unknown> }[]
}> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })

  const replaceCalls: { query?: Record<string, unknown> }[] = []
  const pushCalls: { query?: Record<string, unknown> }[] = []
  const originalReplace = router.replace.bind(router)
  const originalPush = router.push.bind(router)
  router.replace = ((to: unknown) => {
    if (typeof to === 'object' && to !== null) {
      replaceCalls.push(to as { query?: Record<string, unknown> })
    }
    return originalReplace(to as Parameters<typeof originalReplace>[0])
  }) as typeof router.replace
  router.push = ((to: unknown) => {
    if (typeof to === 'object' && to !== null) {
      pushCalls.push(to as { query?: Record<string, unknown> })
    }
    return originalPush(to as Parameters<typeof originalPush>[0])
  }) as typeof router.push

  await router.push(options.initialPath ?? '/')
  await router.isReady()

  let filter!: Filter
  const Harness = defineComponent({
    setup() {
      const sync =
        options.sync === 'url'
          ? vueRouterUrlAdapter({ queryKey: options.queryKey })
          : 'none'
      filter = useFilter({
        schema,
        sync,
        commitMode: options.commitMode,
        queryKey: options.queryKey,
        initial: options.initial,
      }) as Filter
      return () => h('div')
    },
  })

  const wrapper = mount(Harness, { global: { plugins: [router] } })

  return { router, filter, wrapper, replaceCalls, pushCalls }
}

describe('useFilter — sync via vueRouterUrlAdapter', () => {
  it('reads initial state from route.query[queryKey] on mount', async () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    }
    const encoded = toUrl(ast)
    const { filter, wrapper } = await buildHarness({
      sync: 'url',
      queryKey: 'filter',
      initialPath: `/?filter=${encoded}`,
    })
    expect(filter.valid.value).toEqual(ast)
    wrapper.unmount()
  })

  it('writes to route.query via router.replace (not push) on action', async () => {
    const { filter, router, wrapper, replaceCalls, pushCalls } =
      await buildHarness({ sync: 'url' })

    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    await flushPromises()

    expect(pushCalls).toHaveLength(0)
    expect(replaceCalls.length).toBeGreaterThan(0)
    expect(typeof router.currentRoute.value.query.filter).toBe('string')
    expect(router.currentRoute.value.query.filter).toBe(toUrl(filter.valid.value))
    wrapper.unmount()
  })

  it('encodes the filter exactly once in the address bar', async () => {
    const { filter, router, wrapper } = await buildHarness({ sync: 'url' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: '50% off' })
    await flushPromises()
    const fullPath = router.currentRoute.value.fullPath
    // One decode of the query string gives back toUrl's output verbatim.
    expect(new URLSearchParams(fullPath.slice(fullPath.indexOf('?'))).get('filter'))
      .toBe(toUrl(filter.valid.value))
    expect(fullPath).not.toContain('%2522')
    wrapper.unmount()
  })

  it('still opens links written by the old double-encoding toUrl', async () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'legacy' }],
    }
    // Old toUrl percent-encoded, then the router encoded again.
    const legacy = encodeURIComponent(encodeURIComponent(toUrl(ast)))
    const { filter, wrapper } = await buildHarness({
      sync: 'url',
      initialPath: `/?filter=${legacy}`,
    })
    expect(filter.valid.value).toEqual(ast)
    expect(filter.dropped.value).toEqual([])
    wrapper.unmount()
  })

  it('an unsupported envelope version is reported instead of crashing setup', async () => {
    const { filter, wrapper } = await buildHarness({
      sync: 'url',
      initialPath: `/?filter=${encodeURIComponent('{"v":1}')}`,
    })
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
    expect(filter.dropped.value).toEqual([{ path: [], code: 'unsupported_version', version: 1 }])
    wrapper.unmount()
  })

  it('empty Valid AST removes the query key (writes undefined)', async () => {
    const { filter, router, wrapper } = await buildHarness({
      sync: 'url',
      initialPath: `/?filter=${toUrl({
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'a' }],
      })}`,
    })
    filter.actions.clear()
    await flushPromises()
    expect(router.currentRoute.value.query.filter).toBeUndefined()
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
    wrapper.unmount()
  })

  it('external router.push updates draft and valid', async () => {
    const { filter, router, wrapper } = await buildHarness({ sync: 'url' })

    const incoming: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'incoming' }],
    }
    await router.push({ query: { filter: toUrl(incoming) } })
    await flushPromises()

    expect(filter.valid.value).toEqual(incoming)
    wrapper.unmount()
  })

  it('drafts (incomplete conditions) are never written to URL', async () => {
    const { filter, router, wrapper, replaceCalls } = await buildHarness({
      sync: 'url',
    })
    filter.actions.addCondition([])
    await flushPromises()

    expect(filter.valid.value.children).toHaveLength(0)
    expect(router.currentRoute.value.query.filter).toBeUndefined()
    expect(replaceCalls).toHaveLength(0)
    wrapper.unmount()
  })

  it('respects a custom queryKey and ignores the default', async () => {
    const { filter, router, wrapper } = await buildHarness({
      sync: 'url',
      queryKey: 'q',
    })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'x' })
    await flushPromises()
    expect(typeof router.currentRoute.value.query.q).toBe('string')
    expect(router.currentRoute.value.query.filter).toBeUndefined()
    wrapper.unmount()
  })
})

describe('useFilter — default sync (router-free)', () => {
  it('does not require a router context', () => {
    let filter!: Filter
    const Harness = defineComponent({
      setup() {
        // sync defaults to 'none' — no router, no adapter, no calls.
        filter = useFilter({ schema }) as Filter
        return () => h('div')
      },
    })
    expect(() => mount(Harness)).not.toThrow()
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })

  it('does not write to route.query even if a router is installed', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }],
    })
    await router.push('/')
    await router.isReady()

    let filter!: Filter
    const Harness = defineComponent({
      setup() {
        filter = useFilter({ schema, sync: 'none' }) as Filter
        return () => h('div')
      },
    })
    const wrapper = mount(Harness, { global: { plugins: [router] } })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    await flushPromises()
    expect(router.currentRoute.value.query.filter).toBeUndefined()
    wrapper.unmount()
  })
})

describe('vueRouterUrlAdapter — without router context', () => {
  it('throws a clear error', () => {
    const Harness = defineComponent({
      setup() {
        // No app.use(router) — adapter creation should throw.
        useFilter({ schema, sync: vueRouterUrlAdapter() })
        return () => h('div')
      },
    })
    expect(() => mount(Harness)).toThrow(/vue-router context/)
  })
})

// Slice 11: schema-evolution dropped[] surface.
describe('useFilter — dropped[] schema evolution', () => {
  it('initial state has dropped: [] when the URL is clean', async () => {
    const { filter, wrapper } = await buildHarness({ sync: 'url' })
    expect(filter.dropped.value).toEqual([])
    wrapper.unmount()
  })

  it('initial state populates dropped[] when URL references an unknown field', async () => {
    const compact = { c: 'and', n: [{ f: 'mystery', o: 'eq', v: 'x' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const { filter, wrapper } = await buildHarness({
      sync: 'url',
      initialPath: `/?filter=${url}`,
    })
    expect(filter.dropped.value).toHaveLength(1)
    expect(filter.dropped.value[0]).toMatchObject({
      code: 'unknown_field',
      field: 'mystery',
    })
    expect(filter.valid.value.children).toHaveLength(0)
    wrapper.unmount()
  })

  it('dismissDropped() clears the array reactively', async () => {
    const compact = { c: 'and', n: [{ f: 'mystery', o: 'eq', v: 'x' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const { filter, wrapper } = await buildHarness({
      sync: 'url',
      initialPath: `/?filter=${url}`,
    })
    expect(filter.dropped.value.length).toBeGreaterThan(0)
    filter.dismissDropped()
    expect(filter.dropped.value).toEqual([])
    wrapper.unmount()
  })

  it('navigation to a stale URL repopulates dropped[]', async () => {
    const { filter, router, wrapper } = await buildHarness({ sync: 'url' })
    expect(filter.dropped.value).toEqual([])
    const compact = { c: 'and', n: [{ f: 'mystery', o: 'eq', v: 'x' }] }
    const stale = encodeURIComponent(JSON.stringify(compact))
    await router.push({ query: { filter: stale } })
    await flushPromises()
    expect(filter.dropped.value).toHaveLength(1)
    expect(filter.dropped.value[0]?.code).toBe('unknown_field')
    wrapper.unmount()
  })
})

describe("useFilter — vueRouterUrlAdapter + commitMode: 'manual'", () => {
  it('actions in manual mode do NOT write to URL until commit() is called', async () => {
    const { filter, router, wrapper, replaceCalls } = await buildHarness({
      sync: 'url',
      commitMode: 'manual',
    })

    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'pending' })
    await flushPromises()

    expect(replaceCalls).toHaveLength(0)
    expect(router.currentRoute.value.query.filter).toBeUndefined()
    expect(filter.isDirty.value).toBe(true)

    filter.commit()
    await flushPromises()

    expect(replaceCalls.length).toBeGreaterThan(0)
    expect(typeof router.currentRoute.value.query.filter).toBe('string')
    expect(filter.isDirty.value).toBe(false)
    wrapper.unmount()
  })

  it('discard() in manual mode rolls draft back without touching URL', async () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'committed' }],
    }
    const encoded = toUrl(ast)
    const { filter, router, wrapper, replaceCalls } = await buildHarness({
      sync: 'url',
      commitMode: 'manual',
      initialPath: `/?filter=${encoded}`,
    })
    expect(filter.committedValid.value).toEqual(ast)

    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'staged' })
    await flushPromises()
    expect(filter.isDirty.value).toBe(true)

    const writesBefore = replaceCalls.length
    filter.discard()
    await flushPromises()
    expect(filter.isDirty.value).toBe(false)
    expect(filter.draft.value.children).toEqual([
      { field: 'title', op: 'eq', value: 'committed' },
    ])
    expect(replaceCalls.length).toBe(writesBefore)
    expect(router.currentRoute.value.query.filter).toBe(encoded)
    wrapper.unmount()
  })

  it('external URL navigation overrides pending draft and resets committedValid', async () => {
    const { filter, router, wrapper } = await buildHarness({
      sync: 'url',
      commitMode: 'manual',
    })

    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'pending' })
    await flushPromises()
    expect(filter.isDirty.value).toBe(true)

    const newAst: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'external' }],
    }
    await router.push({ query: { filter: toUrl(newAst) } })
    await flushPromises()

    expect(filter.draft.value.children).toEqual(newAst.children)
    expect(filter.committedValid.value).toEqual(newAst)
    expect(filter.isDirty.value).toBe(false)
    wrapper.unmount()
  })
})
