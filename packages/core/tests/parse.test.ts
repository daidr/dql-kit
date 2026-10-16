import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_AST_LIMITS,
  analyze,
  builtinOps,
  defineFilterSchema,
  f,
  fromUrl,
  parseAst,
  toUrl,
} from '../src/index.ts'
import type { ParseResult } from '../src/types.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    name: f.custom({ typeId: 'string', ops: [builtinOps.eq, builtinOps.contains] }),
    viewsCount: f.number(),
    status: f.enum(['draft', 'published'] as const),
    tags: f.array(f.string()),
    occurredAt: f.datetime(),
  },
})

const errorsOf = (r: ParseResult) => (r.ok ? [] : r.errors)

describe('parseAst', () => {
  test('accepts a valid AST and returns it normalised', () => {
    const input = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'contains', value: 'hi' },
        // single-child group collapses, empty group disappears
        { combinator: 'or', children: [{ field: 'viewsCount', op: 'gt', value: 3 }] },
        { combinator: 'or', children: [] },
        { field: 'occurredAt', op: 'inLast', value: { unit: 'day', amount: 7, extra: 1 } },
      ],
    }
    const r = parseAst(input, schema)
    expect(r).toEqual({
      ok: true,
      ast: {
        combinator: 'and',
        children: [
          { field: 'title', op: 'contains', value: 'hi' },
          { field: 'viewsCount', op: 'gt', value: 3 },
          { field: 'occurredAt', op: 'inLast', value: { amount: 7, unit: 'day' } },
        ],
      },
    })
  })

  test('output does not alias the input', () => {
    const list = ['draft']
    const input = { combinator: 'and', children: [{ field: 'status', op: 'in', value: list }] }
    const r = parseAst(input, schema)
    if (!r.ok) throw new Error('expected ok')
    list.push('published')
    expect(r.ast.children[0]).toEqual({ field: 'status', op: 'in', value: ['draft'] })
  })

  test('drops extra keys', () => {
    const input = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a', sql: 'DROP TABLE' }],
      extra: true,
    }
    const r = parseAst(input, schema)
    expect(r).toEqual({
      ok: true,
      ast: { combinator: 'and', children: [{ field: 'title', op: 'eq', value: 'a' }] },
    })
  })

  test('rejects an op that is not declared on the field', () => {
    const r = parseAst(
      { combinator: 'and', children: [{ field: 'viewsCount', op: 'contains', value: 'x' }] },
      schema,
    )
    expect(errorsOf(r)).toEqual([
      { path: [0], code: 'op_not_allowed', field: 'viewsCount', op: 'contains' },
    ])
  })

  test('rejects an op the schema removed from a field', () => {
    const r = parseAst({ combinator: 'and', children: [{ field: 'name', op: 'isEmpty' }] }, schema)
    expect(errorsOf(r)[0]).toMatchObject({ code: 'op_not_allowed', field: 'name', op: 'isEmpty' })
  })

  test('rejects a value of the wrong type', () => {
    const r = parseAst(
      { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'whatever' }] },
      schema,
    )
    expect(errorsOf(r)[0]).toMatchObject({ code: 'value_type_mismatch', path: [0] })
  })

  test('rejects a stray value on a none-shape op (strict, unlike prune)', () => {
    const r = parseAst(
      { combinator: 'and', children: [{ field: 'title', op: 'isEmpty', value: 'x' }] },
      schema,
    )
    expect(errorsOf(r)).toEqual([
      { path: [0], code: 'value_shape_mismatch', op: 'isEmpty', expected: 'none' },
    ])
  })

  test('rejects incomplete conditions', () => {
    const r = parseAst({ combinator: 'and', children: [{ field: 'title', op: 'eq' }] }, schema)
    expect(errorsOf(r)).toEqual([{ path: [0], code: 'incomplete', missing: 'value' }])
  })

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['string', '{"combinator":"and","children":[]}'],
    ['array', []],
    ['condition at root', { field: 'title', op: 'eq', value: 'x' }],
    ['bad combinator', { combinator: 'xor', children: [] }],
    ['children not an array', { combinator: 'and', children: {} }],
  ])('rejects malformed root: %s', (_label, input) => {
    const r = parseAst(input, schema)
    expect(r.ok).toBe(false)
    expect(errorsOf(r)[0]?.code).toBe('invalid_node')
  })

  test('rejects malformed nested nodes with their path', () => {
    const r = parseAst(
      {
        combinator: 'and',
        children: [
          { field: 'title', op: 'eq', value: 'ok' },
          { combinator: 'or', children: [42, { field: ['x'], op: 'eq', value: 1 }] },
        ],
      },
      schema,
    )
    expect(errorsOf(r).map((e) => [e.path, e.code])).toEqual([
      [[1, 0], 'invalid_node'],
      [[1, 1], 'invalid_node'],
    ])
  })

  test('accepts the empty root group', () => {
    expect(parseAst({ combinator: 'or', children: [] }, schema)).toEqual({
      ok: true,
      ast: { combinator: 'or', children: [] },
    })
  })

  describe('limits', () => {
    const deep = (levels: number): unknown => {
      let node: unknown = { field: 'title', op: 'eq', value: 'x' }
      for (let i = 0; i < levels; i++) {
        node = { combinator: 'and', children: [node, { field: 'viewsCount', op: 'eq', value: i }] }
      }
      return node
    }

    test('defaults', () => {
      expect(DEFAULT_AST_LIMITS).toEqual({ maxDepth: 8, maxNodes: 200, maxListLength: 100 })
      expect(Object.isFrozen(DEFAULT_AST_LIMITS)).toBe(true)
    })

    test('maxDepth counts the root group as depth 1', () => {
      expect(parseAst(deep(8), schema).ok).toBe(true)
      expect(errorsOf(parseAst(deep(9), schema))).toEqual([
        { path: [0, 0, 0, 0, 0, 0, 0, 0], code: 'limit_exceeded', limit: 'maxDepth', max: 8 },
      ])
    })

    test('20k-deep input fails cleanly instead of overflowing the stack', () => {
      let node: unknown = { field: 'title', op: 'eq', value: 'x' }
      for (let i = 0; i < 20_000; i++) node = { combinator: 'and', children: [node] }
      let r: ParseResult | undefined
      expect(() => { r = parseAst(node, schema) }).not.toThrow()
      expect(errorsOf(r!)[0]).toMatchObject({ code: 'limit_exceeded', limit: 'maxDepth' })
    })

    test('maxNodes', () => {
      const wide = {
        combinator: 'and',
        children: Array.from({ length: 300 }, (_, i) => ({ field: 'viewsCount', op: 'eq', value: i })),
      }
      expect(errorsOf(parseAst(wide, schema))).toEqual([
        { path: [199], code: 'limit_exceeded', limit: 'maxNodes', max: 200 },
      ])
      expect(parseAst(wide, schema, { maxNodes: 301 }).ok).toBe(true)
    })

    test('maxListLength', () => {
      const big = {
        combinator: 'and',
        children: [{ field: 'tags', op: 'containsAll', value: Array.from({ length: 101 }, String) }],
      }
      expect(errorsOf(parseAst(big, schema))).toEqual([
        { path: [0], code: 'limit_exceeded', limit: 'maxListLength', max: 100 },
      ])
      expect(parseAst(big, schema, { maxListLength: 101 }).ok).toBe(true)
    })
  })
})

