import { defineFilterSchema, f, toUrl, type ValidAST } from '@dql-kit/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  type Router,
} from 'vue-router'
import { useFilter, type UseFilterOptions, type UseFilterReturn } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
  },
})

type Filter = UseFilterReturn<typeof schema>

const buildHarness = async (
  options: Omit<UseFilterOptions<typeof schema>, 'schema'> & {
    initialPath?: string
  } = {},
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
      filter = useFilter({
        schema,
        sync: options.sync,
        queryKey: options.queryKey,
        initial: options.initial,
      }) as Filter
      return () => h('div')
    },
  })

  const wrapper = mount(Harness, { global: { plugins: [router] } })

  return { router, filter, wrapper, replaceCalls, pushCalls }
}

describe('useFilter — sync: \'url\' (vue-router integration)', () => {
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

describe('useFilter — sync: \'none\' (router-free)', () => {
  it('does not require a router context', () => {
    let filter!: Filter
    const Harness = defineComponent({
      setup() {
        filter = useFilter({ schema, sync: 'none' }) as Filter
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

describe('useFilter — sync: \'url\' without router context', () => {
  it('throws a clear error', () => {
    const Harness = defineComponent({
      setup() {
        useFilter({ schema, sync: 'url' })
        return () => h('div')
      },
    })
    expect(() => mount(Harness)).toThrow(/vue-router context/)
  })
})

// Slice 11: schema-evolution dropped[] surface. The harness above uses a
// schema with only `title`, so a URL referencing other field/op/type
// combos lands in dropped[].
describe('useFilter — dropped[] schema evolution', () => {
  it('initial state has dropped: [] when the URL is clean', async () => {
    const { filter, wrapper } = await buildHarness({ sync: 'url' })
    expect(filter.dropped.value).toEqual([])
    wrapper.unmount()
  })

  it('initial state populates dropped[] when URL references an unknown field', async () => {
    // Construct a URL by hand — `mystery` is not in the schema.
    const compact = { c: 'and', n: [{ f: 'mystery', o: 'eq', v: 'x' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const { filter, wrapper } = await buildHarness({
      sync: 'url',
      initialPath: `/?filter=${url}`,
    })
    expect(filter.dropped.value).toHaveLength(1)
    expect(filter.dropped.value[0]).toMatchObject({
      reason: 'unknown_field',
      detail: { field: 'mystery' },
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
    expect(filter.dropped.value[0]?.reason).toBe('unknown_field')
    wrapper.unmount()
  })
})
