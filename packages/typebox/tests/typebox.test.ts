import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { defineFilterSchema, f, toJsonSchema, type ValidAST } from '@dql-kit/core'
import type { Static } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { toTypeBox } from '../src/index.ts'
import { mulberry32, randomAst } from '../../core/tests/fuzz.ts'

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
    keyword: f.custom({ typeId: 'fulltext', delegateTo: 'string' }),
    blob: f.custom({ typeId: 'opaque', ops: [
      { name: 'eq', valueShape: 'single', label: 'eq' },
      { name: 'between', valueShape: 'pair', label: 'between' },
    ] }),
  },
})

describe('toTypeBox', () => {
  test('compiles with the TypeBox compiler', () => {
    expect(() => TypeCompiler.Compile(toTypeBox(schema))).not.toThrow()
  })

  test('accepts exactly what the JSON Schema accepts (fuzz)', () => {
    const limits = { maxDepth: 3, maxNodes: 4, maxListLength: 3 }
    const tb = TypeCompiler.Compile(toTypeBox(schema, { limits }))
    const ajv = new Ajv2020().compile(toJsonSchema(schema, limits))
    const rand = mulberry32(1)
    let accepted = 0
    for (let i = 0; i < 20000; i++) {
      const ast = randomAst(schema, rand, 4)
      const a = ajv(ast) === true
      if (tb.Check(ast) !== a) {
        throw new Error(`ajv=${a} typebox=${!a} for ${JSON.stringify(ast)}`)
      }
      if (a) accepted++
    }
    expect(accepted).toBeGreaterThan(1000)
  })

  test('sets schemaOptions on every node', () => {
    const t = toTypeBox(schema, { schemaOptions: { error: 'bad filter' } })
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (node === null || typeof node !== 'object') return
      const n = node as Record<string, unknown>
      if ('type' in n || 'anyOf' in n || 'const' in n || 'not' in n) expect(n.error).toBe('bad filter')
      for (const [k, v] of Object.entries(n)) if (k !== 'error') visit(v)
    }
    visit(t)
  })

  test('static type is the schema-derived Valid AST', () => {
    const t = toTypeBox(schema)
    const ast: Static<typeof t> = {
      combinator: 'and',
      children: [
        { field: 'status', op: 'in', value: ['draft'] },
        { combinator: 'or', children: [{ field: 'title', op: 'isEmpty' }] },
      ],
    }
    // @ts-expect-error `contains` is not a number op
    const bad: Static<typeof t> = { combinator: 'and', children: [{ field: 'rating', op: 'contains', value: 'x' }] }
    const loose: ValidAST = ast
    expect(TypeCompiler.Compile(t).Check(loose)).toBe(true)
    expect(TypeCompiler.Compile(t).Check(bad)).toBe(false)
  })
})
