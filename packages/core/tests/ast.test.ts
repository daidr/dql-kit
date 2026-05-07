import { describe, expect, test } from 'bun:test'
import {
  astRefersTo,
  defineFilterSchema,
  emptyAst,
  emptyDraft,
  f,
  prune,
  validate,
} from '../src/index.ts'
import type { DraftAST } from '../src/types.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string({ label: 'Title' }),
    rating: f.number({ label: 'Rating' }),
    status: f.enum(['draft', 'published'] as const, { label: 'Status' }),
    tags: f.array(f.string()),
    isActive: f.boolean({ label: 'Active' }),
    priority: f.enum([0, 1, 2] as const, { label: 'Priority' }),
    publishedOn: f.date({ label: 'Published on' }),
    occurredAt: f.datetime({ label: 'Occurred at' }),
    intTags: f.array(f.number()),
    statusList: f.array(f.enum(['draft', 'published'] as const)),
  },
})

describe('emptyAst / emptyDraft', () => {
  test('both produce a root and-group with no children', () => {
    expect(emptyAst()).toEqual({ combinator: 'and', children: [] })
    expect(emptyDraft()).toEqual({ combinator: 'and', children: [] })
  })
})

describe('prune', () => {
  test('preserves the root group even when empty', () => {
    expect(prune(emptyDraft(), schema)).toEqual({ combinator: 'and', children: [] })
  })

  test('drops conditions with null field', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: null, op: null }],
    }
    expect(prune(draft, schema)).toEqual({ combinator: 'and', children: [] })
  })

  test('drops conditions with missing value (non-none op)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq' }],
    }
    expect(prune(draft, schema)).toEqual({ combinator: 'and', children: [] })
  })

  test('keeps a complete string-eq condition', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    }
    expect(prune(draft, schema)).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'hello' }],
    })
  })

  test('drops conditions with unknown field', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'nope', op: 'eq', value: 'x' }],
    }
    expect(prune(draft, schema)).toEqual({ combinator: 'and', children: [] })
  })

  test('drops conditions with disallowed op', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'gt', value: 'x' }],
    }
    expect(prune(draft, schema)).toEqual({ combinator: 'and', children: [] })
  })

  test('drops conditions with type-mismatched value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'eq', value: 'not-a-number' }],
    }
    expect(prune(draft, schema)).toEqual({ combinator: 'and', children: [] })
  })

  test('keeps an enum eq with known value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'draft' }],
    }
    const out = prune(draft, schema)
    expect(out.children).toHaveLength(1)
  })

  test('drops enum eq with unknown value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'archived' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('flattens single-child non-root group (hoists)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        {
          combinator: 'or',
          children: [{ field: 'title', op: 'eq', value: 'a' }],
        },
      ],
    }
    const out = prune(draft, schema)
    expect(out).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a' }],
    })
  })

  test('drops empty non-root group', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { combinator: 'or', children: [] },
        { field: 'title', op: 'eq', value: 'a' },
      ],
    }
    const out = prune(draft, schema)
    expect(out.children).toHaveLength(1)
    expect(out.children[0]).toEqual({ field: 'title', op: 'eq', value: 'a' })
  })

  test('idempotent: prune(prune(x)) === prune(x)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'a' },
        { field: null, op: null },
        {
          combinator: 'or',
          children: [{ field: 'rating', op: 'gt', value: 4 }],
        },
      ],
    }
    const once = prune(draft, schema)
    const twice = prune(once as unknown as DraftAST, schema)
    expect(twice).toEqual(once)
  })

  test('array<string> containsAll keeps a list of strings', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'containsAll', value: ['a', 'b'] }],
    }
    const out = prune(draft, schema)
    expect(out.children).toHaveLength(1)
  })

  test('array<string> containsAll drops non-string list element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'containsAll', value: ['a', 5] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('array<string> contains keeps a single string', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'contains', value: 'a' }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('isEmpty op accepts no value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty' }],
    }
    const out = prune(draft, schema)
    expect(out.children).toHaveLength(1)
    const cond = out.children[0] as { field: string, op: string, value: unknown }
    expect(cond.op).toBe('isEmpty')
    expect(cond.value).toBeUndefined()
  })

  test('isEmpty op normalises stray value to undefined (lenient prune)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty', value: 'leftover' }],
    }
    const out = prune(draft, schema)
    expect(out.children).toHaveLength(1)
    const cond = out.children[0] as { field: string, op: string, value: unknown }
    expect(cond.value).toBeUndefined()
  })

  test.each([
    ['contains',    'foo'],
    ['notContains', 'foo'],
    ['startsWith',  'foo'],
    ['endsWith',    'foo'],
  ])('string %s with single string value is kept', (op, v) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: v }],
    }
    const out = prune(draft, schema)
    expect(out.children).toHaveLength(1)
  })

  test.each([
    ['contains'],
    ['startsWith'],
    ['endsWith'],
  ])('string %s with non-string value is dropped', (op) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: 5 }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test.each([
    ['in'],
    ['notIn'],
  ])('string %s keeps an array of strings', (op) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: ['a', 'b'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test.each([
    ['in'],
    ['notIn'],
  ])('string %s drops a non-array value (shape mismatch)', (op) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op, value: 'foo' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('string in drops an array containing a non-string element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'in', value: ['a', 5] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('string in keeps an empty array (well-formed list shape)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'in', value: [] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test.each([
    ['eq',  3],
    ['neq', 3],
    ['gt',  3],
    ['gte', 3],
    ['lt',  3],
    ['lte', 3],
  ])('number %s with finite numeric value is kept', (op, v) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op, value: v }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('number eq drops a non-finite value (NaN, Infinity)', () => {
    const draftNaN: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'eq', value: Number.NaN }],
    }
    expect(prune(draftNaN, schema).children).toHaveLength(0)
    const draftInf: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'eq', value: Number.POSITIVE_INFINITY }],
    }
    expect(prune(draftInf, schema).children).toHaveLength(0)
  })

  test('number between keeps a length-2 numeric tuple', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [1, 5] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('number between drops a length-3 array (shape mismatch)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [1, 2, 3] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('number between drops when an element is not numeric', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [1, 'oops'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('number in keeps a numeric array', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'in', value: [1, 2, 3] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('number in drops an array containing a non-number', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'in', value: [1, '2'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test.each([true, false])('boolean eq with %p is kept', (v) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: v }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('boolean eq with non-boolean value is dropped', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: 'true' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('enum eq drops a value not in the declared list', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'archived' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('numeric enum keeps a known numeric value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'priority', op: 'eq', value: 1 }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('numeric enum drops an unknown numeric value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'priority', op: 'eq', value: 9 }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('enum in keeps a list of known values', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: ['draft', 'published'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('enum in drops a list containing an unknown value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: ['draft', 'archived'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test.each([
    ['eq',     '2026-05-01'],
    ['before', '2026-05-01'],
    ['after',  '2026-05-01'],
  ])('date %s with ISO calendar value is kept', (op, v) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'publishedOn', op, value: v }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('date eq drops a non-ISO-calendar string', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'publishedOn', op: 'eq', value: '05/01/2026' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('date eq drops a datetime instant string (wrong field type)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'publishedOn', op: 'eq', value: '2026-05-01T10:30:00Z' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('date between with a length-2 calendar tuple is kept', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'publishedOn', op: 'between', value: ['2026-05-01', '2026-05-31'] },
      ],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test.each([
    ['before', '2026-05-01T10:30:00Z'],
    ['after',  '2026-05-01T10:30:00Z'],
  ])('datetime %s with ISO instant is kept', (op, v) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op, value: v }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('datetime between with two ISO instants is kept', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        {
          field: 'occurredAt',
          op: 'between',
          value: ['2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'],
        },
      ],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('datetime before drops a non-parseable value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'before', value: 'not-a-date' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test.each([
    ['minute'],
    ['hour'],
    ['day'],
    ['week'],
    ['month'],
  ])('datetime inLast with unit %s is kept', (unit) => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'occurredAt', op: 'inLast', value: { amount: 7, unit } },
      ],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('datetime inLast drops an unsupported unit (year)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 1, unit: 'year' } }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('datetime inLast drops a non-positive amount', () => {
    const zero: DraftAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'inLast', value: { amount: 0, unit: 'day' } }],
    }
    expect(prune(zero, schema).children).toHaveLength(0)
    const negative: DraftAST = {
      combinator: 'and',
      children: [{ field: 'occurredAt', op: 'inLast', value: { amount: -1, unit: 'day' } }],
    }
    expect(prune(negative, schema).children).toHaveLength(0)
  })

  test('datetime inLast rejects SQL-injection-shaped unit', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        {
          field: 'occurredAt',
          op: 'inLast',
          value: { amount: 1, unit: "day' OR '1'='1" },
        },
      ],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('array<string> contains keeps a single string element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'contains', value: 'a' }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('array<string> contains drops a non-string element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'contains', value: 5 }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('array<number> contains keeps a single numeric element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'intTags', op: 'contains', value: 7 }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('array<number> contains drops a string-typed element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'intTags', op: 'contains', value: '7' }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('array<enum> containsAll keeps a list of declared discriminants', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'statusList', op: 'containsAll', value: ['draft', 'published'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('array<enum> containsAll drops a list with an unknown discriminant', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'statusList', op: 'containsAll', value: ['draft', 'archived'] }],
    }
    expect(prune(draft, schema).children).toHaveLength(0)
  })

  test('array isEmpty (none shape) is kept with no value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'isEmpty' }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })

  test('array<number> containsAll with empty array is kept (well-formed list)', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'intTags', op: 'containsAll', value: [] }],
    }
    expect(prune(draft, schema).children).toHaveLength(1)
  })
})

