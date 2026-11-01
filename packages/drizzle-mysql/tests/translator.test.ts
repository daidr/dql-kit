import { builtinOps, defineFilterSchema, defineOp, f, type CheckedAST, type ValidAST } from '@dql-kit/core'
import { and, asc, eq, sql } from 'drizzle-orm'
import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDrizzleTranslator, existsOp, notExistsOp } from '../src/index.ts'
import { connect, mysqlUrl } from './db.ts'

const checked = (ast: ValidAST): CheckedAST => ast as CheckedAST
const one = (field: string, op: string, value?: unknown): ValidAST =>
  ({ combinator: 'and', children: [{ field, op, value } as never] })

const articles = mysqlTable('dk_articles', {
  id: int('id').primaryKey(),
  title: varchar('title', { length: 255 }),
  code: varchar('code', { length: 255 }),
})
const comments = mysqlTable('dk_comments', {
  id: int('id').primaryKey(),
  articleId: int('article_id').notNull(),
  body: varchar('body', { length: 255 }).notNull(),
})

const anyCommentContains = defineOp('anyCommentContains', 'single')
const noCommentContains = defineOp('noCommentContains', 'single')
const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    code: f.string({ caseSensitive: true }),
    comments: f.custom({ typeId: 'relation', delegateTo: 'string', ops: [anyCommentContains, noCommentContains] }),
  },
})

describe.skipIf(!mysqlUrl)('drizzle-mysql — dialect details', () => {
  let conn: Awaited<ReturnType<typeof connect>>
  const commentMatching = (v: unknown) =>
    conn.db.select({ one: sql`1` }).from(comments)
      .where(and(eq(comments.articleId, articles.id), sql`${comments.body} LIKE ${`%${String(v)}%`}`))
  const translator = () => createDrizzleTranslator({
    schema,
    table: articles,
    columns: { comments: null },
    ops: { anyCommentContains: existsOp(commentMatching), noCommentContains: notExistsOp(commentMatching) },
  })
  const ids = async (ast: ValidAST) =>
    (await conn.db.select({ id: articles.id }).from(articles).where(translator().toWhere(checked(ast))).orderBy(asc(articles.id)))
      .map((r) => r.id)

  beforeAll(async () => {
    conn = await connect()
    await conn.pool.query(`
      DROP TABLE IF EXISTS dk_articles;
      DROP TABLE IF EXISTS dk_comments;
      CREATE TABLE dk_articles (id INT PRIMARY KEY, title VARCHAR(255), code VARCHAR(255));
      CREATE TABLE dk_comments (id INT PRIMARY KEY, article_id INT NOT NULL, body VARCHAR(255) NOT NULL);
    `)
    await conn.db.insert(articles).values([
      { id: 1, title: 'Wow!', code: 'abc' },
      { id: 2, title: 'under_score', code: 'ABC' },
      { id: 3, title: 'back\\slash', code: 'xabc' },
    ])
    await conn.db.insert(comments).values([{ id: 1, articleId: 1, body: 'nice' }, { id: 2, articleId: 3, body: 'NICE one' }])
  })

  afterAll(async () => {
    await conn?.pool.end()
  })

  test('LIKE escapes _, ! and backslash', async () => {
    expect(await ids(one('title', 'contains', '_'))).toEqual([2])
    expect(await ids(one('title', 'endsWith', '!'))).toEqual([1])
    expect(await ids(one('title', 'contains', '\\'))).toEqual([3])
  })

  test('patterns also work under NO_BACKSLASH_ESCAPES', async () => {
    await conn.pool.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',NO_BACKSLASH_ESCAPES')")
    try {
      // The `!` escape doesn't depend on the mode. (A backslash *value*
      // is a driver matter: the driver escapes it client-side assuming the
      // default mode.)
      expect(await ids(one('title', 'contains', '_'))).toEqual([2])
      expect(await ids(one('title', 'endsWith', '!'))).toEqual([1])
    } finally {
      await conn.pool.query("SET SESSION sql_mode = REPLACE(@@sql_mode, 'NO_BACKSLASH_ESCAPES', '')")
    }
  })

  test('caseSensitive compares as binary under a _ci collation', async () => {
    expect(await ids(one('code', 'eq', 'abc'))).toEqual([1])
    expect(await ids(one('code', 'in', ['ABC', 'nope']))).toEqual([2])
    expect(await ids(one('code', 'startsWith', 'AB'))).toEqual([2])
    expect(await ids(one('code', 'contains', 'bc'))).toEqual([1, 3])
    expect(await ids(one('title', 'eq', 'WOW!'))).toEqual([1])
  })

  test('existsOp and notExistsOp', async () => {
    expect(await ids(one('comments', 'anyCommentContains', 'nice'))).toEqual([1, 3])
    expect(await ids(one('comments', 'noCommentContains', 'one'))).toEqual([1, 2])
  })

  test('an op without a translator fails at construction', () => {
    const custom = defineFilterSchema({ fields: { title: f.string().withOps([builtinOps.eq, defineOp('fuzzy', 'single')]) } })
    expect(() => createDrizzleTranslator({ schema: custom, table: articles }))
      .toThrow(/\[dql-kit\/drizzle-mysql\] No SQL translator registered for op "fuzzy" on field "title"/)
  })
})
