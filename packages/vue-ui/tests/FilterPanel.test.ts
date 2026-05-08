import { defineFilterSchema, f, type Item } from '@dql-kit/core'
import { createDqlKit, useFilter } from '@dql-kit/vue-headless'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { FilterPanel } from '../src/index.ts'

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
    publishedOn: f.date({ label: 'Published on' }),
    occurredAt: f.datetime({ label: 'Occurred at' }),
    tags: f.array(f.string()),
    scores: f.array(f.number()),
    statusList: f.array(f.enum(['draft', 'published'] as const, {
      valueLabels: { draft: '草稿', published: '已发布' },
    })),
  },
})

describe('FilterPanel — rendering', () => {
  it('mounts and exposes the add-condition affordance', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="filter-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-condition"]').exists()).toBe(true)
  })

  it('clicking +Condition adds a row through the composable', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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

describe('FilterPanel — number renderers', () => {
  it('renders a NumberInput for number-eq and emits numeric updates', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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

describe('FilterPanel — boolean renderer', () => {
  it('renders a switch-role checkbox for boolean eq', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'isActive', op: 'eq', value: false }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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

describe('FilterPanel — enum renderers', () => {
  it('renders EnumSelect with one option per declared value plus a placeholder', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'status', op: 'eq', value: undefined }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
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
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="enum-multi-option-2"] input').setValue(true)
    const cond = filter.valid.value.children[0] as { value: unknown[] }
    expect(cond.value).toEqual([2])
    expect(typeof cond.value[0]).toBe('number')
  })
})

describe('FilterPanel — date renderer', () => {
  it('renders <input type="date"> for date eq and emits ISO calendar strings', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'publishedOn', op: 'eq', value: '2026-05-01' }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const input = wrapper.find('[data-testid="date-input"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('type')).toBe('date')
    expect((input.element as HTMLInputElement).value).toBe('2026-05-01')
    await input.setValue('2026-06-15')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'publishedOn',
      op: 'eq',
      value: '2026-06-15',
    })
  })

  it('clearing the date input drops the condition from valid', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'publishedOn', op: 'eq', value: '2026-05-01' }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="date-input"]').setValue('')
    expect(filter.valid.value.children).toHaveLength(0)
  })

  it('date between renders two date inputs (not one range slider)', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'publishedOn', op: 'between', value: ['2026-05-01', '2026-05-31'] }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="date-pair-min"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="date-pair-max"]').exists()).toBe(true)
    await wrapper.find('[data-testid="date-pair-max"]').setValue('2026-06-30')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'publishedOn',
      op: 'between',
      value: ['2026-05-01', '2026-06-30'],
    })
  })
})

describe('FilterPanel — datetime renderer', () => {
  it('renders <input type="datetime-local"> for datetime before', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'before', value: '2026-05-01T10:30:00Z' }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const input = wrapper.find('[data-testid="datetime-input"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('type')).toBe('datetime-local')
  })

  it('typed local datetime emits an ISO-8601 instant that round-trips back to the same wall time', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'before', value: undefined }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const input = wrapper.find('[data-testid="datetime-input"]')
    const local = '2026-05-01T10:30'
    await input.setValue(local)
    const cond = filter.valid.value.children[0] as { value: string }
    // Emitted value must be a valid ISO-8601 instant ending in Z.
    expect(cond.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // Round-trip: feed the emitted instant back, the displayed local form
    // must equal what was typed.
    expect(new Date(cond.value).getTime()).toBe(new Date(local).getTime())
  })

  it('datetime between renders two datetime inputs', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          {
            field: 'occurredAt',
            op: 'between',
            value: ['2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'],
          },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="datetime-pair-min"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="datetime-pair-max"]').exists()).toBe(true)
  })
})

