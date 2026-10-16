import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { defineFilterSchema, f, parseAst, toJsonSchema } from '../src/index.ts'
import type { AstLimits } from '../src/types.ts'
import { mulberry32, randomAst } from './fuzz.ts'

const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    rating: f.number(),
    status: f.enum(['draft', 'published'] as const),
    priority: f.enum([0, 1, 2] as const),
    active: f.boolean(),
    publishedOn: f.date(),
    occurredAt: f.datetime(),
    authorId: f.id<number>(),
    tags: f.array(f.string()),
    states: f.array(f.enum(['draft', 'published'] as const)),
    keyword: f.custom({ typeId: 'fulltext', delegateTo: 'string' }),
    blob: f.custom({ typeId: 'opaque', ops: [
      { name: 'eq', valueShape: 'single', label: 'eq' },
      { name: 'in', valueShape: 'list', label: 'in' },
      { name: 'between', valueShape: 'pair', label: 'between' },
    ] }),
  },
})

const ajv = new Ajv2020({ strict: true })
const check = ajv.compile(toJsonSchema(schema))
const ok = (ast: unknown) => check(ast) === true

const cond = (field: string, op: string, value?: unknown) =>
  ({ combinator: 'and', children: [value === undefined ? { field, op } : { field, op, value }] })

describe('toJsonSchema', () => {
  test('is a valid draft 2020-12 schema under ajv strict mode', () => {
    expect(() => ajv.compile(toJsonSchema(schema, { maxDepth: 3 }))).not.toThrow()
  })

  test('accepts well-typed conditions per value shape', () => {
    expect(ok({ combinator: 'or', children: [] })).toBe(true)
    expect(ok(cond('title', 'contains', 'x'))).toBe(true)
    expect(ok(cond('title', 'isEmpty'))).toBe(true)
    expect(ok(cond('rating', 'between', [1, 2]))).toBe(true)
    expect(ok(cond('status', 'in', ['draft', 'published']))).toBe(true)
    expect(ok(cond('priority', 'eq', 2))).toBe(true)
    expect(ok(cond('publishedOn', 'eq', '2024-01-01'))).toBe(true)
    expect(ok(cond('occurredAt', 'inLast', { amount: 3, unit: 'day' }))).toBe(true)
    expect(ok(cond('authorId', 'in', [1, 'a']))).toBe(true)
    expect(ok(cond('tags', 'containsAll', ['a', 'b']))).toBe(true)
    expect(ok(cond('keyword', 'contains', 'x'))).toBe(true)
    expect(ok(cond('blob', 'eq', { any: 'thing' }))).toBe(true)
  })

  test('rejects what the review flagged as reaching the translator', () => {
    expect(ok(cond('rating', 'contains', 'x'))).toBe(false)
    expect(ok(cond('status', 'eq', 'whatever'))).toBe(false)
    expect(ok(cond('nope', 'eq', 'x'))).toBe(false)
    expect(ok(cond('title', 'isEmpty', 'x'))).toBe(false)
    expect(ok(cond('title', 'eq'))).toBe(false)
    expect(ok(cond('rating', 'between', [1]))).toBe(false)
    expect(ok(cond('publishedOn', 'eq', '2024-1-1'))).toBe(false)
    expect(ok(cond('occurredAt', 'inLast', { amount: 0, unit: 'day' }))).toBe(false)
    expect(ok(cond('occurredAt', 'inLast', { amount: 1, unit: 'year' }))).toBe(false)
    expect(ok(cond('keyword', 'contains', 1))).toBe(false)
    expect(ok(cond('blob', 'eq', [1]))).toBe(false)
    expect(ok(cond('blob', 'eq', { amount: 1, unit: 'day' }))).toBe(false)
    expect(ok({ combinator: 'xor', children: [] })).toBe(false)
  })

  test('bounds nesting depth, group size and list length', () => {
    const limited = ajv.compile(toJsonSchema(schema, { maxDepth: 2, maxNodes: 3, maxListLength: 2 }))
    const leaf = { field: 'title', op: 'eq', value: 'x' }
    expect(limited({ combinator: 'and', children: [{ combinator: 'or', children: [leaf] }] })).toBe(true)
    expect(limited({
      combinator: 'and',
      children: [{ combinator: 'or', children: [{ combinator: 'and', children: [leaf] }] }],
    })).toBe(false)
    expect(limited({ combinator: 'and', children: [leaf, leaf, leaf] })).toBe(false)
    expect(limited(cond('title', 'in', ['a', 'b', 'c']))).toBe(false)
  })

  test('rejects maxDepth below 1', () => {
    expect(() => toJsonSchema(schema, { maxDepth: 0 })).toThrow(RangeError)
  })

  // Default limits, plus tight ones so the corpus actually hits them.
  const LIMIT_SETS: Array<Partial<AstLimits>> = [{}, { maxDepth: 2, maxNodes: 4, maxListLength: 2 }]

  test('is never stricter than parseAst (fuzz)', () => {
    for (const limits of LIMIT_SETS) {
      const validates = ajv.compile(toJsonSchema(schema, limits))
      const rand = mulberry32(42)
      let accepted = 0
      let rejected = 0
      for (let i = 0; i < 20000; i++) {
        const ast = randomAst(schema, rand)
        if (parseAst(ast, schema, limits).ok) {
          accepted++
          if (!validates(ast)) throw new Error(`schema rejected a parseable AST: ${JSON.stringify(ast)}`)
        } else if (!validates(ast)) {
          rejected++
        }
      }
      // Sanity: the corpus exercises both sides.
      expect(accepted).toBeGreaterThan(1000)
      expect(rejected).toBeGreaterThan(1000)
    }
  })

  test('only lets through invalid ASTs it cannot express (fuzz)', () => {
    for (const limits of LIMIT_SETS) {
      const validates = ajv.compile(toJsonSchema(schema, limits))
      const rand = mulberry32(7)
      for (let i = 0; i < 20000; i++) {
        const ast = randomAst(schema, rand)
        if (!validates(ast)) continue
        const result = parseAst(ast, schema, limits)
        if (result.ok) continue
        for (const e of result.errors) {
          const expressible = !(
            (e.code === 'value_type_mismatch' && e.expected === 'datetime')
            || (e.code === 'limit_exceeded' && e.limit === 'maxNodes')
          )
          if (expressible) throw new Error(`${JSON.stringify(e)} in ${JSON.stringify(ast)}`)
        }
      }
    }
  })
})
