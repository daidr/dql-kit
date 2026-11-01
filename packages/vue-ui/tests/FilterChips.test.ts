import { defineFilterSchema, f } from '@dql-kit/core'
import { useFilter } from '@dql-kit/vue-headless'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import { FilterChips } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    status: f.enum(['draft', 'published'] as const, {
      label: 'Status',
      valueLabels: { draft: 'Draft', published: 'Published' },
    }),
    rating: f.number({ label: 'Rating' }),
  },
})

const initial = {
  combinator: 'and' as const,
  children: [
    { field: 'title', op: 'contains', value: 'vue' },
    {
      combinator: 'or' as const,
      children: [
        { field: 'status', op: 'eq', value: 'draft' },
        { field: 'rating', op: 'gt', value: 3 },
      ],
    },
    { field: 'status', op: 'in', value: ['published'] },
  ],
}

describe('FilterChips', () => {
  it('shows one chip per root condition and one per nested group', () => {
    const filter = useFilter({ schema, sync: 'none', initial })
    const wrapper = mount(FilterChips, { props: { filter } })
    expect(wrapper.findAll('[data-testid="filter-chip"]').map((c) => c.text().replace('×', ''))).toEqual([
      'Title contains vue',
      'Status eq Draft OR Rating gt 3',
      'Status in Published',
    ])
    expect(wrapper.findAll('.dql-chip--group')).toHaveLength(1)
    expect(wrapper.findAll('.dql-chip-separator').map((s) => s.text())).toEqual(['AND', 'AND'])
    wrapper.unmount()
  })

  it('removing a chip commits the filter without it', async () => {
    const filter = useFilter({ schema, sync: 'none', commitMode: 'manual', initial })
    const wrapper = mount(FilterChips, { props: { filter } })
    await wrapper.findAll('[data-testid="filter-chip-remove"]')[1]!.trigger('click')
    expect(filter.committedValid.value.children.map((c) => ('field' in c ? c.field : 'group'))).toEqual(['title', 'status'])
    expect(filter.isDirty.value).toBe(false)
    await nextTick()
    expect(wrapper.findAll('[data-testid="filter-chip"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('the chip slot replaces chip content', () => {
    const filter = useFilter({ schema, sync: 'none', initial })
    const wrapper = mount(FilterChips, {
      props: { filter },
      slots: { chip: ({ node }: { node: { field?: string, kind: string } }) => h('b', node.kind) },
    })
    expect(wrapper.findAll('[data-testid="filter-chip"] b').map((b) => b.text())).toEqual(['condition', 'group', 'condition'])
    wrapper.unmount()
  })

  it('renders an empty container for an empty filter', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterChips, { props: { filter } })
    expect(wrapper.find('[data-testid="filter-chips"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="filter-chip"]')).toHaveLength(0)
    wrapper.unmount()
  })
})
