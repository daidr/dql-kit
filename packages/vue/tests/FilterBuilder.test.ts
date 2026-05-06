import { defineFilterSchema, f } from '@dql-kit/core'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { FilterBuilder, useFilter } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
  },
})

describe('FilterBuilder — vertical-stack variant', () => {
  it('mounts under the default variant without errors', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    expect(wrapper.find('[data-testid="filter-builder"]').classes()).toContain(
      'dql-variant-vertical-stack',
    )
    expect(wrapper.find('[data-testid="add-condition"]').exists()).toBe(true)
  })

  it('clicking +Condition adds a row through the composable', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    await wrapper.find('[data-testid="add-condition"]').trigger('click')
    expect(filter.draft.value.children).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="condition"]')).toHaveLength(1)
  })

  it('renders a string text input for a string-eq condition and emits updates', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: '' }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const inputs = wrapper.findAll('input.dql-input--string')
    expect(inputs).toHaveLength(1)
    await inputs[0]!.setValue('hello')
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    })
  })

  it('clicking remove removes the condition through the composable', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'a' }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    await wrapper.find('[data-testid="remove-condition"]').trigger('click')
    expect(filter.draft.value.children).toHaveLength(0)
  })
})
