import { describe, expect, test } from 'bun:test'
import {
  analyze,
  builtinOps,
  defineFilterSchema,
  defineOp,
  f,
  fromUrl,
  isCondition,
  isGroup,
  parseAst,
  type CheckedAST,
  type ConditionOf,
  type FieldScalar,
  type OpDef,
  type ValidAST,
  type ValidCondition,
  type ValidNode,
} from '../src/index.ts'

// Compile-time assertions. These run under `tsc` (see tsconfig.test.json);
// the bun test bodies only make sure the runtime agrees with the types.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const assertType = <T extends true>(): T | void => {}

const scoreOp = defineOp('scoreAbove', 'single')

const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    views: f.number(),
    pin: f.boolean(),
    pinOrNull: f.boolean({ nullable: true }),
    status: f.enum(['draft', 'published'] as const),
    day: f.date(),
    createdAt: f.datetime(),
    authorId: f.id<number>(),
    tags: f.array(f.string()),
    keyword: f.custom({
      typeId: 'keywordSearch',
      delegateTo: 'string',
      ops: [builtinOps.contains, builtinOps.eq],
    }),
    fulltext: f.custom({ typeId: 'fulltext', delegateTo: 'string' }),
    raw: f.custom({ typeId: 'raw', ops: [builtinOps.eq] }),
    loose: f.custom({ typeId: 'loose', delegateTo: 'string', ops: [builtinOps.eq] as OpDef[] }),
    rating: f.number().withOps([scoreOp]),
  },
})
type S = typeof schema
type Cond = ValidCondition<S>
type ValueOf<K extends Cond['field'], O extends Extract<Cond, { field: K }>['op']> =
  Extract<Cond, { field: K, op: O }>['value']

describe('typed AST: compile-time narrowing', () => {
  test('field keys and op names are narrowed per field', () => {
    assertType<Equal<Cond['field'], keyof S['fields']>>()
    assertType<Equal<
      Extract<Cond, { field: 'title' }>['op'],
      'eq' | 'neq' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
      | 'isEmpty' | 'notEmpty' | 'in' | 'notIn'
    >>()
    assertType<Equal<Extract<Cond, { field: 'pin' }>['op'], 'eq'>>()
    assertType<Equal<Extract<Cond, { field: 'keyword' }>['op'], 'contains' | 'eq'>>()
    assertType<Equal<Extract<Cond, { field: 'rating' }>['op'],
      'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'notBetween' | 'in' | 'notIn'
      | 'scoreAbove'>>()
    assertType<Equal<Extract<Cond, { field: 'pinOrNull' }>['op'], 'eq' | 'isEmpty' | 'notEmpty'>>()
    assertType<Equal<Extract<Cond, { field: 'tags' }>['op'],
      'contains' | 'notContains' | 'containsAll' | 'containsAny' | 'isEmpty' | 'notEmpty'>>()
  })

  test('values follow the op shape and field scalar', () => {
    assertType<Equal<ValueOf<'title', 'contains'>, string>>()
    assertType<Equal<ValueOf<'title', 'in'>, string[]>>()
    assertType<Equal<ValueOf<'title', 'isEmpty'>, undefined>>()
    assertType<Equal<ValueOf<'views', 'between'>, [number, number]>>()
    assertType<Equal<ValueOf<'status', 'eq'>, 'draft' | 'published'>>()
    assertType<Equal<ValueOf<'status', 'in'>, ('draft' | 'published')[]>>()
    assertType<Equal<ValueOf<'authorId', 'in'>, number[]>>()
    assertType<Equal<ValueOf<'tags', 'contains'>, string>>()
    assertType<Equal<ValueOf<'tags', 'containsAll'>, string[]>>()
    assertType<Equal<ValueOf<'createdAt', 'inLast'>,
      { amount: number, unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' }>>()
    assertType<Equal<ValueOf<'day', 'inLast'>,
      { amount: number, unit: 'day' | 'week' | 'month' | 'year' }>>()
    assertType<Equal<ValueOf<'tags', 'containsAny'>, string[]>>()
    assertType<Equal<ValueOf<'day', 'inPeriod'>,
      { unit: 'day' | 'week' | 'month' | 'quarter' | 'year', offset: number }>>()
    assertType<Equal<ValueOf<'createdAt', 'inPeriod'>, ValueOf<'day', 'inPeriod'>>>()
    assertType<Equal<ValueOf<'views', 'notBetween'>, [number, number]>>()
    assertType<Equal<ValueOf<'fulltext', 'startsWith'>, string>>()
    assertType<Equal<ValueOf<'raw', 'eq'>, unknown>>()
    assertType<Equal<ValueOf<'rating', 'scoreAbove'>, number>>()
    assertType<Equal<FieldScalar<S['fields']['day']>, string>>()
  })

  test('ops typed as the open OpDef fall back to the loose form', () => {
    assertType<Equal<Extract<Cond, { field: 'loose' }>,
      { field: 'loose', op: string, value?: unknown }>>()
  })

  test('the open schema keeps the loose structural shape', () => {
    assertType<Equal<ValidCondition, { field: string, op: string, value?: unknown }>>()
    assertType<Equal<ConditionOf<S, 'pin'>, { field: 'pin', op: 'eq', value: boolean }>>()
  })

  test('typed ASTs reject mismatched field / op / value', () => {
    const ok: ValidAST<S> = {
      combinator: 'and',
      children: [
        { field: 'status', op: 'in', value: ['draft'] },
        { field: 'title', op: 'isEmpty' },
        {
          combinator: 'or',
          children: [
            { field: 'views', op: 'between', value: [1, 10] },
            { field: 'createdAt', op: 'inLast', value: { amount: 7, unit: 'day' } },
          ],
        },
      ],
    }
    const bad: ValidNode<S>[] = [
      // @ts-expect-error unknown field
      { field: 'nope', op: 'eq', value: 1 },
      // @ts-expect-error op not allowed on a number field
      { field: 'views', op: 'contains', value: 'x' },
      // @ts-expect-error value outside the enum
      { field: 'status', op: 'eq', value: 'whatever' },
      // @ts-expect-error pair op needs a tuple
      { field: 'views', op: 'between', value: 1 },
      // @ts-expect-error id<number> rejects strings
      { field: 'authorId', op: 'eq', value: '1' },
      // @ts-expect-error unit outside the whitelist
      { field: 'createdAt', op: 'inLast', value: { amount: 1, unit: 'decade' } },
      // @ts-expect-error date fields take no sub-day units
      { field: 'day', op: 'inLast', value: { amount: 1, unit: 'hour' } },
      // @ts-expect-error period unit outside the whitelist
      { field: 'createdAt', op: 'inPeriod', value: { unit: 'decade', offset: 0 } },
      // @ts-expect-error none-shape op takes no value
      { field: 'title', op: 'isEmpty', value: 'x' },
    ]
    // Typed ASTs stay assignable to the loose form consumed by adapters.
    const loose: ValidAST = ok
    expect(loose.children).toHaveLength(3)
    expect(bad).toHaveLength(9)
  })

  test('narrowing on field then op narrows value', () => {
    const visit = (node: ValidNode<S>): string[] => {
      if (isGroup(node)) return node.children.flatMap(visit)
      if (node.field === 'status' && node.op === 'in') {
        const values: ('draft' | 'published')[] = node.value
        return values
      }
      return []
    }
    const ast: ValidAST<S> = {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: ['published'] }],
    }
    expect(visit(ast)).toEqual(['published'])
  })
})