describe('FilterPanel — datetime inLast renderer', () => {
  it('renders amount + unit inputs (not a date picker) for inLast', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 7, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="datetime-input"]').exists()).toBe(false)
    const amount = wrapper.find('[data-testid="inlast-amount"]')
    const unit = wrapper.find('[data-testid="inlast-unit"]')
    expect(amount.exists()).toBe(true)
    expect(unit.exists()).toBe(true)
    expect(amount.attributes('type')).toBe('number')
    expect((amount.element as HTMLInputElement).value).toBe('7')
    expect((unit.element as HTMLSelectElement).value).toBe('day')
  })

  it('all five documented relative units are options in the unit select', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 1, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    for (const u of ['minute', 'hour', 'day', 'week', 'month']) {
      expect(wrapper.find(`[data-testid="inlast-unit-${u}"]`).exists()).toBe(true)
    }
  })

  it('updating amount emits a new {amount, unit} value', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 7, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="inlast-amount"]').setValue('30')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'occurredAt',
      op: 'inLast',
      value: { amount: 30, unit: 'day' },
    })
  })

  it('changing unit preserves the amount', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 7, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="inlast-unit"]').setValue('week')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'occurredAt',
      op: 'inLast',
      value: { amount: 7, unit: 'week' },
    })
  })

  it('clearing amount drops the condition from valid', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 7, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="inlast-amount"]').setValue('')
    expect(filter.valid.value.children).toHaveLength(0)
  })

  it('selecting a unit before typing an amount preserves the unit choice on first keystroke', async () => {
    // Regression: previously updateUnit returned without emitting when
    // amount was null, and updateAmount fell back to the default 'day'
    // — silently overwriting the unit the user had just clicked.
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: undefined }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="inlast-unit"]').setValue('week')
    // No emission yet (amount still missing).
    expect(filter.valid.value.children).toHaveLength(0)
    // First valid amount keystroke: unit should be 'week' (the user's
    // pick), NOT 'day' (the renderer's internal default).
    await wrapper.find('[data-testid="inlast-amount"]').setValue('3')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'occurredAt',
      op: 'inLast',
      value: { amount: 3, unit: 'week' },
    })
  })
})

describe('FilterPanel — relative-unit i18n labels', () => {
  it('option text falls back to the unit key when no plugin is installed', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 1, unit: 'day' } }],
      },
    })
    // No app.use(dqlKit) — labels resolve to unit keys.
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="inlast-unit-day"]').text()).toBe('day')
    expect(wrapper.find('[data-testid="inlast-unit-week"]').text()).toBe('week')
    wrapper.unmount()
  })

  it('static label map renders option text in the registered language', () => {
    const dqlKit = createDqlKit({
      relativeUnitLabels: {
        minute: '分钟', hour: '小时', day: '天', week: '周', month: '月',
      },
    })
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 1, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, {
      props: { filter },
      global: { plugins: [dqlKit] },
    })
    expect(wrapper.find('[data-testid="inlast-unit-day"]').text()).toBe('天')
    expect(wrapper.find('[data-testid="inlast-unit-week"]').text()).toBe('周')
    wrapper.unmount()
  })

  it('lazy-function labels stay live when the underlying ref changes (vue-i18n style)', async () => {
    const locale = ref<'en' | 'zh'>('en')
    const dict: Record<string, Record<string, string>> = {
      en: { day: 'day', week: 'week' },
      zh: { day: '天', week: '周' },
    }
    const t = (k: string) => dict[locale.value]![k] ?? k
    const dqlKit = createDqlKit({
      relativeUnitLabels: {
        day: () => t('day'),
        week: () => t('week'),
      },
    })
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 1, unit: 'day' } }],
      },
    })
    const wrapper = mount(FilterPanel, {
      props: { filter },
      global: { plugins: [dqlKit] },
    })
    expect(wrapper.find('[data-testid="inlast-unit-day"]').text()).toBe('day')
    expect(wrapper.find('[data-testid="inlast-unit-week"]').text()).toBe('week')

    locale.value = 'zh'
    await nextTick()
    expect(wrapper.find('[data-testid="inlast-unit-day"]').text()).toBe('天')
    expect(wrapper.find('[data-testid="inlast-unit-week"]').text()).toBe('周')

    wrapper.unmount()
  })
})