describe('validate', () => {
  test('returns ok:true for a valid draft', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(true)
  })

  test('returns incomplete error for missing field', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: null, op: null }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'incomplete', missing: 'field', path: [0] })
    }
  })

  test('returns unknown_field error', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'nope', op: 'eq', value: 'x' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'unknown_field', field: 'nope' })
    }
  })

  test('returns op_not_allowed error', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'gt', value: 'x' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'op_not_allowed' })
    }
  })

  test('returns value_type_mismatch error', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'eq', value: 'foo' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'value_type_mismatch',
        expected: 'number',
        got: 'string',
      })
    }
  })

  test('returns value_shape_mismatch error', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: 5 }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'value_shape_mismatch' })
    }
  })

  test('reports value_shape_mismatch for "in" with non-array value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'in', value: 'foo' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'value_shape_mismatch',
        op: 'in',
        expected: 'list',
      })
    }
  })

  test('reports value_shape_mismatch for "isEmpty" with stray value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty', value: 'oops' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'value_shape_mismatch',
        op: 'isEmpty',
        expected: 'none',
      })
    }
  })

  test('treats isEmpty without value as valid', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'isEmpty' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(true)
  })

  test('reports value_type_mismatch for string "in" with non-string array element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'in', value: ['a', 5] }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('value_type_mismatch')
    }
  })

  test('reports value_shape_mismatch for number "between" with non-tuple', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [1, 2, 3] }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'value_shape_mismatch',
        op: 'between',
        expected: 'pair',
      })
    }
  })

  test('reports value_type_mismatch for number "between" with non-numeric element', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'rating', op: 'between', value: [1, 'x'] }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('value_type_mismatch')
    }
  })

  test('reports value_type_mismatch for unknown enum value', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'archived' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'value_type_mismatch',
        expected: 'enum',
      })
    }
  })

  test('reports value_type_mismatch on array<U> contains with wrong element type', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'intTags', op: 'contains', value: 'oops' }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'value_type_mismatch',
        expected: 'array<number>',
      })
    }
  })

  test('reports value_type_mismatch on array<U> containsAll with mixed-type elements', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'tags', op: 'containsAll', value: ['a', 5] }],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('value_type_mismatch')
    }
  })

  test('reports paths into nested groups', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'eq', value: 'a' },
        {
          combinator: 'or',
          children: [{ field: 'nope', op: 'eq', value: 'x' }],
        },
      ],
    }
    const result = validate(draft, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.path).toEqual([1, 0])
    }
  })
})

describe('astRefersTo', () => {
  test('finds top-level field reference', () => {
    const ast = {
      combinator: 'and' as const,
      children: [{ field: 'title', op: 'eq', value: 'x' }],
    }
    expect(astRefersTo(ast, 'title')).toBe(true)
    expect(astRefersTo(ast, 'rating')).toBe(false)
  })

  test('finds nested field reference', () => {
    const ast = {
      combinator: 'and' as const,
      children: [
        {
          combinator: 'or' as const,
          children: [{ field: 'rating', op: 'gt', value: 5 }],
        },
      ],
    }
    expect(astRefersTo(ast, 'rating')).toBe(true)
  })

  test('returns false on empty ast', () => {
    expect(astRefersTo(emptyAst(), 'anything')).toBe(false)
  })
})
