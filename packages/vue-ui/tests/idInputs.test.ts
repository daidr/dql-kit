import { DEFAULT_AST_LIMITS, defineFilterSchema, f, type Item, type SearchPage } from '@dql-kit/core'
import { createDqlKit, useFilter } from '@dql-kit/vue-headless'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { FilterPanel } from '../src/index.ts'

const schema = defineFilterSchema({ fields: { authorId: f.id<number>() } })
const people = Array.from({ length: 5 }, (_, i): Item<number> => ({ id: i + 1, label: `Person ${i + 1}` }))
const resolve = vi.fn(async (ids: number[]) => people.filter((p) => ids.some((id) => String(id) === String(p.id))))

const mountWith = (
  op: 'eq' | 'in',
  value: unknown,
  fetcher: Record<string, unknown> = { search: async () => people.slice(0, 2), resolve },
  plugin?: ReturnType<typeof createDqlKit>,
) => {
  const filter = useFilter({
    schema,
    sync: 'none',
    debounceMs: 0,
    fetchers: { authorId: fetcher as never },
    initial: { combinator: 'and', children: [{ field: 'authorId', op, value } as never] },
  })
  const wrapper = mount(FilterPanel, { props: { filter }, global: { plugins: plugin ? [plugin] : [] } })
  return { filter, wrapper }
}

const paste = async (el: ReturnType<ReturnType<typeof mount>['find']>, text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  event.clipboardData = { getData: () => text }
  el.element.dispatchEvent(event)
  await flushPromises()
  return event
}

describe('id inputs — recently picked ids', () => {
  it('a pick is remembered and offered, with a heading, when the query is empty', async () => {
    const { filter, wrapper } = mountWith('eq', undefined)
    const input = wrapper.find('[data-testid="id-search-input"]')
    await input.trigger('focus')
    await input.setValue('p')
    await flushPromises()
    await wrapper.find('[data-testid="id-result-2"]').trigger('mousedown')
    expect(filter.recentIds('authorId')).toEqual([2])

    await wrapper.find('[data-testid="id-clear"]').trigger('click')
    await wrapper.find('[data-testid="id-search-input"]').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.dql-id-results-heading').text()).toBe('Recent')
    expect(wrapper.find('[data-testid="id-recent-2"]').text()).toBe('Person 2')
    await wrapper.find('[data-testid="id-recent-2"]').trigger('mousedown')
    expect(filter.valid.value.children[0]).toMatchObject({ value: 2 })
  })

  it('the multi input leaves already-selected ids out of the recent list', async () => {
    const { filter, wrapper } = mountWith('in', [1])
    filter.rememberIds('authorId', [1, 3])
    const input = wrapper.find('[data-testid="id-search-input"]')
    await input.trigger('focus')
    await flushPromises()
    expect(wrapper.find('[data-testid="id-recent-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="id-recent-3"]').exists()).toBe(true)
  })

  it('the heading text comes from the plugin', async () => {
    const plugin = createDqlKit({ idInputLabels: { recent: '最近使用' } })
    const { filter, wrapper } = mountWith('eq', undefined, undefined, plugin)
    filter.rememberIds('authorId', [1])
    await wrapper.find('[data-testid="id-search-input"]').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.dql-id-results-heading').text()).toBe('最近使用')
  })
})

describe('id inputs — paged results', () => {
  it('shows a load-more row while there are more pages', async () => {
    const searchPage = vi.fn(async (_q: string, cursor: unknown): Promise<SearchPage<number>> =>
      cursor === undefined ? { items: people.slice(0, 2), nextCursor: 2 } : { items: people.slice(2) })
    const { wrapper } = mountWith('eq', undefined, { searchPage, resolve })
    const input = wrapper.find('[data-testid="id-search-input"]')
    await input.trigger('focus')
    await input.setValue('p')
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="id-result-"]')).toHaveLength(2)
    await wrapper.find('[data-testid="id-load-more"]').trigger('mousedown')
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="id-result-"]')).toHaveLength(5)
    expect(wrapper.find('[data-testid="id-load-more"]').exists()).toBe(false)
  })
})

describe('id inputs — bulk paste', () => {
  it('adds the ids that resolve, lists the rest, and remembers the added ones', async () => {
    resolve.mockClear()
    const { filter, wrapper } = mountWith('in', [1])
    const event = await paste(wrapper.find('[data-testid="id-search-input"]'), '2, 3\n99;1')
    expect(event.defaultPrevented).toBe(true)
    expect(resolve).toHaveBeenCalledWith(['2', '3', '99', '1'], expect.any(AbortSignal))
    expect(filter.valid.value.children[0]).toMatchObject({ value: [1, 2, 3] })
    expect(wrapper.find('[data-testid="id-not-found"]').text()).toBe('Not found: 99')
    expect(wrapper.find('[data-testid="id-chip-2"]').text()).toContain('Person 2')
    expect(filter.recentIds('authorId')).toEqual([3, 2])
  })

  it('a single pasted word goes to the search box', async () => {
    resolve.mockClear()
    const { wrapper } = mountWith('in', [])
    const event = await paste(wrapper.find('[data-testid="id-search-input"]'), 'alice')
    expect(event.defaultPrevented).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('stops at the list limit and says so', async () => {
    const many = Array.from({ length: DEFAULT_AST_LIMITS.maxListLength + 5 }, (_, i) => i + 1)
    const all = vi.fn(async (ids: (string | number)[]) => ids.map((id) => ({ id: Number(id), label: `#${id}` })))
    const { filter, wrapper } = mountWith('in', [], { search: async () => [], resolve: all })
    await paste(wrapper.find('[data-testid="id-search-input"]'), many.join(','))
    expect((filter.valid.value.children[0] as { value: number[] }).value).toHaveLength(DEFAULT_AST_LIMITS.maxListLength)
    expect(wrapper.find('[data-testid="id-truncated"]').exists()).toBe(true)
  })

  it('a failing lookup lists every pasted id as not found', async () => {
    const { filter, wrapper } = mountWith('in', [], {
      search: async () => [],
      resolve: async () => {
        throw new Error('down')
      },
    })
    await paste(wrapper.find('[data-testid="id-search-input"]'), '1 2')
    expect(filter.draft.value.children[0]).toMatchObject({ value: [] })
    expect(wrapper.find('[data-testid="id-not-found"]').text()).toBe('Not found: 1, 2')
  })
})
