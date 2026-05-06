import { defineFilterSchema, f } from '@dql-kit/core'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { FilterBuilder, useFilter } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number({ label: 'Rating' }),
    isActive: f.boolean({ label: 'Active' }),
    status: f.enum(['draft', 'published', 'archived'] as const, {
      label: 'Status',
      valueLabels: { draft: '草稿', published: '已发布', archived: '归档' },
    }),
    priority: f.enum([0, 1, 2] as const, { label: 'Priority' }),
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

describe('FilterBuilder — number renderers', () => {
  it('renders a NumberInput for number-eq and emits numeric updates', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('input.dql-input--number')
    expect(input.exists()).toBe(true)
    await input.setValue('42')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'rating',
      op: 'eq',
      value: 42,
    })
  })

  it('NumberInput emits undefined when cleared (drops condition from valid)', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'eq', value: 5 }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('input.dql-input--number')
    await input.setValue('')
    expect(filter.valid.value.children).toHaveLength(0)
  })

  it('renders NumberPairInput (two number boxes, not a single slider) for between', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'between', value: [1, 5] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pair-min"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pair-max"]').exists()).toBe(true)
    expect((wrapper.find('[data-testid="pair-min"]').element as HTMLInputElement).value).toBe('1')
    expect((wrapper.find('[data-testid="pair-max"]').element as HTMLInputElement).value).toBe('5')
  })

  it('NumberPairInput updates either side independently', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'between', value: [1, 5] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    await wrapper.find('[data-testid="pair-min"]').setValue('2')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'rating',
      op: 'between',
      value: [2, 5],
    })
    await wrapper.find('[data-testid="pair-max"]').setValue('9')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'rating',
      op: 'between',
      value: [2, 9],
    })
  })

  it('NumberPairInput drops from valid until both halves are populated', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'between', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    await wrapper.find('[data-testid="pair-min"]').setValue('3')
    // Only one half filled → value_type_mismatch (null in tuple) → pruned out.
    expect(filter.valid.value.children).toHaveLength(0)
    await wrapper.find('[data-testid="pair-max"]').setValue('7')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'rating',
      op: 'between',
      value: [3, 7],
    })
  })

  it('renders NumberTokenInput for number "in" with numeric chip values', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'in', value: [1, 2, 3] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const tokens = wrapper.findAll('[data-testid="token"]')
    expect(tokens).toHaveLength(3)
    expect(tokens.map((t) => t.find('.dql-token-text').text())).toEqual(['1', '2', '3'])
  })

  it('NumberTokenInput commits numeric tokens (not strings) on Enter', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'in', value: [1] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    await input.setValue('42')
    await input.trigger('keydown', { key: 'Enter' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'rating',
      op: 'in',
      value: [1, 42],
    })
    const value = (filter.valid.value.children[0] as { value: unknown[] }).value
    expect(value.every((v) => typeof v === 'number')).toBe(true)
  })

  it('NumberTokenInput rejects a non-numeric token (silent no-op)', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'in', value: [1] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    await input.setValue('not-a-number')
    await input.trigger('keydown', { key: 'Enter' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'rating',
      op: 'in',
      value: [1],
    })
  })
})

describe('FilterBuilder — boolean renderer', () => {
  it('renders a switch-role checkbox for boolean eq', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'isActive', op: 'eq', value: false }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const sw = wrapper.find('[data-testid="boolean-switch"]')
    expect(sw.exists()).toBe(true)
    expect(sw.attributes('role')).toBe('switch')
    expect((sw.element as HTMLInputElement).checked).toBe(false)
  })

  it('toggling the switch drives valid to true / false', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'isActive', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const sw = wrapper.find('[data-testid="boolean-switch"]')
    await sw.setValue(true)
    expect(filter.valid.value.children[0]).toEqual({
      field: 'isActive',
      op: 'eq',
      value: true,
    })
    await sw.setValue(false)
    expect(filter.valid.value.children[0]).toEqual({
      field: 'isActive',
      op: 'eq',
      value: false,
    })
  })
})

describe('FilterBuilder — enum renderers', () => {
  it('renders EnumSelect with one option per declared value plus a placeholder', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'status', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const select = wrapper.find('[data-testid="enum-select"]')
    expect(select.exists()).toBe(true)
    const options = wrapper.findAll('[data-testid="enum-select"] option')
    // 3 declared + 1 placeholder
    expect(options).toHaveLength(4)
  })

  it('respects valueLabels when rendering option text', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'status', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const draftOption = wrapper.find('[data-testid="enum-option-draft"]')
    expect(draftOption.exists()).toBe(true)
    expect(draftOption.text()).toBe('草稿')
    expect(wrapper.find('[data-testid="enum-option-published"]').text()).toBe('已发布')
    expect(wrapper.find('[data-testid="enum-option-archived"]').text()).toBe('归档')
  })

  it('selecting an option emits the raw discriminant (not the label)', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'status', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const select = wrapper.find('[data-testid="enum-select"]')
    await select.setValue('published')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'status',
      op: 'eq',
      value: 'published',
    })
  })

  it('numeric-enum select emits a number, not its string form', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'priority', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    const select = wrapper.find('[data-testid="enum-select"]')
    await select.setValue('1')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'priority',
      op: 'eq',
      value: 1,
    })
  })

  it('renders EnumMultiSelect for enum in with one checkbox per declared value', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'status', op: 'in', value: ['draft'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    expect(wrapper.find('[data-testid="enum-multi"]').exists()).toBe(true)
    const draftBox = wrapper.find('[data-testid="enum-multi-option-draft"] input')
    const publishedBox = wrapper.find('[data-testid="enum-multi-option-published"] input')
    expect((draftBox.element as HTMLInputElement).checked).toBe(true)
    expect((publishedBox.element as HTMLInputElement).checked).toBe(false)
  })

  it('toggling a multi-select option emits an updated discriminant array', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'status', op: 'in', value: ['draft'] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    await wrapper
      .find('[data-testid="enum-multi-option-published"] input')
      .setValue(true)
    expect(filter.valid.value.children[0]).toEqual({
      field: 'status',
      op: 'in',
      value: ['draft', 'published'],
    })
    await wrapper
      .find('[data-testid="enum-multi-option-draft"] input')
      .setValue(false)
    expect(filter.valid.value.children[0]).toEqual({
      field: 'status',
      op: 'in',
      value: ['published'],
    })
  })

  it('numeric-enum multi-select preserves numeric typing in the emitted array', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'priority', op: 'in', value: [] as number[] }],
      },
    })
    const wrapper = mount(FilterBuilder, { props: { filter } })
    await wrapper.find('[data-testid="enum-multi-option-2"] input').setValue(true)
    const cond = filter.valid.value.children[0] as { value: unknown[] }
    expect(cond.value).toEqual([2])
    expect(typeof cond.value[0]).toBe('number')
  })
})
