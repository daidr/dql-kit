import { defineFilterSchema, f } from '@dql-kit/core'
import { describe, expect, it } from 'vitest'
import { createDqlKit, resolveFieldLabel, resolveLabel, resolveOpLabel } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number(),
  },
})

describe('label helpers', () => {
  it('resolveLabel evaluates thunks and falls back when unset', () => {
    expect(resolveLabel('A', 'x')).toBe('A')
    expect(resolveLabel(() => 'B', 'x')).toBe('B')
    expect(resolveLabel(undefined, 'x')).toBe('x')
  })

  it('resolveFieldLabel falls back to the field key', () => {
    expect(resolveFieldLabel('title', schema.fields.title)).toBe('Title')
    expect(resolveFieldLabel('rating', schema.fields.rating)).toBe('rating')
    expect(resolveFieldLabel('missing', undefined)).toBe('missing')
  })

  it('resolveOpLabel: plugin opLabels → schema label → op name', () => {
    const eq = schema.fields.title.ops.find((o) => o.name === 'eq')!
    expect(resolveOpLabel(eq)).toBe(typeof eq.label === 'string' ? eq.label : 'eq')
    expect(resolveOpLabel({ ...eq, label: undefined }, null)).toBe('eq')
    expect(resolveOpLabel({ ...eq, label: 'Equals' }, null)).toBe('Equals')

    const kit = createDqlKit({ opLabels: { eq: () => '等于' } })
    expect(resolveOpLabel({ ...eq, label: 'Equals' }, kit)).toBe('等于')
  })
})
