import { describe, expect, test } from 'bun:test'
import {
  COMPACT_KEYS,
  defineFilterSchema,
  emptyAst,
  f,
  fromUrl,
  toUrl,
} from '../src/index.ts'
import type { ValidAST } from '../src/types.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    rating: f.number(),
    status: f.enum(['draft', 'published'] as const),
    priority: f.enum([0, 1, 2] as const),
    tags: f.array(f.string()),
    isActive: f.boolean(),
    publishedOn: f.date(),
    occurredAt: f.datetime(),
    intTags: f.array(f.number()),
    statusList: f.array(f.enum(['draft', 'published'] as const)),
  },
})

const evolvedSchema = defineFilterSchema({
  fields: {
    name: f.string(),
    rating: f.number(),
  },
})

describe('COMPACT_KEYS', () => {
  test('locked mapping', () => {
    expect(COMPACT_KEYS).toEqual({
      combinator: 'c',
      children: 'n',
      field: 'f',
      op: 'o',
      value: 'v',
    })
  })
})

describe('toUrl', () => {
  test('returns empty string for empty AST', () => {
    expect(toUrl(emptyAst())).toBe('')
  })

  test('emits compact keys', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    }
    const encoded = toUrl(ast)
    const obj = JSON.parse(encoded)
    expect(obj).toEqual({
      c: 'and',
      n: [{ f: 'title', o: 'eq', v: 'hello' }],
    })
  })

  test('omits v for none-shape ops', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty', value: undefined }],
    }
    const encoded = toUrl(ast)
    const obj = JSON.parse(encoded)
    expect(obj.n[0]).toEqual({ f: 'title', o: 'isEmpty' })
    expect('v' in obj.n[0]).toBe(false)
  })
})

