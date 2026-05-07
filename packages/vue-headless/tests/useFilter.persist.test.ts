import { defineFilterSchema, f, toUrl, type DraftAST, type ValidAST } from '@dql-kit/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  createMemoryUrlAdapter,
  useFilter,
  type UrlAdapter,
  type UseFilterOptions,
  type UseFilterReturn,
} from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number(),
  },
})

type Filter = UseFilterReturn<typeof schema>

const STORAGE_PREFIX = 'dql-kit:draft:'

type HarnessOptions = Omit<UseFilterOptions<typeof schema>, 'schema' | 'sync'> & {
  /** Initial URL adapter content (analogous to a route query). */
  initialUrl?: string
  /**
   * `'memory'` → `createMemoryUrlAdapter()`; `'none'` (default) skips
   * URL sync. The persist-mode tests don't need the vue-router
   * adapter — that lives in `@dql-kit/vue-router-sync`.
   */
  sync?: 'memory' | 'none'
}

const buildHarness = async (
  options: HarnessOptions = {},
): Promise<{
  adapter: UrlAdapter | null
  filter: Filter
  wrapper: VueWrapper
}> => {
  const adapter: UrlAdapter | null =
    options.sync === 'memory' ? createMemoryUrlAdapter(options.initialUrl ?? '') : null

  let filter!: Filter
  const Harness = defineComponent({
    setup() {
      filter = useFilter({
        schema,
        sync: adapter ?? 'none',
        queryKey: options.queryKey,
        initial: options.initial,
        persistDraft: options.persistDraft,
      }) as Filter
      return () => h('div')
    },
  })

  const wrapper = mount(Harness)

  return { adapter, filter, wrapper }
}

describe('useFilter — persistDraft default (\'none\')', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('does NOT touch sessionStorage on mutation when persistDraft is omitted', async () => {
    const { filter, wrapper } = await buildHarness({ sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    await flushPromises()
    expect(sessionStorage.length).toBe(0)
    wrapper.unmount()
  })

  it('does NOT touch sessionStorage on mutation when persistDraft is explicitly \'none\'', async () => {
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'none',
    })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    await flushPromises()
    expect(sessionStorage.length).toBe(0)
    wrapper.unmount()
  })

  it('does NOT read from sessionStorage on mount when persistDraft is omitted', async () => {
    // Plant a draft; the omitted-flag instance should ignore it.
    sessionStorage.setItem(
      `${STORAGE_PREFIX}filter`,
      JSON.stringify({
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'restored' }],
      }),
    )
    const { filter, wrapper } = await buildHarness({ sync: 'none' })
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
    wrapper.unmount()
  })
})

describe('useFilter — persistDraft: \'session\' write-through', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('mirrors a finished condition into sessionStorage on action', async () => {
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
    })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    await flushPromises()
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}filter`)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a' }],
    })
    wrapper.unmount()
  })

  it('mirrors INCOMPLETE in-progress nodes (the key persistDraft promise)', async () => {
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
    })
    // No field/op/value — purely in-progress.
    filter.actions.addCondition([])
    await flushPromises()
    // Valid drops the incomplete node.
    expect(filter.valid.value.children).toHaveLength(0)
    // But the saved DRAFT keeps it.
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}filter`)
    const parsed = JSON.parse(raw!) as DraftAST
    expect(parsed.children).toHaveLength(1)
    expect(parsed.children[0]).toMatchObject({ field: null, op: null })
    wrapper.unmount()
  })

  it('clear() removes the storage entry (so empty AST does not linger)', async () => {
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
    })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    await flushPromises()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}filter`)).not.toBeNull()
    filter.actions.clear()
    await flushPromises()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}filter`)).toBeNull()
    wrapper.unmount()
  })

  it('uses the queryKey as part of the storage key (custom queryKey)', async () => {
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      queryKey: 'leftPanel',
      persistDraft: 'session',
    })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'x' })
    await flushPromises()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}leftPanel`)).not.toBeNull()
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}filter`)).toBeNull()
    wrapper.unmount()
  })
})