describe('FilterPanel — id autocomplete renderer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Schema is a plain constant; fetchers are passed via useFilter's
  // `fetchers` map (post-refactor: schema no longer carries async funcs).
  const _idSchema = defineFilterSchema({
    fields: {
      authorId: f.id(),
    },
  })

  const idAuthorSchema = (
    search: (q: string, signal: AbortSignal) => Promise<Item[]> | Item[],
    resolve: (
      ids: (string | number)[],
      signal: AbortSignal,
    ) => Promise<Item[]> | Item[],
  ) => ({
    schema: _idSchema,
    fetchers: {
      authorId: {
        search: search as (q: string, signal: AbortSignal) => Promise<Item[]>,
        resolve: resolve as (
          ids: (string | number)[],
          signal: AbortSignal,
        ) => Promise<Item[]>,
      },
    },
  })

  it('typing in the search box drives setQuery; results render after debounce', async () => {
    const search = vi.fn(async (q: string): Promise<Item[]> => [
      { id: 1, label: `match-${q}-1` },
      { id: 2, label: `match-${q}-2` },
    ])
    const resolve = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `Author ${String(id)}` })),
    )
    const filter = useFilter({
      ...idAuthorSchema(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: undefined }],
      },
      debounceMs: 0,
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const input = wrapper.find('[data-testid="id-search-input"]')
    expect(input.exists()).toBe(true)
    await input.trigger('focus')
    await input.setValue('alice')
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.vm.$nextTick()
    expect(search).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="id-results"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="id-result-"]')).toHaveLength(2)
  })

  it('selecting a result populates the condition value with the raw id', async () => {
    const search = vi.fn(async (): Promise<Item[]> => [
      { id: 7, label: 'Alice' },
    ])
    const resolve = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `Author ${String(id)}` })),
    )
    const filter = useFilter({
      ...idAuthorSchema(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: undefined }],
      },
      debounceMs: 0,
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="id-search-input"]').trigger('focus')
    await wrapper.find('[data-testid="id-search-input"]').setValue('a')
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="id-result-7"]').trigger('mousedown')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'authorId',
      op: 'eq',
      value: 7,
    })
    // After selection: chip with the resolved label is shown, no input.
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="id-chip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="id-search-input"]').exists()).toBe(false)
  })

  it('id chip displays "..." while pending and the resolved label after fetcher settles', async () => {
    let resolveResolveFn!: (items: Item[]) => void
    const resolveP = new Promise<Item[]>((r) => {
      resolveResolveFn = r
    })
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(() => resolveP)
    const filter = useFilter({
      ...idAuthorSchema(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: 42 }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="id-chip"]').text()).toContain('…')
    resolveResolveFn([{ id: 42, label: 'Alice' }])
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="id-chip"]').text()).toContain('Alice')
  })

  it('clearing a selected id reveals the search input again', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `Author ${String(id)}` })),
    )
    const filter = useFilter({
      ...idAuthorSchema(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'eq', value: 7 }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="id-clear"]').trigger('click')
    expect(filter.valid.value.children).toHaveLength(0)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="id-search-input"]').exists()).toBe(true)
  })

  it('id "in" multi-renderer shows one chip per selected id and adds new ones via search', async () => {
    const search = vi.fn(async (): Promise<Item[]> => [{ id: 9, label: 'Carol' }])
    const resolve = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `Author ${String(id)}` })),
    )
    const filter = useFilter({
      ...idAuthorSchema(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'in', value: [1, 2] }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="id-chip-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="id-chip-2"]').exists()).toBe(true)

    const input = wrapper.find('[data-testid="id-search-input"]')
    await input.trigger('focus')
    await input.setValue('c')
    await vi.advanceTimersByTimeAsync(250)
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="id-result-9"]').trigger('mousedown')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'authorId',
      op: 'in',
      value: [1, 2, 9],
    })
  })

  it('removing a chip from the multi-renderer removes the id from the value array', async () => {
    const search = vi.fn(async () => [] as Item[])
    const resolve = vi.fn(
      async (ids: (string | number)[]): Promise<Item[]> =>
        ids.map((id) => ({ id, label: `Author ${String(id)}` })),
    )
    const filter = useFilter({
      ...idAuthorSchema(search, resolve),
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'authorId', op: 'in', value: [1, 2, 3] }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    await wrapper.find('[data-testid="id-chip-remove-2"]').trigger('click')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'authorId',
      op: 'in',
      value: [1, 3],
    })
  })
})

