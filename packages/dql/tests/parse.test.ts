import { describe, expect, test } from 'bun:test'
import { parse } from '../src/parse.ts'
import type { ConditionRanges, GroupRanges } from '../src/types.ts'

const condAt = (
  result: ReturnType<typeof parse>,
  pathKey: string,
): ConditionRanges =>
  result.ranges.get(pathKey) as ConditionRanges

const groupAt = (
  result: ReturnType<typeof parse>,
  pathKey: string,
): GroupRanges =>
  result.ranges.get(pathKey) as GroupRanges

describe('parse — empty / whitespace-only', () => {
  test('empty document → empty root group', () => {
    const r = parse('')
    expect(r.draft).toEqual({ combinator: 'and', children: [] })
    expect(r.syntaxDiag).toEqual([])
    expect(groupAt(r, '').whole).toEqual({ from: 0, to: 0 })
  })

  test('whitespace-only', () => {
    const r = parse('   \n\t')
    expect(r.draft).toEqual({ combinator: 'and', children: [] })
    expect(r.syntaxDiag).toEqual([])
  })
})

describe('parse — single condition', () => {
  test('field op value (string)', () => {
    const r = parse('title contains "hello"')
    expect(r.draft).toEqual({
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: 'hello' }],
    })
    expect(r.syntaxDiag).toEqual([])

    const cr = condAt(r, '0')
    expect(cr.field).toEqual({ from: 0, to: 5 })
    expect(cr.op).toEqual({ from: 6, to: 14 })
    expect(cr.value).toEqual({ from: 15, to: 22 })
    expect(cr.whole).toEqual({ from: 0, to: 22 })
  })

  test('= is sugar for eq', () => {
    const r = parse('count = 5')
    expect(r.draft.children[0]).toEqual({ field: 'count', op: 'eq', value: 5 })
  })

  test('!= is sugar for neq', () => {
    const r = parse('count != 5')
    expect(r.draft.children[0]).toEqual({ field: 'count', op: 'neq', value: 5 })
  })

  test('boolean value', () => {
    const r = parse('isActive = true')
    expect(r.draft.children[0]).toEqual({ field: 'isActive', op: 'eq', value: true })
  })

  test('number value', () => {
    const r = parse('rating gte 4.5')
    expect(r.draft.children[0]).toEqual({ field: 'rating', op: 'gte', value: 4.5 })
  })

  test('none-shape op (isEmpty) leaves value undefined', () => {
    const r = parse('name isEmpty')
    expect(r.draft.children[0]).toEqual({ field: 'name', op: 'isEmpty' })
    expect(r.syntaxDiag).toEqual([])
  })
})

describe('parse — list value', () => {
  test('in [string, string]', () => {
    const r = parse('status in ["draft", "published"]')
    expect(r.draft.children[0]).toEqual({
      field: 'status',
      op: 'in',
      value: ['draft', 'published'],
    })
  })

  test('numeric list', () => {
    const r = parse('priority in [0, 1, 2]')
    expect(r.draft.children[0]).toEqual({
      field: 'priority',
      op: 'in',
      value: [0, 1, 2],
    })
  })

  test('empty list', () => {
    const r = parse('status in []')
    expect(r.draft.children[0]).toEqual({
      field: 'status',
      op: 'in',
      value: [],
    })
  })

  test('trailing comma is tolerated', () => {
    const r = parse('status in ["a", "b",]')
    expect(r.draft.children[0]).toEqual({
      field: 'status',
      op: 'in',
      value: ['a', 'b'],
    })
  })

  test('unmatched [ produces unmatched_bracket diag', () => {
    const r = parse('status in ["a", "b"')
    expect(r.syntaxDiag.some((d) => d.code === 'unmatched_bracket')).toBe(true)
  })
})

describe('parse — pair (range)', () => {
  test('numeric range', () => {
    const r = parse('count between 1..10')
    expect(r.draft.children[0]).toEqual({
      field: 'count',
      op: 'between',
      value: [1, 10],
    })
  })

  test('quoted-string date range', () => {
    const r = parse('publishedAt between "2024-01-01".."2024-12-31"')
    expect(r.draft.children[0]).toEqual({
      field: 'publishedAt',
      op: 'between',
      value: ['2024-01-01', '2024-12-31'],
    })
  })

  test('range without right endpoint reports diag', () => {
    const r = parse('count between 1..')
    expect(r.syntaxDiag.some((d) => d.code === 'expected_range_endpoint')).toBe(true)
  })
})

describe('parse — relative (inLast 7 days)', () => {
  test('plural unit normalised to singular', () => {
    const r = parse('publishedAt inLast 7 days')
    expect(r.draft.children[0]).toEqual({
      field: 'publishedAt',
      op: 'inLast',
      value: { amount: 7, unit: 'day' },
    })
  })

  test('singular unit unchanged', () => {
    const r = parse('publishedAt inLast 1 day')
    expect(r.draft.children[0]).toEqual({
      field: 'publishedAt',
      op: 'inLast',
      value: { amount: 1, unit: 'day' },
    })
  })
})

