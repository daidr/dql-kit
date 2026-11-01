import { describe, expect, test } from 'bun:test'
import { builtinOps, defineFilterSchema, describeAst, f, type ValidAST } from '../src/index.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number({ label: () => 'Rating' }),
    status: f.enum(['draft', 'published'] as const, {
      label: 'Status',
      valueLabels: { draft: 'Draft', published: 'Published' },
    }),
    tags: f.array(f.enum(['a', 'b'] as const, { valueLabels: { a: 'Alpha' } })),
    at: f.datetime({ label: 'At' }),
    owner: f.id<number>({ label: 'Owner', nullable: true }),
  },
})

const ast: ValidAST = {
  combinator: 'and',
  children: [
    { field: 'status', op: 'in', value: ['draft', 'published'] },
    { field: 'rating', op: 'between', value: [1, 5] },
    {
      combinator: 'or',
      children: [
        { field: 'at', op: 'inLast', value: { amount: 7, unit: 'day' } },
        { field: 'at', op: 'inPeriod', value: { unit: 'month', offset: -1 } },
      ],
    },
    { field: 'owner', op: 'isEmpty' },
  ],
}

describe('describeAst', () => {
  test('mirrors the AST with labels, parts and text', () => {
    const d = describeAst(ast, schema)
    expect(d.kind).toBe('group')
    expect(d.children.map((c) => c.path)).toEqual([[0], [1], [2], [3]])
    const [status, rating, group, owner] = d.children
    expect(status).toMatchObject({
      kind: 'condition',
      field: 'status',
      fieldLabel: 'Status',
      opLabel: 'in',
      shape: 'list',
      valueParts: [
        { kind: 'scalar', value: 'draft', text: 'Draft' },
        { kind: 'scalar', value: 'published', text: 'Published' },
      ],
      text: 'Status in Draft, Published',
    })
    expect(rating!.text).toBe('Rating between 1 – 5')
    expect(group!.text).toBe('At inLast 7 day OR At inPeriod previous month')
    expect(owner!.text).toBe('Owner isEmpty')
    expect(d.text).toBe(
      'Status in Draft, Published AND Rating between 1 – 5 AND (At inLast 7 day OR At inPeriod previous month) AND Owner isEmpty',
    )
  })

  test('array elements use the item type value labels', () => {
    const d = describeAst({ combinator: 'and', children: [{ field: 'tags', op: 'containsAny', value: ['a', 'b'] }] }, schema)
    expect(d.text).toBe('tags containsAny Alpha, b')
  })

  test('period offsets other than -1 / 0 / 1 show a signed number', () => {
    const one = (offset: number) =>
      describeAst({ combinator: 'and', children: [{ field: 'at', op: 'inPeriod', value: { unit: 'quarter', offset } }] }, schema).text
    expect(one(0)).toBe('At inPeriod current quarter')
    expect(one(3)).toBe('At inPeriod quarter +3')
    expect(one(-2)).toBe('At inPeriod quarter -2')
  })

  test('opLabel and valueText override the defaults', () => {
    const d = describeAst(ast, schema, {
      opLabel: (op) => (op.name === 'in' ? 'is any of' : undefined),
      valueText: (part, ctx) => (ctx.fieldKey === 'rating' && part.kind === 'scalar' ? `${String(part.value)}★` : undefined),
    })
    expect(d.children[0]!.text).toBe('Status is any of Draft, Published')
    expect(d.children[1]!.text).toBe('Rating between 1★ – 5★')
  })

  test('valueText can mark a part provisional', () => {
    const d = describeAst({ combinator: 'and', children: [{ field: 'owner', op: 'eq', value: 7 }] }, schema, {
      valueText: () => ({ text: '…', status: 'loading' }),
    })
    const c = d.children[0]!
    if (c.kind !== 'condition') throw new Error('kind')
    expect(c.valueParts).toEqual([{ kind: 'scalar', value: 7, text: '…', status: 'loading' }])
  })

  test('a field or op unknown to the schema keeps its raw name', () => {
    const d = describeAst({ combinator: 'and', children: [{ field: 'nope', op: 'weird', value: 1 }] }, schema)
    expect(d.text).toBe('nope weird 1')
  })

  test('schema op labels are used', () => {
    const s = defineFilterSchema({ fields: { n: f.custom({ typeId: 'n', delegateTo: 'number', ops: [{ ...builtinOps.gt, label: 'above' }] }) } })
    expect(describeAst({ combinator: 'and', children: [{ field: 'n', op: 'gt', value: 3 }] }, s).text).toBe('n above 3')
  })
})