describe('FilterPanel — array<U> renderer dispatch', () => {
  it('array<string> + contains (single shape) renders the string text input', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'tags', op: 'contains', value: '' }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const input = wrapper.find('input.dql-input--string')
    expect(input.exists()).toBe(true)
    await input.setValue('urgent')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'tags',
      op: 'contains',
      value: 'urgent',
    })
  })

  it('array<string> + containsAll (list shape) renders the StringTokenInput', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'tags', op: 'containsAll', value: ['a', 'b'] }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="token-list"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="token"]')).toHaveLength(2)

    const input = wrapper.find('[data-testid="token-input"]')
    await input.setValue('c')
    await input.trigger('keydown', { key: 'Enter' })
    expect(filter.valid.value.children[0]).toEqual({
      field: 'tags',
      op: 'containsAll',
      value: ['a', 'b', 'c'],
    })
  })

  it('array<number> + containsAll routes to the NumberTokenInput', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'scores', op: 'containsAll', value: [1, 2] }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const input = wrapper.find('[data-testid="token-input"]')
    expect(input.attributes('type')).toBe('number')
    await input.setValue('3')
    await input.trigger('keydown', { key: 'Enter' })
    const cond = filter.valid.value.children[0] as { value: unknown[] }
    expect(cond.value).toEqual([1, 2, 3])
    expect(typeof cond.value[2]).toBe('number')
  })

  it('array<enum> + containsAll renders the EnumMultiSelect with valueLabels', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'statusList', op: 'containsAll', value: ['draft'] }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="enum-multi"]').exists()).toBe(true)
    // valueLabels resolved from itemType (the inner enum field).
    expect(wrapper.find('[data-testid="enum-multi-option-draft"]').text()).toContain('草稿')
    expect(wrapper.find('[data-testid="enum-multi-option-published"]').text()).toContain('已发布')
    await wrapper
      .find('[data-testid="enum-multi-option-published"] input')
      .setValue(true)
    expect(filter.valid.value.children[0]).toEqual({
      field: 'statusList',
      op: 'containsAll',
      value: ['draft', 'published'],
    })
  })

  it('array + isEmpty (none shape) renders no value input', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'tags', op: 'isEmpty', value: undefined }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.findAll('input.dql-input--string')).toHaveLength(0)
    expect(wrapper.find('[data-testid="token-list"]').exists()).toBe(false)
  })
})

