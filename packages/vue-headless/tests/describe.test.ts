import { defineFilterSchema, f, type Item } from '@dql-kit/core'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createDqlKit, groupFields, useFilter, type UseFilterReturn } from '../src/index.ts'

describe('groupFields', () => {
  it('sorts groups by order, keeps declaration order, puts ungrouped last', () => {
    const s = defineFilterSchema({
      groups: { meta: { label: 'Meta', order: 2 }, basic: { label: 'Basic', order: 1 }, misc: {} },
      fields: {
        a: f.string({ group: 'meta' }),
        b: f.string(),
        c: f.string({ group: 'basic' }),
        d: f.string({ group: 'misc' }),
        e: f.string({ group: 'basic' }),
      },
    })
    expect(groupFields(s).map((g) => [g.key, g.fields.map((x) => x.key)])).toEqual([
      ['basic', ['c', 'e']],
      ['meta', ['a']],
      ['misc', ['d']],
      [null, ['b']],
    ])
  })

  it('an undeclared group falls into ungrouped and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = defineFilterSchema({
      fields: { a: f.string({ group: 'ghost' }), b: f.string({ group: 'ghost' }) },
    })
    expect(groupFields(s)).toEqual([
      { key: null, label: undefined, fields: [{ key: 'a', def: s.fields.a }, { key: 'b', def: s.fields.b }] },
    ])
    groupFields(s)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/group "ghost"/)
    warn.mockRestore()
  })

  it('useFilter().fieldGroups follows the schema', () => {
    const s = defineFilterSchema({ groups: { g: {} }, fields: { a: f.string({ group: 'g' }) } })
    const filter = useFilter({ schema: s, sync: 'none' })
    expect(filter.fieldGroups.value.map((g) => g.key)).toEqual(['g'])
  })
})

describe('useFilter().describe', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const schema = defineFilterSchema({
    fields: {
      owner: f.id<number>({ label: 'Owner' }),
      at: f.datetime({ label: 'At' }),
    },
  })
  const resolve = vi.fn(async (ids: number[]): Promise<Item<number>[]> =>
    ids.filter((id) => id !== 9).map((id) => ({ id, label: `User ${id}` })))
  const fetchers = { owner: { search: async () => [], resolve } }

  it('defaults to committedValid and resolves id labels through labelOf', async () => {
    const filter = useFilter({
      schema,
      fetchers,
      sync: 'none',
      initial: { combinator: 'and', children: [{ field: 'owner', op: 'in', value: [1, 9] }] },
    })
    const before = filter.describe().children[0]!
    if (before.kind !== 'condition') throw new Error('kind')
    expect(before.valueParts.map((p) => [p.text, p.status])).toEqual([['…', 'loading'], ['…', 'loading']])
    await vi.advanceTimersByTimeAsync(0)
    const after = filter.describe().children[0]!
    if (after.kind !== 'condition') throw new Error('kind')
    expect(after.valueParts.map((p) => [p.text, p.status])).toEqual([['User 1', undefined], ['#9', 'error']])
    expect(after.text).toBe('Owner in User 1, #9')
  })

  it('describes a given AST', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const d = filter.describe({
      combinator: 'and',
      children: [{ field: 'at', op: 'inLast', value: { amount: 3, unit: 'day' } }],
    })
    expect(d.text).toBe('At inLast 3 day')
  })

  it('uses plugin op, unit and period labels inside a component', () => {
    let filter: UseFilterReturn | undefined
    const Probe = defineComponent({
      setup() {
        filter = useFilter({ schema, sync: 'none' })
        return () => h('div')
      },
    })
    const kit = createDqlKit({
      opLabels: { inLast: '最近', inPeriod: '属于' },
      relativeUnitLabels: { day: '天' },
      periodLabels: { previous: '上', month: '月' },
    })
    mount(Probe, { global: { plugins: [kit] } })
    const d = filter!.describe({
      combinator: 'and',
      children: [
        { field: 'at', op: 'inLast', value: { amount: 3, unit: 'day' } },
        { field: 'at', op: 'inPeriod', value: { unit: 'month', offset: -1 } },
      ],
    })
    expect(d.children.map((c) => c.text)).toEqual(['At 最近 3 天', 'At 属于 上 月'])
  })
})
