import { describe, expect, test } from 'bun:test'
import {
  createMatcher,
  defineFilterSchema,
  f,
  omitFields,
  pickFields,
  parseAst,
  type CheckedAST,
  type FilterSchema,
} from '../src/index.ts'

const full = defineFilterSchema({
  version: 2,
  migrations: { 1: (ast) => ast },
  groups: {
    content: { label: 'Content', order: 1 },
    money: { label: 'Money', order: 2 },
  },
  fields: {
    title: f.string({ group: 'content', aliases: ['name'] }),
    status: f.enum(['draft', 'published'] as const, { group: 'content' }),
    salary: f.number({ group: 'money' }),
    owner: f.string(),
  },
})

describe('pickFields / omitFields', () => {
  test('pickFields keeps only the listed fields and the groups they use', () => {
    const sub = pickFields(full, ['title', 'owner'])
    expect(Object.keys(sub.fields)).toEqual(['title', 'owner'])
    expect(sub.groups).toEqual({ content: { label: 'Content', order: 1 } })
    expect(sub.fields.title).toBe(full.fields.title)
    expect(sub.version).toBe(2)
    expect(sub.migrations).toBe(full.migrations)
  })

  test('omitFields keeps everything else, in declaration order', () => {
    const sub = omitFields(full, ['salary'])
    expect(Object.keys(sub.fields)).toEqual(['title', 'status', 'owner'])
    expect(Object.keys(sub.groups)).toEqual(['content'])
  })

  test('the original schema is left untouched', () => {
    omitFields(full, ['salary', 'title'])
    expect(Object.keys(full.fields)).toHaveLength(4)
    expect(Object.keys(full.groups)).toEqual(['content', 'money'])
  })

  test('an unknown key throws', () => {
    expect(() => pickFields(full, ['nope' as 'title'])).toThrow(/"nope" is not a field/)
    expect(() => omitFields(full, ['nope' as 'title'])).toThrow(/"nope" is not a field/)
  })

  test('an unversioned schema stays unversioned', () => {
    const plain = defineFilterSchema({ fields: { a: f.string(), b: f.number() } })
    const sub = pickFields(plain, ['a'])
    expect('version' in sub).toBe(false)
    expect('migrations' in sub).toBe(false)
  })

  test('parsing against a subset rejects out-of-role fields as unknown_field', () => {
    const role = omitFields(full, ['salary'])
    const input = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'contains', value: 'x' },
        { field: 'salary', op: 'gt', value: 100 },
      ],
    }
    const res = parseAst(input, role)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors).toEqual([{ path: [1], code: 'unknown_field', field: 'salary' }])
    expect(parseAst(input, full).ok).toBe(true)
  })

  test('aliases of kept fields still resolve; aliases of removed ones do not', () => {
    const input = { combinator: 'and', children: [{ field: 'name', op: 'eq', value: 'x' }] }
    const withTitle = parseAst(input, pickFields(full, ['title']))
    expect(withTitle.ok && withTitle.ast.children[0]).toEqual({ field: 'title', op: 'eq', value: 'x' })
    const withoutTitle = parseAst(input, omitFields(full, ['title']))
    expect(withoutTitle.ok).toBe(false)
  })

  test('a subset-checked AST runs on a matcher built for the full schema', () => {
    const role = pickFields(full, ['title', 'status'])
    const res = parseAst(
      { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'draft' }] },
      role,
    )
    if (!res.ok) throw new Error('expected ok')
    const matcher = createMatcher({ schema: full })
    // Compile-time: CheckedAST of the subset is a CheckedAST of the full schema.
    const ast: CheckedAST<typeof full> = res.ast
    expect(matcher.matches(ast, { title: 'a', status: 'draft', salary: 1, owner: 'o' })).toBe(true)
    expect(matcher.matches(ast, { title: 'a', status: 'published', salary: 1, owner: 'o' })).toBe(false)
  })

  test('the result is a FilterSchema of the subset type', () => {
    const sub: FilterSchema<Pick<typeof full.fields, 'title'>> = pickFields(full, ['title'])
    // @ts-expect-error salary is not part of the subset
    void sub.fields.salary
    expect(sub.fields.title.typeId).toBe('string')
  })
})