describe('FilterPanel — nested groups', () => {
  it('renders the root group with depth=0 and no remove-group button', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const root = wrapper.find('[data-testid="group"]')
    expect(root.exists()).toBe(true)
    expect(root.attributes('data-depth')).toBe('0')
    expect(root.classes()).toContain('dql-group--root')
    // The root must NOT have a remove-group button (top-level is exempt
    // per DESIGN.md Q10).
    expect(wrapper.find('[data-testid="remove-group"]').exists()).toBe(false)
  })

  it('addGroup creates a nested group with depth=1 and a per-group combinator select', async () => {
    // Seed root with 2+ children at each level so both combinators are
    // visible — the builder hides the picker for 0/1-child groups, where
    // AND/OR has no observable effect (mirrors canonical-AST flatten).
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'a' },
          {
            combinator: 'and',
            children: [
              { field: 'title', op: 'eq', value: 'b' },
              { field: 'title', op: 'eq', value: 'c' },
            ],
          },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const nested = wrapper.find('[data-testid="group-nested"]')
    expect(nested.exists()).toBe(true)
    expect(nested.attributes('data-depth')).toBe('1')
    expect(nested.classes()).toContain('dql-group--nested')
    // Each group has its own combinator select (root + nested = 2).
    expect(wrapper.findAll('[data-testid="combinator-select"]')).toHaveLength(2)
  })

  it('combinator picker is hidden for 0/1-child groups', async () => {
    // Empty root → no combinator visible.
    const filter = useFilter({ schema, sync: 'none' })
    let wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.findAll('[data-testid="combinator-select"]')).toHaveLength(0)
    wrapper.unmount()

    // Root with 1 condition → still no combinator.
    const oneChild = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'a' }],
      },
    })
    wrapper = mount(FilterPanel, { props: { filter: oneChild } })
    expect(wrapper.findAll('[data-testid="combinator-select"]')).toHaveLength(0)
    wrapper.unmount()

    // Root with 2 conditions → exactly one combinator.
    const twoChildren = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'a' },
          { field: 'title', op: 'eq', value: 'b' },
        ],
      },
    })
    wrapper = mount(FilterPanel, { props: { filter: twoChildren } })
    expect(wrapper.findAll('[data-testid="combinator-select"]')).toHaveLength(1)
  })

  it('flipping the nested combinator updates only the nested group', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'top' },
          {
            combinator: 'and',
            children: [
              { field: 'title', op: 'eq', value: 'a' },
              { field: 'title', op: 'eq', value: 'b' },
            ],
          },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const selects = wrapper.findAll('[data-testid="combinator-select"]')
    expect(selects).toHaveLength(2)
    await selects[1]!.setValue('or')
    expect(filter.draft.value.combinator).toBe('and')
    const innerGroup = filter.draft.value.children[1] as { combinator: string }
    expect(innerGroup.combinator).toBe('or')
  })

  it('remove-group button removes the entire nested group and any of its conditions', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'keep-me' },
          {
            combinator: 'or',
            children: [
              { field: 'rating', op: 'gt', value: 1 },
              { field: 'rating', op: 'lt', value: 9 },
            ],
          },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="group-nested"]').exists()).toBe(true)
    await wrapper.find('[data-testid="remove-group"]').trigger('click')
    expect(wrapper.find('[data-testid="group-nested"]').exists()).toBe(false)
    expect(filter.valid.value.children).toEqual([
      { field: 'title', op: 'eq', value: 'keep-me' },
    ])
  })

  it('action chain: addGroup → addCondition → updateNode produces a (A or B) and C valid AST', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'C' }],
      },
    })
    // Insert an OR sub-group at root and seed it with two conditions.
    filter.actions.addGroup([], 'or')
    filter.actions.addCondition([1], { field: 'title', op: 'eq', value: 'A' })
    filter.actions.addCondition([1], { field: 'title', op: 'eq', value: 'B' })
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'C' },
        {
          combinator: 'or',
          children: [
            { field: 'title', op: 'eq', value: 'A' },
            { field: 'title', op: 'eq', value: 'B' },
          ],
        },
      ],
    })
  })

  it('a three-level fixture exposes data-depth=2 on the deepest group', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          {
            combinator: 'or',
            children: [
              { field: 'title', op: 'eq', value: 'a' },
              {
                combinator: 'and',
                children: [
                  { field: 'rating', op: 'gt', value: 1 },
                  { field: 'rating', op: 'lt', value: 9 },
                ],
              },
            ],
          },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const depths = wrapper
      .findAll('[data-depth]')
      .map((el) => el.attributes('data-depth'))
    expect(depths).toEqual(['0', '1', '2'])
  })
})