describe('typed AST: entry points return schema-typed ASTs', () => {
  test('analyze / fromUrl are typed by the schema they check against', () => {
    const { ast } = analyze(
      { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'draft' }] },
      schema,
    )
    assertType<Equal<typeof ast, ValidAST<S>>>()
    const fromLink = fromUrl('', schema).ast
    assertType<Equal<typeof fromLink, ValidAST<S>>>()
    const parsed = parseAst({ combinator: 'and', children: [] }, schema)
    if (parsed.ok) {
      assertType<Equal<typeof parsed.ast, CheckedAST<S>>>()
      // A checked AST of a typed schema still fits the loose CheckedAST.
      const loose: CheckedAST = parsed.ast
      expect(loose.children).toEqual([])
    } else {
      throw new Error('expected parseAst to accept an empty group')
    }

    const first = ast.children[0]!
    if (isCondition(first)) {
      assertType<Equal<typeof first, Cond>>()
      expect(first).toEqual({ field: 'status', op: 'eq', value: 'draft' })
    } else {
      throw new Error('expected a condition')
    }
  })

  test('runtime ops match the typed op lists', () => {
    expect(schema.fields.keyword.ops.map((o) => o.name)).toEqual(['contains', 'eq'])
    expect(schema.fields.fulltext.ops.map((o) => o.name)).toContain('startsWith')
    expect(schema.fields.rating.ops.map((o) => o.name)).toContain('scoreAbove')
    expect(schema.fields.keyword.delegateTo).toBe('string')
    // withOps returns a copy; the base field is untouched.
    const base = f.number()
    base.withOps([scoreOp])
    expect(base.ops.map((o) => o.name)).not.toContain('scoreAbove')
  })
})

describe('typed AST: nullable with explicit type arguments', () => {
  test('f.id<ID>({ nullable: true }) and f.enum<V>(…, { nullable: true }) add the null ops', () => {
    const s = defineFilterSchema({
      fields: {
        owner: f.id<number>({ nullable: true }),
        plain: f.id<number>(),
        kind: f.enum<'a' | 'b'>(['a', 'b'], { nullable: true }),
      },
    })
    type C = ValidCondition<typeof s>
    assertType<Equal<Extract<C, { field: 'owner' }>['op'], 'eq' | 'neq' | 'in' | 'notIn' | 'isEmpty' | 'notEmpty'>>()
    assertType<Equal<Extract<C, { field: 'plain' }>['op'], 'eq' | 'neq' | 'in' | 'notIn'>>()
    assertType<Equal<Extract<C, { field: 'kind' }>['op'], 'eq' | 'neq' | 'in' | 'notIn' | 'isEmpty' | 'notEmpty'>>()
    assertType<Equal<Extract<C, { field: 'owner', op: 'eq' }>['value'], number>>()
    expect(s.fields.owner.ops.map((o) => o.name)).toContain('isEmpty')
  })
})
