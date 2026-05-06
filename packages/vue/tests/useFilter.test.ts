import { defineFilterSchema, f, type ValidAST } from '@dql-kit/core'
import { describe, expect, it } from 'vitest'
import { isProxy, isReactive, isRef, ref } from 'vue'
import { useFilter } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number(),
  },
})

describe('useFilter — reactive surface', () => {
  it('exposes draft and valid as reactive', () => {
    const filter = useFilter({ schema, sync: 'none' })
    expect(isRef(filter.draft)).toBe(true)
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })

  it('valid is plain data — no Vue proxy/ref leak', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    const v = filter.valid.value
    expect(isProxy(v)).toBe(false)
    expect(isReactive(v)).toBe(false)
    expect(isRef(v)).toBe(false)
    // children too
    expect(isProxy(v.children[0])).toBe(false)
  })

  it('schema accepts a Ref<S | undefined>', () => {
    const schemaRef = ref<typeof schema | undefined>(schema)
    const filter = useFilter({ schema: schemaRef, sync: 'none' })
    expect(filter.schema.value).toStrictEqual(schema)
    schemaRef.value = undefined
    expect(filter.schema.value).toBeUndefined()
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })
})

describe('useFilter — actions', () => {
  it('addCondition + updateNode produces a single eq condition in valid', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([])
    filter.actions.updateNode([0], { field: 'title' })
    filter.actions.updateNode([0], { op: 'eq', value: 'hello' })
    expect(filter.valid.value).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    })
  })

  it('updateNode with field change resets op and value', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'hello' })
    filter.actions.updateNode([0], { field: 'rating' })
    const cond = filter.draft.value.children[0] as {
      field: string | null
      op: string | null
      value?: unknown
    }
    expect(cond.field).toBe('rating')
    expect(cond.op).toBeNull()
    expect(cond.value).toBeUndefined()
  })

  it('removeNode removes the condition at path', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'b' })
    filter.actions.removeNode([0])
    expect(filter.valid.value.children).toEqual([
      { field: 'title', op: 'eq', value: 'b' },
    ])
  })

  it('clear empties the draft', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    filter.actions.clear()
    expect(filter.valid.value).toEqual({ combinator: 'and', children: [] })
  })

  it('addGroup nests a sub-group', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addGroup([], 'or')
    filter.actions.addCondition([0], { field: 'title', op: 'eq', value: 'a' })
    expect(filter.draft.value.children).toHaveLength(1)
    const group = filter.draft.value.children[0] as { combinator: string, children: unknown[] }
    expect(group.combinator).toBe('or')
    expect(group.children).toHaveLength(1)
  })

  it('setCombinator flips root and/or', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.setCombinator([], 'or')
    expect(filter.draft.value.combinator).toBe('or')
  })
})

describe('useFilter — applyAst / toJSON', () => {
  it('applyAst loads a Valid AST as the new draft', () => {
    const filter = useFilter({ schema, sync: 'none' })
    const ast: ValidAST = {
      combinator: 'or',
      children: [{ field: 'title', op: 'eq', value: 'preset' }],
    }
    filter.applyAst(ast)
    expect(filter.valid.value).toEqual(ast)
  })

  it('toJSON returns the current Valid AST snapshot', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'x' })
    const json = filter.toJSON()
    expect(json).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'x' }],
    })
  })
})

describe('useFilter — errors surface', () => {
  it('returns [] for a valid draft', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([], { field: 'title', op: 'eq', value: 'a' })
    expect(filter.errors.value).toEqual([])
  })

  it('reports incomplete for a half-built condition', () => {
    const filter = useFilter({ schema, sync: 'none' })
    filter.actions.addCondition([])
    expect(filter.errors.value.length).toBeGreaterThan(0)
    expect(filter.errors.value[0]?.code).toBe('incomplete')
  })
})
