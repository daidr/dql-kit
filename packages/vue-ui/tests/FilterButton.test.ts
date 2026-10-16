import { defineFilterSchema, f } from '@dql-kit/core'
import { useFilter } from '@dql-kit/vue-headless'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { FilterButton } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number({ label: 'Rating' }),
  },
})

describe('FilterButton — default render', () => {
  it('renders a default button with the count for an empty filter', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterButton, { props: { filter } })
    const btn = wrapper.find('[data-testid="filter-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('type')).toBe('button')
    expect(btn.text()).toBe('Filter')
    expect(btn.attributes('data-condition-count')).toBe('0')
    expect(btn.attributes('data-has-notices')).toBe('false')
    expect(btn.classes()).toContain('dql-filter-button')
    expect(btn.classes()).not.toContain('dql-filter-button--active')
    expect(btn.classes()).not.toContain('dql-filter-button--has-notices')
    // No notice indicator when filter is clean.
    expect(wrapper.find('[data-testid="filter-button-notice"]').exists()).toBe(false)
  })

  it('label, count, and active modifier track filter.valid', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'a' },
          { field: 'title', op: 'eq', value: 'b' },
          { field: 'title', op: 'eq', value: 'c' },
        ],
      },
    })
    const wrapper = mount(FilterButton, { props: { filter } })
    const btn = wrapper.find('[data-testid="filter-button"]')
    expect(btn.text()).toContain('Filter')
    expect(btn.text()).toContain('3')
    expect(btn.attributes('data-condition-count')).toBe('3')
    expect(btn.classes()).toContain('dql-filter-button--active')
  })

  it('exposes a warning indicator when there are validation errors', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          // Missing op → analyse produces an `incomplete` error.
          { field: 'title', op: null },
        ],
      },
    })
    const wrapper = mount(FilterButton, { props: { filter } })
    const btn = wrapper.find('[data-testid="filter-button"]')
    expect(btn.attributes('data-has-notices')).toBe('true')
    expect(btn.classes()).toContain('dql-filter-button--has-notices')
    expect(wrapper.find('[data-testid="filter-button-notice"]').exists()).toBe(true)
  })

  it('exposes a warning indicator when dropped[] is non-empty', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.dropped.value = [
      { path: [0], code: 'unknown_field', field: 'mystery' },
    ]
    const wrapper = mount(FilterButton, { props: { filter } })
    expect(
      wrapper.find('[data-testid="filter-button"]').attributes('data-has-notices'),
    ).toBe('true')
    expect(wrapper.find('[data-testid="filter-button-notice"]').exists()).toBe(true)
  })

  it('forwards click listeners to the default button', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    let clicks = 0
    const wrapper = mount(FilterButton, {
      props: { filter },
      attrs: { onClick: () => { clicks++ } },
    })
    await wrapper.find('[data-testid="filter-button"]').trigger('click')
    expect(clicks).toBe(1)
  })
})

describe('FilterButton — slot', () => {
  it('replaces the button entirely when a default slot is provided', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'x' }],
      },
    })
    const wrapper = mount(FilterButton, {
      props: { filter },
      slots: {
        default: (scope: {
          count: number
          hasNotices: boolean
          errors: unknown[]
          dropped: unknown[]
        }) =>
          h(
            'div',
            {
              'data-testid': 'custom-slot',
              'data-count': String(scope.count),
              'data-has-notices': String(scope.hasNotices),
              'data-error-count': String(scope.errors.length),
              'data-dropped-count': String(scope.dropped.length),
            },
            `count=${scope.count}`,
          ),
      },
    })
    expect(wrapper.find('[data-testid="filter-button"]').exists()).toBe(false)
    const slot = wrapper.find('[data-testid="custom-slot"]')
    expect(slot.exists()).toBe(true)
    expect(slot.attributes('data-count')).toBe('1')
    expect(slot.attributes('data-has-notices')).toBe('false')
    expect(slot.attributes('data-error-count')).toBe('0')
    expect(slot.attributes('data-dropped-count')).toBe('0')
    expect(slot.text()).toBe('count=1')
  })

  it('slot scope updates reactively as the filter changes', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterButton, {
      props: { filter },
      slots: {
        default: (scope: { count: number, hasNotices: boolean }) =>
          h('span', { 'data-testid': 'slot' }, `${scope.count}|${scope.hasNotices}`),
      },
    })
    expect(wrapper.find('[data-testid="slot"]').text()).toBe('0|false')

    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="slot"]').text()).toBe('1|false')

    filter.dropped.value = [{ path: [0], code: 'unknown_field', field: 'mystery' }]
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="slot"]').text()).toBe('1|true')
  })
})