describe('FilterPanel — validation error indicators', () => {
  it('clean draft has no error indicator and no error class on the condition row', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'title', op: 'eq', value: 'a' }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const condition = wrapper.find('[data-testid="condition"]')
    expect(condition.attributes('data-has-error')).toBe('false')
    expect(condition.classes()).not.toContain('dql-condition--error')
    expect(wrapper.find('[data-testid="condition-error"]').exists()).toBe(false)
  })

  it.each([
    ['incomplete', { field: null, op: null }],
    ['unknown_field', { field: 'mystery', op: 'eq', value: 'x' }],
    ['op_not_allowed', { field: 'title', op: 'gt', value: 'x' }],
    ['value_type_mismatch', { field: 'rating', op: 'eq', value: 'oops' }],
    ['value_shape_mismatch', { field: 'rating', op: 'between', value: 5 }],
  ])('renders an indicator with data-error-code=%s for the offending row', (code, child) => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [child as { field: string | null, op: string | null, value?: unknown }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const condition = wrapper.find('[data-testid="condition"]')
    expect(condition.attributes('data-has-error')).toBe('true')
    expect(condition.classes()).toContain('dql-condition--error')
    const indicator = wrapper.find('[data-testid="condition-error"]')
    expect(indicator.exists()).toBe(true)
    expect(indicator.attributes('data-error-code')).toBe(code)
    expect(indicator.attributes('aria-label')).toBe(code)
  })

  it('only the offending row gets the error class when multiple rows coexist', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'ok' },
          { field: 'rating', op: 'eq', value: 'oops' },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const conditions = wrapper.findAll('[data-testid="condition"]')
    expect(conditions[0]?.attributes('data-has-error')).toBe('false')
    expect(conditions[1]?.attributes('data-has-error')).toBe('true')
    expect(conditions[1]?.attributes('data-error-code' as never)).toBeUndefined()
    // Indicator lives on the row, code is on the indicator span.
    const indicators = wrapper.findAll('[data-testid="condition-error"]')
    expect(indicators).toHaveLength(1)
    expect(indicators[0]?.attributes('data-error-code')).toBe('value_type_mismatch')
  })

  it('error indicator clears reactively when the user fixes the offending value', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [{ field: 'rating', op: 'eq', value: 'oops' }],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="condition-error"]').exists()).toBe(true)
    // Fix the value through the composable.
    filter.actions.updateNode([0], { value: 5 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="condition-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="condition"]').attributes('data-has-error')).toBe('false')
  })

  it('error path resolves into a nested condition correctly', () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'a' },
          {
            combinator: 'or',
            children: [
              { field: 'title', op: 'eq', value: 'b' },
              { field: 'mystery', op: 'eq', value: 'x' },
            ],
          },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    const conditions = wrapper.findAll('[data-testid="condition"]')
    // Three conditions total: [0], [1,0] (clean), [1,1] (unknown_field).
    expect(conditions).toHaveLength(3)
    expect(conditions[0]?.attributes('data-has-error')).toBe('false')
    expect(conditions[1]?.attributes('data-has-error')).toBe('false')
    expect(conditions[2]?.attributes('data-has-error')).toBe('true')
    expect(
      conditions[2]?.find('[data-testid="condition-error"]').attributes('data-error-code'),
    ).toBe('unknown_field')
  })
})

