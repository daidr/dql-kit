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

  it('renders no value control for none-shape ops (isEmpty)', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'isEmpty', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    expect(wrapper.findAll('input.dql-input--string')).toHaveLength(0)
    expect(wrapper.find('[data-testid="token-list"]').exists()).toBe(false)
  })

  it('renders the token-list renderer for list-shape ops on string fields', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'in', value: ['a', 'b'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    expect(wrapper.find('[data-testid="token-list"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="token"]')).toHaveLength(2)
    expect(wrapper.findAll('input.dql-input--string')).toHaveLength(0)
  })

  it('typing + Enter in the token input commits a new token through the composable', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'in', value: ['a'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    await input.setValue('b')
    await input.trigger('keydown', { key: 'Enter' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'in',
      value: ['a', 'b'],
    })
  })

  it('comma key also commits a token', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'in', value: [] as string[] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    await input.setValue('foo')
    await input.trigger('keydown', { key: ',' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'in',
      value: ['foo'],
    })
  })

  it('clicking × on a token removes it', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'in', value: ['a', 'b', 'c'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const removes = wrapper.findAll('[data-testid="token-remove"]')
    expect(removes).toHaveLength(3)
    await removes[1]!.trigger('click')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'in',
      value: ['a', 'c'],
    })
  })

  it('Backspace on empty token input pops the last token', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'in', value: ['a', 'b'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    await input.trigger('keydown', { key: 'Backspace' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'in',
      value: ['a'],
    })
  })

  it('whitespace-only input does not produce a token on Enter', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'in', value: ['a'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'title',
      op: 'in',
      value: ['a'],
    })
  })
})
