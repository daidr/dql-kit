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
    const json = decodeURIComponent(encoded)
    const obj = JSON.parse(json)
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
    const obj = JSON.parse(decodeURIComponent(encoded))
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
    const obj = JSON.parse(decodeURIComponent(url))
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
    expect(result.dropped[0]?.reason).toBe('value_shape_mismatch')
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
    const obj = JSON.parse(decodeURIComponent(url))
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
    expect(result.dropped[0]?.reason).toBe('value_shape_mismatch')
  })

  test.each([true, false])('round-trip lossless on boolean eq with %p', (v) => {
    const ast: ValidAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: v }],
    }
    const url = toUrl(ast)
    const obj = JSON.parse(decodeURIComponent(url))
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
    const obj = JSON.parse(decodeURIComponent(url))
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
    expect(result.dropped[0]?.reason).toBe('value_type_mismatch')
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
      reason: 'unknown_field',
    })
    expect(result.ast.children).toHaveLength(1)
  })

  test('value type changed reported as value_type_mismatch', () => {
    // Encode a string under field "rating" by manually crafting compact JSON
    const compact = { c: 'and', n: [{ f: 'rating', o: 'eq', v: 'not-a-number' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe('value_type_mismatch')
  })

  test('version envelope is recognized and rejected by stub', () => {
    const compact = { v: 1, ast: {} }
    const url = encodeURIComponent(JSON.stringify(compact))
    expect(() => fromUrl(url, schema)).toThrow(/envelope version 1/)
  })

  test('isEmpty with stray v is dropped', () => {
    const compact = { c: 'and', n: [{ f: 'title', o: 'isEmpty', v: 'oops' }] }
    const url = encodeURIComponent(JSON.stringify(compact))
    const result = fromUrl(url, schema)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe('value_shape_mismatch')
    expect(result.ast.children).toHaveLength(0)
  })

  test('malformed JSON yields empty AST + drop entry', () => {
    const result = fromUrl('not%20json', schema)
    expect(result.ast).toEqual(emptyAst())
    expect(result.dropped).toHaveLength(1)
  })
})
