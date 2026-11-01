import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { builtinOps, defineFilterSchema, defineOp, f, parseAst, type CheckedAST, type ValidAST } from '@dql-kit/core'
import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createDrizzleTranslator, existsOp, notExistsOp } from '../src/index.ts'

const checked = (ast: ValidAST): CheckedAST => ast as CheckedAST
const one = (field: string, op: string, value?: unknown): ValidAST =>
  ({ combinator: 'and', children: [{ field, op, value } as never] })

const articles = sqliteTable('articles', {
  id: integer('id').primaryKey(),
  title: text('title'),
  code: text('code'),
  // Seconds precision.
  publishedAt: integer('published_at', { mode: 'timestamp' }),
})
const comments = sqliteTable('comments', {
  id: integer('id').primaryKey(),
  articleId: integer('article_id').notNull(),
  body: text('body').notNull(),
})

const anyCommentContains = defineOp('anyCommentContains', 'single')
const noCommentContains = defineOp('noCommentContains', 'single')
const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    code: f.string({ caseSensitive: true }),
    publishedAt: f.datetime({ nullable: true }),
    comments: f.custom({ typeId: 'relation', delegateTo: 'string', ops: [anyCommentContains, noCommentContains] }),
  },
})

const client = new Database(':memory:')
const db = drizzle(client)
client.run(`
  CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, code TEXT, published_at INTEGER);
  CREATE TABLE comments (id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL, body TEXT NOT NULL);
`)
db.insert(articles).values([
  { id: 1, title: 'Ünïcode Title', code: 'abc', publishedAt: new Date('2024-01-01T10:00:00Z') },
  { id: 2, title: 'under_score', code: 'ABC', publishedAt: new Date('2024-06-01T10:00:00Z') },
  { id: 3, title: 'back\\slash', code: 'xabc', publishedAt: null },
]).run()
db.insert(comments).values([{ id: 1, articleId: 1, body: 'nice' }, { id: 2, articleId: 3, body: 'NICE one' }]).run()

const commentMatching = (v: unknown) =>
  db.select({ one: sql`1` }).from(comments)
    .where(and(eq(comments.articleId, articles.id), sql`${comments.body} LIKE ${`%${String(v)}%`}`))

const t = createDrizzleTranslator({
  schema,
  table: articles,
  columns: { comments: null },
  ops: { anyCommentContains: existsOp(commentMatching), noCommentContains: notExistsOp(commentMatching) },
})
const ids = (ast: ValidAST) =>
  db.select({ id: articles.id }).from(articles).where(t.toWhere(checked(ast))).orderBy(asc(articles.id)).all().map((r) => r.id)

describe('drizzle-sqlite — dialect details', () => {
  test('LIKE escapes _ and backslash', () => {
    expect(ids(one('title', 'contains', '_'))).toEqual([2])
    expect(ids(one('title', 'contains', '\\'))).toEqual([3])
  })

  test('case-sensitive substring ops avoid LIKE', () => {
    expect(ids(one('code', 'contains', 'bc'))).toEqual([1, 3])
    expect(ids(one('code', 'startsWith', 'AB'))).toEqual([2])
    expect(ids(one('code', 'endsWith', 'abc'))).toEqual([1, 3])
    expect(ids(one('code', 'endsWith', 'xxabc'))).toEqual([])
    expect(ids(one('code', 'endsWith', ''))).toEqual([1, 2, 3])
  })

  test('integer timestamp columns take instants', () => {
    expect(ids(one('publishedAt', 'before', '2024-03-01T00:00:00Z'))).toEqual([1])
    expect(ids(one('publishedAt', 'onOrAfter', '2024-01-01T10:00:00Z'))).toEqual([1, 2])
  })

  test('relative ops on instants use the translator clock', () => {
    const at = createDrizzleTranslator({ schema, table: articles, columns: { comments: null }, now: () => new Date('2024-06-02T00:00:00Z'), ops: {
      anyCommentContains: existsOp(commentMatching), noCommentContains: notExistsOp(commentMatching),
    } })
    const rows = db.select({ id: articles.id }).from(articles)
      .where(at.toWhere(checked(one('publishedAt', 'inLast', { amount: 1, unit: 'week' })))).all()
    expect(rows.map((r) => r.id)).toEqual([2])
  })

  test('existsOp and notExistsOp', () => {
    expect(ids(one('comments', 'anyCommentContains', 'nice'))).toEqual([1, 3])
    expect(ids(one('comments', 'noCommentContains', 'one'))).toEqual([1, 2])
  })

  test('parses and translates untrusted input', () => {
    const parsed = parseAst({ combinator: 'or', children: [
      { field: 'title', op: 'startsWith', value: 'UNDER' },
      { field: 'publishedAt', op: 'isEmpty' },
    ] }, schema)
    if (!parsed.ok) throw new Error('expected ok')
    expect(db.select({ id: articles.id }).from(articles).where(t.toWhere(parsed.ast)).orderBy(asc(articles.id)).all()
      .map((r) => r.id)).toEqual([2, 3])
  })

  test('an op without a translator fails at construction', () => {
    const custom = defineFilterSchema({ fields: { title: f.string().withOps([builtinOps.eq, defineOp('fuzzy', 'single')]) } })
    expect(() => createDrizzleTranslator({ schema: custom, table: articles }))
      .toThrow(/\[dql-kit\/drizzle-sqlite\] No SQL translator registered for op "fuzzy" on field "title"/)
  })
})