describe('entry points agree', () => {
  // The same input through analyze (draft), parseAst (request body) and
  // fromUrl (link) must keep and reject the same nodes.
  const cases: Array<[string, unknown]> = [
    ['valid', { field: 'title', op: 'eq', value: 'x' }],
    ['op not allowed', { field: 'viewsCount', op: 'contains', value: 'x' }],
    ['unknown field', { field: 'nope', op: 'eq', value: 'x' }],
    ['bad enum value', { field: 'status', op: 'eq', value: 'archived' }],
    ['stray value on none op', { field: 'title', op: 'isEmpty', value: 'x' }],
    ['missing value', { field: 'title', op: 'eq' }],
    ['bad shape', { field: 'viewsCount', op: 'between', value: [1] }],
  ]

  const toCompact = (n: Record<string, unknown>) => {
    const out: Record<string, unknown> = { f: n.field, o: n.op }
    if ('value' in n) out.v = n.value
    return out
  }

  test.each(cases)('%s', (_label, cond) => {
    const long = { combinator: 'and' as const, children: [cond] }
    const a = analyze(long as never, schema)
    const p = parseAst(long, schema)
    const u = fromUrl(
      JSON.stringify({ c: 'and', n: [toCompact(cond as Record<string, unknown>)] }),
      schema,
    )
    expect(u.ast).toEqual(a.ast)
    expect(u.dropped).toEqual(a.errors)
    expect(p.ok ? [] : p.errors).toEqual(a.errors)
    if (p.ok) expect(p.ast).toEqual(a.ast)
  })

  test('a parsed AST round-trips through the URL unchanged', () => {
    const r = parseAst(
      {
        combinator: 'or',
        children: [
          { field: 'title', op: 'contains', value: '100% "quoted" & more' },
          { combinator: 'and', children: [
            { field: 'status', op: 'in', value: ['draft'] },
            { field: 'occurredAt', op: 'inLast', value: { amount: 3, unit: 'week' } },
          ] },
        ],
      },
      schema,
    )
    if (!r.ok) throw new Error('expected ok')
    expect(fromUrl(toUrl(r.ast), schema)).toEqual({ ast: r.ast, dropped: [] })
  })
})