describe('fromUrl', () => {
  test('empty string yields empty AST and no dropped', () => {
    expect(fromUrl('', schema)).toEqual({
      ast: { combinator: 'and', children: [] },
      dropped: [],
    })
  })

  test('round-trip lossless on string-eq', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on multiple value types', () => {
    const ast: ValidAST = {
      combinator: 'or',
      children: [
        { field: 'title', op: 'eq', value: 'hello' },
        { field: 'rating', op: 'between', value: [1, 5] },
        { field: 'status', op: 'in', value: ['draft', 'published'] },
        { field: 'tags', op: 'containsAll', value: ['a', 'b'] },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test.each([
    ['contains',    'hello world'],
    ['notContains', 'foo'],
    ['startsWith',  'foo'],
    ['endsWith',    'bar'],
  ])('round-trip lossless on string %s (single shape)', (op, v) => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: v }],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test.each([
    ['in',    ['a', 'b', 'c']],
    ['notIn', ['x']],
  ])('round-trip lossless on string %s (list shape, JSON array v)', (op, v) => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: v }],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    expect(obj.n[0]).toEqual({ f: 'title', o: op, v })
    expect(Array.isArray(obj.n[0].v)).toBe(true)
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on string in with empty array', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'in', value: [] }],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('string in with non-array v is dropped (value_shape_mismatch)', () => {
    const compact = { c: 'and', n: [{ f: 'title', o: 'in', v: 'foo' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_shape_mismatch')
    expect(result.ast.children).toHaveLength(0)
  })

  test('round-trip lossless on number ops keeps numeric JSON typing', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'rating', op: 'eq',  value: 3 },
        { field: 'rating', op: 'neq', value: 0 },
        { field: 'rating', op: 'gt',  value: 1 },
        { field: 'rating', op: 'gte', value: 2 },
        { field: 'rating', op: 'lt',  value: 9 },
        { field: 'rating', op: 'lte', value: 8 },
        { field: 'rating', op: 'between', value: [1, 5] },
        { field: 'rating', op: 'in',  value: [1, 2, 3] },
      ],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    // No string coercion: numbers remain numbers in the wire JSON.
    for (const child of obj.n) {
      if (Array.isArray(child.v)) {
        expect(child.v.every((x: unknown) => typeof x === 'number')).toBe(true)
      } else {
        expect(typeof child.v).toBe('number')
      }
    }
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('number between with length-3 array is dropped (value_shape_mismatch)', () => {
    const compact = { c: 'and', n: [{ f: 'rating', o: 'between', v: [1, 2, 3] }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_shape_mismatch')
  })

  test.each([true, false])('round-trip lossless on boolean eq with %p', (v) => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: v }],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    expect(typeof obj.n[0].v).toBe('boolean')
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on string-enum and numeric-enum literals', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'status', op: 'eq', value: 'draft' },
        { field: 'priority', op: 'eq', value: 2 },
      ],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    // Discriminants stay in their original JSON type — strings stay strings,
    // numbers stay numbers (no coercion via toString).
    expect(obj.n[0].v).toBe('draft')
    expect(typeof obj.n[1].v).toBe('number')
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('enum in / notIn round-trip preserves the discriminant array', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'status', op: 'in', value: ['draft', 'published'] },
        { field: 'priority', op: 'notIn', value: [0, 1] },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('decoded enum value not in declared list is dropped (value_type_mismatch)', () => {
    const compact = { c: 'and', n: [{ f: 'status', o: 'eq', v: 'archived' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_type_mismatch')
  })

  test('round-trip lossless on date eq + before + after with ISO calendar values', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'publishedOn', op: 'eq',     value: '2026-05-01' },
        { field: 'publishedOn', op: 'before', value: '2026-06-01' },
        { field: 'publishedOn', op: 'after',  value: '2026-04-01' },
      ],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    for (const child of obj.n) {
      expect(typeof child.v).toBe('string')
      expect(child.v).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on date between with calendar pair', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'publishedOn', op: 'between', value: ['2026-05-01', '2026-05-31'] },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on datetime ISO instants', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'occurredAt', op: 'before',  value: '2026-05-01T10:30:00Z' },
        { field: 'occurredAt', op: 'between', value: ['2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'] },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on datetime inLast {amount, unit}', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'occurredAt', op: 'inLast', value: { amount: 7, unit: 'day' } },
      ],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    expect(obj.n[0].v).toEqual({ amount: 7, unit: 'day' })
    expect(typeof obj.n[0].v.amount).toBe('number')
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('decoded date value with wrong format is dropped (value_type_mismatch)', () => {
    const compact = { c: 'and', n: [{ f: 'publishedOn', o: 'eq', v: '05/01/2026' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_type_mismatch')
  })

  test('decoded inLast with disallowed unit is dropped (value_shape_mismatch)', () => {
    const compact = {
      c: 'and',
      n: [{ f: 'occurredAt', o: 'inLast', v: { amount: 1, unit: 'year' } }],
    }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_shape_mismatch')
  })

  test('round-trip lossless on array<string> contains + containsAll + isEmpty', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'tags', op: 'contains', value: 'urgent' },
        { field: 'tags', op: 'containsAll', value: ['a', 'b', 'c'] },
        { field: 'tags', op: 'isEmpty', value: undefined },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on array<number> containsAll keeps numeric typing', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'intTags', op: 'containsAll', value: [1, 2, 3] }],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    expect(obj.n[0].v.every((x: unknown) => typeof x === 'number')).toBe(true)
    const result = fromUrl(url, schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on array<enum> containsAll preserves the discriminants', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'statusList', op: 'containsAll', value: ['draft', 'published'] }],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('schema evolution: op no longer allowed yields op_not_allowed in dropped[]', () => {
    // Original schema allowed string-eq on `title`; pretend the user once
    // typed-narrowed it via withOps and removed `eq`. We model it by
    // decoding a fresh URL against a schema where `title.ops` excludes 'eq'.
    const narrowedSchema = defineFilterSchema({
      fields: {
        title: f.custom({ typeId: 'string', ops: [] }),
      },
    })
    const compact = { c: 'and', n: [{ f: 'title', o: 'eq', v: 'hello' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, narrowedSchema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]).toMatchObject({
      code: 'op_not_allowed',
      field: 'title',
      op: 'eq',
    })
    // Path must point at the offending node so a UI can render context.
    expect(result.dropped[0]?.path).toEqual([0])
    expect(result.ast.children).toHaveLength(0)
  })

  test('round-trip lossless on a custom-typed field with a structured value', () => {
    const moneySchema = defineFilterSchema({
      fields: {
        price: f.custom({
          typeId: 'money',
          ops: [{ name: 'moneyEq', valueShape: 'single', label: 'is' }],
        }),
      },
    })
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        {
          field: 'price',
          op: 'moneyEq',
          value: { amount: 1299, currency: 'USD', tags: ['retail'] },
        },
      ],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(url)
    // The codec is value-shape agnostic: any JSON value is preserved.
    expect(obj.n[0].v).toEqual({ amount: 1299, currency: 'USD', tags: ['retail'] })
    const result = fromUrl(url, moneySchema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('schema evolution: each dropped entry includes a path indexing into the decoded tree', () => {
    const compact = {
      c: 'and',
      n: [
        { f: 'title', o: 'eq', v: 'kept' },
        // Removed field: dropped at [1] in the linear root layout.
        { f: 'mystery', o: 'eq', v: 'x' },
        // Type changed elsewhere: dropped at [2].
        { f: 'rating', o: 'eq', v: 'not-a-number' },
      ],
    }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toEqual([
      { path: [1], code: 'unknown_field', field: 'mystery' },
      { path: [2], code: 'value_type_mismatch', expected: 'number', got: 'string' },
    ])
    // Surviving condition makes it through unchanged.
    expect(result.ast.children).toHaveLength(1)
  })

  test('decoded array<U> with mixed-type elements is dropped (value_type_mismatch)', () => {
    const compact = {
      c: 'and',
      n: [{ f: 'tags', o: 'containsAll', v: ['a', 5] }],
    }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_type_mismatch')
  })

  test('round-trip lossless on (A and B) or C nested shape', () => {
    const ast: ValidAST = {
      combinator: 'or',
      children: [
        {
          combinator: 'and',
          children: [
            { field: 'title', op: 'eq', value: 'hello' },
            { field: 'rating', op: 'gt', value: 3 },
          ],
        },
        { field: 'status', op: 'eq', value: 'published' },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on three-level mixed nesting', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'rating', op: 'gte', value: 1 },
        {
          combinator: 'or',
          children: [
            { field: 'status', op: 'in', value: ['draft', 'published'] },
            {
              combinator: 'and',
              children: [
                { field: 'title', op: 'contains', value: 'foo' },
                { field: 'isActive', op: 'eq', value: true },
              ],
            },
          ],
        },
      ],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on isEmpty (none shape)', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty', value: undefined }],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('round-trip lossless on notEmpty (none shape)', () => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'notEmpty', value: undefined }],
    }
    const result = fromUrl(toUrl(ast), schema)
    expect(result.ast).toEqual(ast)
    expect(result.dropped).toEqual([])
  })

  test('schema evolution: removed field reported in dropped', () => {
    const original: ValidAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'a' },
        { field: 'rating', op: 'eq', value: 5 },
      ],
    }
    const url = toUrl(original)
    const result = fromUrl(url, evolvedSchema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]).toMatchObject({
      code: 'unknown_field',
    })
    expect(result.ast.children).toHaveLength(1)
  })

  test('value type changed reported as value_type_mismatch', () => {
    // Encode a string under field "rating" by manually crafting compact JSON
    const compact = { c: 'and', n: [{ f: 'rating', o: 'eq', v: 'not-a-number' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.code).toBe('value_type_mismatch')
  })

  test('unknown envelope version is reported, not thrown', () => {
    const result = fromUrl(JSON.stringify({ v: 1, ast: {} }), schema)
    expect(result.ast).toEqual(emptyAst())
    expect(result.dropped).toEqual([{ path: [], code: 'unsupported_version', version: 1 }])
    // Legacy-encoded form takes the same path.
    expect(fromUrl(encodeURIComponent('{"v":1}'), schema).dropped[0]?.code)
      .toBe('unsupported_version')
  })

  test('isEmpty with stray v keeps the condition and reports it (same as analyze)', () => {
    const compact = { c: 'and', n: [{ f: 'title', o: 'isEmpty', v: 'oops' }] }
    const result = fromUrl(JSON.stringify(compact), schema)
    expect(result.dropped).toEqual([
      { path: [0], code: 'value_shape_mismatch', op: 'isEmpty', expected: 'none' },
    ])
    expect(result.ast.children).toEqual([{ field: 'title', op: 'isEmpty', value: undefined }])
  })

  test('malformed JSON yields empty AST + parse_error', () => {
    const result = fromUrl('not%20json', schema)
    expect(result.ast).toEqual(emptyAst())
    expect(result.dropped).toEqual([{ path: [], code: 'parse_error' }])
  })

  test('malformed percent-encoding yields parse_error instead of throwing', () => {
    expect(fromUrl('%E0%A4%A', schema).dropped).toEqual([{ path: [], code: 'parse_error' }])
  })

  test('root that is a condition, not a group, is reported', () => {
    const result = fromUrl(JSON.stringify({ f: 'title', o: 'eq', v: 'x' }), schema)
    expect(result.ast).toEqual(emptyAst())
    expect(result.dropped).toEqual([
      { path: [], code: 'invalid_node', message: expect.any(String) },
    ])
  })

  test.each([
    ['null', 'null'],
    ['array', '[]'],
    ['number', '42'],
  ])('root that is %s is reported', (_label, raw) => {
    const result = fromUrl(raw, schema)
    expect(result.ast).toEqual(emptyAst())
    expect(result.dropped[0]?.code).toBe('invalid_node')
  })

  test('malformed nodes are dropped as invalid_node, siblings survive', () => {
    const compact = {
      c: 'and',
      n: [
        'oops',
        { c: 'xor', n: [] },
        { c: 'and', n: 'nope' },
        { f: 5, o: 'eq', v: 1 },
        { f: 'title', o: 'eq', v: 'kept' },
      ],
    }
    const result = fromUrl(JSON.stringify(compact), schema)
    expect(result.dropped.map((d) => [d.path, d.code])).toEqual([
      [[0], 'invalid_node'],
      [[1], 'invalid_node'],
      [[2], 'invalid_node'],
      [[3], 'invalid_node'],
    ])
    expect(result.ast).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'kept' }],
    })
  })

  test('prototype keys are not treated as schema fields', () => {
    const compact = { c: 'and', n: [{ f: 'constructor', o: 'eq', v: 'x' }] }
    const result = fromUrl(JSON.stringify(compact), schema)
    expect(result.dropped[0]).toMatchObject({ code: 'unknown_field', field: 'constructor' })
  })
})