describe('FilterPanel — custom type renderer dispatch', () => {
  // Each test uses a unique typeId so the warn-once dedup doesn't bleed
  // across tests. Renderers are scoped to a freshly-built createDqlKit
  // per test, so there's no cross-test bleed even though warnedTypeIds
  // is module-level (the warn-once dedup is intentional for prod logs).
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('createDqlKit({ renderers }) routes a custom typeId to the registered component', async () => {
    const updates: unknown[] = []
    const MoneyInput = defineComponent({
      props: {
        fieldKey: { type: String, required: true as const },
        field: { type: Object, required: true as const },
        op: { type: String, required: true as const },
        value: { type: null as unknown as () => unknown, default: undefined },
        onUpdate: {
          type: Function as unknown as () => (v: unknown) => void,
          required: true as const,
        },
      },
      setup(props) {
        return () =>
          h('input', {
            type: 'text',
            'data-testid': 'money-input',
            value: typeof props.value === 'object' && props.value !== null
              ? String((props.value as { amount?: number }).amount ?? '')
              : '',
            onInput: (e: Event) => {
              const raw = (e.target as HTMLInputElement).value
              const next = { amount: Number(raw), currency: 'USD' }
              ;(props.onUpdate as (v: unknown) => void)(next)
              updates.push(next)
            },
          })
      },
    })

    const dqlKit = createDqlKit({
      renderers: { money_unique_a: MoneyInput },
    })

    const moneySchema = defineFilterSchema({
      fields: {
        price: f.custom({
          typeId: 'money_unique_a',
          ops: [{ name: 'moneyEq', valueShape: 'single', label: 'is' }],
        }),
      },
    })
    const filter = useFilter({
      schema: moneySchema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'price', op: 'moneyEq', value: { amount: 100, currency: 'USD' } },
        ],
      },
    })
    const wrapper = mount(FilterPanel, {
      props: { filter },
      global: { plugins: [dqlKit] },
    })
    const moneyInput = wrapper.find('[data-testid="money-input"]')
    expect(moneyInput.exists()).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()

    await moneyInput.setValue('250')
    expect(filter.valid.value.children[0]).toEqual({
      field: 'price',
      op: 'moneyEq',
      value: { amount: 250, currency: 'USD' },
    })
  })

  it('falls back to StringInput + console.warn when no renderer is registered', () => {
    const moneySchema = defineFilterSchema({
      fields: {
        price: f.custom({
          typeId: 'money_unique_b',
          ops: [{ name: 'moneyEq', valueShape: 'single', label: 'is' }],
        }),
      },
    })
    const filter = useFilter({
      schema: moneySchema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'price', op: 'moneyEq', value: 'fallback-text' },
        ],
      },
    })
    const wrapper = mount(FilterPanel, { props: { filter } })
    // The fallback IS the string text input.
    expect(wrapper.find('input.dql-input--string').exists()).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    const message = warnSpy.mock.calls[0]![0] as string
    expect(message).toContain('typeId="money_unique_b"')
    expect(message).toContain('createDqlKit')
  })

  it('warn is deduplicated to once per typeId', () => {
    const moneySchema = defineFilterSchema({
      fields: {
        price: f.custom({
          typeId: 'money_unique_c',
          ops: [{ name: 'moneyEq', valueShape: 'single', label: 'is' }],
        }),
      },
    })
    const filter = useFilter({
      schema: moneySchema,
      sync: 'none',
      initial: {
        combinator: 'and',
        children: [
          { field: 'price', op: 'moneyEq', value: 'a' },
          { field: 'price', op: 'moneyEq', value: 'b' },
          { field: 'price', op: 'moneyEq', value: 'c' },
        ],
      },
    })
    mount(FilterPanel, { props: { filter } })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('FilterPanel — dropped[] schema-evolution notice', () => {
  it('hides the notice when dropped is empty', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="dropped-notice"]').exists()).toBe(false)
  })

  it('renders a dismissible notice with the count when dropped is non-empty', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    // Force-populate the dropped surface (the URL flow normally drives this;
    // for unit-level rendering we mutate it directly).
    filter.dropped.value = [
      { path: [0], reason: 'unknown_field', detail: { field: 'mystery' } },
      { path: [1], reason: 'value_type_mismatch', detail: { field: 'rating' } },
    ]
    const wrapper = mount(FilterPanel, { props: { filter } })
    const notice = wrapper.find('[data-testid="dropped-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.attributes('role')).toBe('alert')
    expect(notice.attributes('data-dropped-count')).toBe('2')
    expect(notice.text()).toContain('2 condition(s) dropped due to schema changes')
    // Dismiss button clears the notice reactively.
    await wrapper.find('[data-testid="dropped-dismiss"]').trigger('click')
    expect(filter.dropped.value).toEqual([])
    expect(wrapper.find('[data-testid="dropped-notice"]').exists()).toBe(false)
  })

  it('updates the count when dropped is mutated externally', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.dropped.value = [
      { path: [0], reason: 'unknown_field' },
    ]
    const wrapper = mount(FilterPanel, { props: { filter } })
    expect(wrapper.find('[data-testid="dropped-notice"]').attributes('data-dropped-count')).toBe('1')
    filter.dropped.value = [
      { path: [0], reason: 'unknown_field' },
      { path: [1], reason: 'op_not_allowed' },
      { path: [2], reason: 'value_type_mismatch' },
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="dropped-notice"]').attributes('data-dropped-count')).toBe('3')
  })
})
