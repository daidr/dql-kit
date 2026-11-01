import { describe, expect, test } from 'bun:test'
import {
  builtinOps,
  createMatcher,
  defineFilterSchema,
  defineOp,
  f,
  parseAst,
  type CheckedAST,
  type ValidAST,
} from '../src/index.ts'
import { rootOf, semanticsCases, semanticsRows, semanticsSchema } from './semantics/cases.ts'

const now = new Date('2026-03-31T12:00:00Z')

describe('createMatcher — shared semantics cases', () => {
  const matcher = createMatcher({ schema: semanticsSchema, now: () => now })
  const rows = semanticsRows(now)

  test.each(semanticsCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = parseAst(rootOf(c.node), semanticsSchema)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    expect(matcher.filter(parsed.ast, rows).map((r) => r.id)).toEqual(c.expected)
  })
})

describe('createMatcher', () => {
  const schema = defineFilterSchema({
    fields: {
      title: f.string(),
      day: f.date(),
      at: f.datetime(),
      score: f.number().withOps([defineOp('isEven', 'none')]),
    },
  })
  const parse = (ast: unknown): CheckedAST<typeof schema> => {
    const r = parseAst(ast, schema)
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    return r.ast
  }
  const one = (field: string, op: string, value?: unknown) =>
    parse({ combinator: 'and', children: [{ field, op, value }] })

  test('empty root group matches every row', () => {
    const m = createMatcher({ schema })
    expect(m.matches(parse({ combinator: 'and', children: [] }), {})).toBe(true)
    expect(m.matches(parse({ combinator: 'or', children: [] }), {})).toBe(true)
  })

  test('date and datetime row values may be Date objects or strings', () => {
    const m = createMatcher({ schema })
    expect(m.matches(one('day', 'eq', '2024-01-31'), { day: new Date('2024-01-31T18:00:00Z') })).toBe(true)
    expect(m.matches(one('day', 'eq', '2024-01-31'), { day: '2024-01-31' })).toBe(true)
    expect(m.matches(one('at', 'before', '2024-01-31T00:00:00Z'), { at: new Date('2024-01-30T23:00:00Z') })).toBe(true)
  })

  test('an unparseable row date never matches', () => {
    const m = createMatcher({ schema })
    expect(m.matches(one('at', 'before', '2024-01-31T00:00:00Z'), { at: 'garbage' })).toBe(false)
    expect(m.matches(one('day', 'eq', '2024-01-31'), { day: 'garbage' })).toBe(false)
  })

  test('inLast month is calendar-aware and clamps to the shorter month', () => {
    // 2024-03-31 minus one month is 2024-02-29 (as in PostgreSQL).
    const m = createMatcher({ schema, now: () => new Date('2024-03-31T00:00:00Z') })
    const ast = one('at', 'inLast', { amount: 1, unit: 'month' })
    expect(m.matches(ast, { at: '2024-02-29T00:00:00Z' })).toBe(true)
    expect(m.matches(ast, { at: '2024-02-28T23:59:59Z' })).toBe(false)
  })

  test('filter reads the clock once per call', () => {
    let calls = 0
    const m = createMatcher({ schema, now: () => { calls++; return new Date() } })
    m.filter(one('at', 'inLast', { amount: 1, unit: 'day' }), [{ at: null }, { at: null }, { at: null }])
    expect(calls).toBe(1)
  })

  test('get reads values from custom row shapes', () => {
    const m = createMatcher({
      schema,
      get: (row: { data: Record<string, unknown> }, key) => row.data[key],
    })
    expect(m.matches(one('title', 'eq', 'x'), { data: { title: 'x' } })).toBe(true)
  })

  test('custom ops are passed at construction and may override built-ins', () => {
    const m = createMatcher({
      schema,
      ops: {
        isEven: (actual) => typeof actual === 'number' && actual % 2 === 0,
        contains: (actual, value) => actual === `<${String(value)}>`,
      },
    })
    expect(m.matches(one('score', 'isEven'), { score: 4 })).toBe(true)
    expect(m.matches(one('score', 'isEven'), { score: 3 })).toBe(false)
    expect(m.matches(one('title', 'contains', 'x'), { title: '<x>' })).toBe(true)
  })

  test('throws for an op with no matcher', () => {
    const m = createMatcher({ schema })
    expect(() => m.matches(one('score', 'isEven'), { score: 2 })).toThrow(/No matcher registered for op "isEven"/)
  })

  test('throws for an op the field does not declare (cast AST)', () => {
    const m = createMatcher({ schema })
    const ast = {
      combinator: 'and',
      children: [{ field: 'title', op: 'gt', value: 'a' }],
    } as ValidAST as CheckedAST<typeof schema>
    expect(() => m.matches(ast, { title: 'b' })).toThrow(/Op "gt" is not allowed on field "title"/)
  })

  test('throws for an unknown field (cast AST)', () => {
    const m = createMatcher({ schema })
    const ast = {
      combinator: 'and',
      children: [{ field: 'nope', op: 'eq', value: 'a' }],
    } as ValidAST as CheckedAST<typeof schema>
    expect(() => m.matches(ast, {})).toThrow(/unknown field "nope"/)
  })

  test('custom delegated fields follow their builtin', () => {
    const s = defineFilterSchema({
      fields: { kw: f.custom({ typeId: 'fulltext', delegateTo: 'string', ops: [builtinOps.contains] }) },
    })
    const m = createMatcher({ schema: s })
    const r = parseAst({ combinator: 'and', children: [{ field: 'kw', op: 'contains', value: 'AB' }] }, s)
    if (!r.ok) throw new Error('parse')
    expect(m.matches(r.ast, { kw: 'xaby' })).toBe(true)
  })
})