describe('fromUrl limits', () => {
  const nested = (depth: number): unknown => {
    let node: unknown = { f: 'title', o: 'eq', v: 'x' }
    for (let i = 0; i < depth; i++) node = { c: i % 2 ? 'and' : 'or', n: [node, { f: 'rating', o: 'eq', v: i }] }
    return node
  }

  test('20k-deep nesting does not blow the stack', () => {
    // Built as a string: JSON.stringify on a 20k-deep object would itself recurse.
    const depth = 20_000
    const raw = '{"c":"and","n":['.repeat(depth) + '{"f":"title","o":"eq","v":"x"}' + ']}'.repeat(depth)
    let result: ReturnType<typeof fromUrl> | undefined
    expect(() => { result = fromUrl(raw, schema) }).not.toThrow()
    expect(result!.dropped.some((d) => d.code === 'limit_exceeded' || d.code === 'parse_error')).toBe(true)
  })

  test('nesting past maxDepth drops the deep subtree and keeps the rest', () => {
    const result = fromUrl(JSON.stringify(nested(3)), schema, { maxDepth: 2 })
    expect(result.dropped).toEqual([
      { path: [0, 0], code: 'limit_exceeded', limit: 'maxDepth', max: 2 },
    ])
    // Depth-2 group lost its depth-3 child and collapsed to its other child.
    expect(result.ast).toEqual({
      combinator: 'or',
      children: [
        { field: 'rating', op: 'eq', value: 1 },
        { field: 'rating', op: 'eq', value: 2 },
      ],
    })
  })

  test('nodes past maxNodes are dropped with a single report', () => {
    const compact = {
      c: 'and',
      n: Array.from({ length: 10 }, (_, i) => ({ f: 'rating', o: 'eq', v: i })),
    }
    const result = fromUrl(JSON.stringify(compact), schema, { maxNodes: 4 })
    // Root + 3 conditions fit.
    expect(result.ast.children).toHaveLength(3)
    expect(result.dropped).toEqual([
      { path: [3], code: 'limit_exceeded', limit: 'maxNodes', max: 4 },
    ])
  })

  test('list values past maxListLength are dropped', () => {
    const compact = { c: 'and', n: [{ f: 'rating', o: 'in', v: [1, 2, 3] }] }
    const result = fromUrl(JSON.stringify(compact), schema, { maxListLength: 2 })
    expect(result.ast.children).toHaveLength(0)
    expect(result.dropped).toEqual([
      { path: [0], code: 'limit_exceeded', limit: 'maxListLength', max: 2 },
    ])
  })
})

describe('toUrl / fromUrl encoding', () => {
  const ast: ValidAST = {
    combinator: 'and',
    children: [{ field: 'title', op: 'contains', value: '50% off & more' }],
  }

  test('toUrl emits plain JSON, leaving URL encoding to the URL layer', () => {
    expect(toUrl(ast)).toBe('{"c":"and","n":[{"f":"title","o":"contains","v":"50% off & more"}]}')
  })

  test('round-trips values containing % and &', () => {
    expect(fromUrl(toUrl(ast), schema)).toEqual({ ast, dropped: [] })
  })

  test('survives a URLSearchParams round-trip encoded exactly once', () => {
    const qs = new URLSearchParams({ filter: toUrl(ast) }).toString()
    expect(qs.startsWith('filter=%7B%22c%22')).toBe(true)
    const back = new URLSearchParams(qs).get('filter')!
    expect(fromUrl(back, schema)).toEqual({ ast, dropped: [] })
  })

  test('still reads links produced by the old percent-encoding toUrl', () => {
    const legacy = encodeURIComponent(toUrl(ast))
    expect(fromUrl(legacy, schema)).toEqual({ ast, dropped: [] })
  })
})