describe('parse — connectors and grouping', () => {
  test('two AND-connected conditions', () => {
    const r = parse('title contains "x" and rating = 5')
    expect(r.draft).toEqual({
      combinator: 'and',
      children: [
        { field: 'title', op: 'contains', value: 'x' },
        { field: 'rating', op: 'eq', value: 5 },
      ],
    })
  })

  test('OR is recognised', () => {
    const r = parse('a = 1 or b = 2')
    expect(r.draft.combinator).toBe('or')
    expect(r.draft.children).toHaveLength(2)
  })

  test('mixed and/or at one level → mixed_combinator diag', () => {
    const r = parse('a = 1 and b = 2 or c = 3')
    expect(r.syntaxDiag.some((d) => d.code === 'mixed_combinator')).toBe(true)
    // Parser still produces 3 children using the first connector.
    expect(r.draft.combinator).toBe('and')
    expect(r.draft.children).toHaveLength(3)
  })

  test('nested group with parens', () => {
    const r = parse('(a = 1 or b = 2) and c = 3')
    expect(r.draft.combinator).toBe('and')
    expect(r.draft.children).toHaveLength(2)
    const inner = r.draft.children[0] as { combinator: string, children: unknown[] }
    expect(inner.combinator).toBe('or')
    expect(inner.children).toHaveLength(2)
  })

  test('unmatched ( reports unmatched_paren', () => {
    const r = parse('(a = 1')
    expect(r.syntaxDiag.some((d) => d.code === 'unmatched_paren')).toBe(true)
  })

  test('unmatched ) reports unmatched_paren', () => {
    const r = parse('a = 1)')
    expect(r.syntaxDiag.some((d) => d.code === 'unmatched_paren')).toBe(true)
  })
})

describe('parse — incomplete conditions (mid-edit)', () => {
  test('field only', () => {
    const r = parse('title')
    expect(r.draft.children[0]).toEqual({ field: 'title', op: null })
    // No syntax error — incomplete is a semantic concern (analyze layer).
    expect(r.syntaxDiag).toEqual([])
  })

  test('field + op, no value', () => {
    const r = parse('title contains')
    expect(r.draft.children[0]).toEqual({ field: 'title', op: 'contains' })
    expect(r.syntaxDiag).toEqual([])
  })

  test('field + op + space mid-typing keeps op slot filled', () => {
    const r = parse('title contains ')
    expect(r.draft.children[0]).toEqual({ field: 'title', op: 'contains' })
  })

  test('field + and + EOF (incomplete second condition)', () => {
    const r = parse('title = "x" and ')
    expect(r.syntaxDiag.some((d) => d.code === 'expected_field')).toBe(true)
    expect(r.draft.children).toHaveLength(1)
  })
})

describe('parse — error recovery', () => {
  test('reserved word as field reports specifically', () => {
    const r = parse('and contains "x"')
    expect(r.syntaxDiag.some((d) => d.code === 'expected_field')).toBe(true)
  })

  test('garbage between conditions is skipped', () => {
    const r = parse('a = 1 ??? b = 2')
    // Parser keeps both conditions, garbage emits diag.
    const validKids = r.draft.children.filter(
      (c) => 'field' in c && c.op === 'eq',
    )
    expect(validKids).toHaveLength(2)
    expect(r.syntaxDiag.length).toBeGreaterThan(0)
  })

  test('trailing tokens after complete expression', () => {
    // After `a = 1`, lone `5` is unexpected. Either trailing_garbage or
    // unexpected_token depending on the recovery path.
    const r = parse('a = 1 5')
    expect(r.syntaxDiag.length).toBeGreaterThan(0)
  })
})

describe('parse — RangeMap correctness', () => {
  test('every condition has whole/field/op/value sub-ranges when present', () => {
    const r = parse('title contains "hi"')
    const cr = condAt(r, '0')
    expect(cr.whole).toBeDefined()
    expect(cr.field).toBeDefined()
    expect(cr.op).toBeDefined()
    expect(cr.value).toBeDefined()
  })

  test('incomplete condition still has whole + field, no value', () => {
    const r = parse('title contains')
    const cr = condAt(r, '0')
    expect(cr.whole).toBeDefined()
    expect(cr.field).toBeDefined()
    expect(cr.op).toBeDefined()
    expect(cr.value).toBeUndefined()
  })

  test('nested group has whole range covering parens', () => {
    const r = parse('(a = 1 or b = 2) and c = 3')
    const gr = groupAt(r, '0')
    expect(gr.whole.from).toBe(0)
    expect(gr.whole.to).toBe(16) // includes closing `)`
  })

  test('root group whole spans the document', () => {
    const text = 'a = 1 and b = 2'
    const r = parse(text)
    expect(groupAt(r, '').whole).toEqual({ from: 0, to: text.length })
  })

  test('child paths follow `i.j` form with correct order', () => {
    const r = parse('(a = 1 or b = 2) and c = 3')
    // children[0] is a group at path "0" — has GroupRanges
    // children[0].children[0] / [1] are conditions at "0.0" / "0.1"
    // children[1] is condition at "1"
    expect(r.ranges.has('0')).toBe(true)
    expect(r.ranges.has('0.0')).toBe(true)
    expect(r.ranges.has('0.1')).toBe(true)
    expect(r.ranges.has('1')).toBe(true)
  })
})

describe('parse — full integration round-trip with core schema', () => {
  test('representative document parses cleanly', () => {
    const text =
      '(title contains "hello" or status in ["draft", "published"]) and rating between 1..10'
    const r = parse(text)
    expect(r.syntaxDiag).toEqual([])
    expect(r.draft.combinator).toBe('and')
    expect(r.draft.children).toHaveLength(2)
  })
})