describe('useFilter — persistDraft: \'session\' restore-on-mount', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('restores a saved draft on mount (no URL involved)', async () => {
    const saved: DraftAST = {
      combinator: 'or',
      children: [
        { field: 'title', op: 'eq', value: 'restored' },
        { field: null, op: null }, // in-progress
      ],
    }
    sessionStorage.setItem(`${STORAGE_PREFIX}filter`, JSON.stringify(saved))

    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
    })

    // Draft restored verbatim — including the incomplete child.
    expect(filter.draft.value).toEqual(saved)
    // Valid view drops the incomplete child but keeps the finished one.
    expect(filter.valid.value).toEqual({
      combinator: 'or',
      children: [{ field: 'title', op: 'eq', value: 'restored' }],
    })
    wrapper.unmount()
  })

  it('saved draft wins over URL on mount (documented merge rule)', async () => {
    // The previous session ended with a saved draft. On reload, even if a
    // URL is present, the saved draft is loaded — it includes both finished
    // nodes (which would also be in the URL) and any in-progress ones.
    const saved: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'kept-from-draft' },
        { field: 'rating', op: null }, // in-progress; not in URL valid
      ],
    }
    sessionStorage.setItem(`${STORAGE_PREFIX}filter`, JSON.stringify(saved))

    // URL encodes a different valid AST (simulating an external bookmark).
    const urlAst: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'from-url' }],
    }

    const { filter, wrapper } = await buildHarness({
      sync: 'memory',
      initialUrl: toUrl(urlAst),
      persistDraft: 'session',
    })

    expect(filter.draft.value).toEqual(saved)
    // Valid reflects the saved draft (with incomplete dropped), NOT the URL.
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'kept-from-draft' }],
    })
    wrapper.unmount()
  })

  it('falls back to URL when no saved draft exists', async () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'from-url' }],
    }
    const { filter, wrapper } = await buildHarness({
      sync: 'memory',
      initialUrl: toUrl(ast),
      persistDraft: 'session',
    })
    expect(filter.valid.value).toEqual(ast)
    wrapper.unmount()
  })

  it('falls back to opts.initial when no saved draft and no URL', async () => {
    const initial: ValidAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'eq', value: 5 }],
    }
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
      initial,
    })
    expect(filter.valid.value).toEqual(initial)
    wrapper.unmount()
  })

  it('ignores corrupt sessionStorage payload and falls back', async () => {
    sessionStorage.setItem(`${STORAGE_PREFIX}filter`, 'this-is-not-json{{')
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
    })
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
    wrapper.unmount()
  })

  it('ignores structurally-invalid payload (wrong combinator) and falls back', async () => {
    sessionStorage.setItem(
      `${STORAGE_PREFIX}filter`,
      JSON.stringify({ combinator: 'xor', children: [] }),
    )
    const { filter, wrapper } = await buildHarness({
      sync: 'none',
      persistDraft: 'session',
    })
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
    wrapper.unmount()
  })

  it('full reload simulation: edit → save → unmount → re-mount restores draft', async () => {
    const first = await buildHarness({ sync: 'none', persistDraft: 'session' })
    first.filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'edit-1' })
    first.filter.actions.addCondition([]) // in-progress
    await flushPromises()
    first.wrapper.unmount()
    // Storage survives unmount.
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}filter`)).not.toBeNull()

    const second = await buildHarness({ sync: 'none', persistDraft: 'session' })
    expect(second.filter.draft.value.children).toHaveLength(2)
    expect(second.filter.draft.value.children[0]).toMatchObject({
      field: 'title',
      op: 'eq',
      value: 'edit-1',
    })
    expect(second.filter.draft.value.children[1]).toMatchObject({
      field: null,
      op: null,
    })
    second.wrapper.unmount()
  })
})
