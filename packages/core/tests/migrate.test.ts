import { describe, expect, test } from 'bun:test'
import {
  defineFilterSchema,
  f,
  fromUrl,
  parseAst,
  restoreAst,
  toUrl,
  type ValidAST,
} from '../src/index.ts'

// v1: `name` and `state`; v2 renamed `name` → `title` (alias);
// v3 renamed status value 'live' → 'published' (migration).
const v3 = defineFilterSchema({
  version: 3,
  migrations: {
    2: (ast) => {
      const walk = (n: unknown): unknown => {
        if (n == null || typeof n !== 'object') return n
        const node = n as Record<string, unknown>
        if (Array.isArray(node.children)) node.children = node.children.map(walk)
        if (node.field === 'status' && node.value === 'live') node.value = 'published'
        return node
      }
      return walk(ast)
    },
  },
  fields: {
    title: f.string({ aliases: ['name'] }),
    status: f.enum(['draft', 'published'] as const),
  },
})

const ast: ValidAST = {
  combinator: 'and',
  children: [{ field: 'title', op: 'contains', value: 'x' }, { field: 'status', op: 'eq', value: 'draft' }],
}

describe('URL envelope', () => {
  test('a versioned schema writes { v, a } and reads it back', () => {
    const url = toUrl(ast, v3)
    expect(JSON.parse(url)).toEqual({
      v: 3,
      a: { c: 'and', n: [{ f: 'title', o: 'contains', v: 'x' }, { f: 'status', o: 'eq', v: 'draft' }] },
    })
    expect(fromUrl(url, v3)).toEqual({ ast, dropped: [] })
  })

  test('without a schema, or with an unversioned one, toUrl stays bare', () => {
    expect(toUrl(ast)).toBe(JSON.stringify({ c: 'and', n: [{ f: 'title', o: 'contains', v: 'x' }, { f: 'status', o: 'eq', v: 'draft' }] }))
    expect(toUrl(ast, defineFilterSchema({ fields: {} }))).toBe(toUrl(ast))
  })

  test('a bare link is version 0 and runs every migration', () => {
    const old = JSON.stringify({ c: 'and', n: [{ f: 'name', o: 'contains', v: 'x' }, { f: 'status', o: 'eq', v: 'live' }] })
    expect(fromUrl(old, v3)).toEqual({
      ast: { combinator: 'and', children: [{ field: 'title', op: 'contains', value: 'x' }, { field: 'status', op: 'eq', value: 'published' }] },
      dropped: [],
    })
  })

  test('an older envelope runs the remaining migrations only', () => {
    const v2 = JSON.stringify({ v: 2, a: { c: 'and', n: [{ f: 'status', o: 'eq', v: 'live' }] } })
    expect(fromUrl(v2, v3).ast.children).toEqual([{ field: 'status', op: 'eq', value: 'published' }])
  })

  test('newer, malformed and empty envelopes', () => {
    expect(fromUrl(JSON.stringify({ v: 4, a: { c: 'and', n: [] } }), v3).dropped)
      .toEqual([{ path: [], code: 'unsupported_version', version: 4 }])
    expect(fromUrl(JSON.stringify({ v: 1.5, a: {} }), v3).dropped)
      .toEqual([{ path: [], code: 'unsupported_version', version: 1.5 }])
    expect(fromUrl(JSON.stringify({ v: 3 }), v3).dropped).toEqual([{ path: [], code: 'parse_error' }])
  })

  test('a throwing migration is a parse_error, never a throw', () => {
    const s = defineFilterSchema({
      version: 1,
      migrations: { 0: () => { throw new Error('boom') } },
      fields: { title: f.string() },
    })
    expect(fromUrl(JSON.stringify({ c: 'and', n: [] }), s))
      .toEqual({ ast: { combinator: 'and', children: [] }, dropped: [{ path: [], code: 'parse_error' }] })
  })

  test('a deeply nested old link does not overflow during key expansion', () => {
    const depth = 20000
    const raw = '{"c":"and","n":['.repeat(depth) + '{"f":"title","o":"eq","v":"x"}' + ']}'.repeat(depth)
    let r: ReturnType<typeof fromUrl> | undefined
    expect(() => { r = fromUrl(raw, v3) }).not.toThrow()
    expect(r!.ast.children).toEqual([])
    expect(r!.dropped.length).toBeGreaterThan(0)
  })
})

describe('aliases', () => {
  test('read under the old name, written under the new one', () => {
    const r = parseAst({ combinator: 'and', children: [{ field: 'name', op: 'eq', value: 'a' }] }, v3)
    expect(r.ok && r.ast.children).toEqual([{ field: 'title', op: 'eq', value: 'a' }])
  })

  test('a real field wins over an alias, and duplicates are rejected', () => {
    expect(() => defineFilterSchema({
      fields: { a: f.string({ aliases: ['b'] }), b: f.string() },
    })).toThrow(/alias "b" of field "a" is the name of another field/)
    expect(() => defineFilterSchema({
      fields: { a: f.string({ aliases: ['x'] }), b: f.string({ aliases: ['x'] }) },
    })).toThrow(/alias "x" is used by both "a" and "b"/)
  })
})

describe('parseAst / restoreAst with fromVersion', () => {
  const stored = { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'live' }] }

  test('parseAst migrates a stored filter and leaves the input untouched', () => {
    const r = parseAst(stored, v3, { fromVersion: 1 })
    expect(r.ok && r.ast.children).toEqual([{ field: 'status', op: 'eq', value: 'published' }])
    expect(stored.children[0]!.value).toBe('live')
  })

  test('parseAst defaults to the current version and rejects a newer one', () => {
    expect(parseAst(stored, v3).ok).toBe(false)
    expect(parseAst(stored, v3, { fromVersion: 9 })).toEqual({
      ok: false,
      errors: [{ path: [], code: 'unsupported_version', version: 9 }],
    })
  })

  test('restoreAst keeps what survives and reports the rest', () => {
    const r = restoreAst(
      { combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'live' }, { field: 'gone', op: 'eq', value: 1 }] },
      v3,
      { fromVersion: 0 },
    )
    expect(r.ast.children).toEqual([{ field: 'status', op: 'eq', value: 'published' }])
    expect(r.dropped).toEqual([{ path: [1], code: 'unknown_field', field: 'gone' }])
  })
})

describe('defineFilterSchema version checks', () => {
  test('version must be a positive integer and migrations must fit below it', () => {
    expect(() => defineFilterSchema({ version: 0, fields: {} })).toThrow(/positive integer/)
    expect(() => defineFilterSchema({ version: 2, migrations: { 2: (a) => a }, fields: {} })).toThrow(/migrations\[2\]/)
    expect(() => defineFilterSchema({ migrations: { 0: (a) => a }, fields: {} })).toThrow(/migrations\[0\]/)
  })
})
