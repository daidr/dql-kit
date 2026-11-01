import { builtinOps, defineFilterSchema, defineOp, f, parseAst, type CheckedAST, type ValidAST } from '@dql-kit/core'
import { PGlite } from '@electric-sql/pglite'
import { and, eq, ilike, sql } from 'drizzle-orm'
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, test } from 'vitest'
import { createDrizzleTranslator, drizzleOps, existsOp, notExistsOp } from '../src/index.ts'

const articles = pgTable('articles', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
})
const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').notNull(),
  body: text('body').notNull(),
})

const anyCommentContains = defineOp('anyCommentContains', 'single', 'any comment contains')
const noCommentContains = defineOp('noCommentContains', 'single', 'no comment contains')

const schema = defineFilterSchema({
  fields: {
    title: f.string(),
    comments: f.custom({
      typeId: 'relation',
      delegateTo: 'string',
      ops: [anyCommentContains, noCommentContains],
    }),
    keyword: f.custom({ typeId: 'fulltext', delegateTo: 'string', ops: [builtinOps.contains] }),
  },
})

const checked = (ast: ValidAST): CheckedAST => ast as CheckedAST

let client: PGlite
let db: ReturnType<typeof drizzle>

const commentMatching = (v: unknown) =>
  db.select({ one: sql`1` }).from(comments).where(and(
    eq(comments.articleId, articles.id),
    ilike(comments.body, `%${String(v)}%`),
  ))

const translator = () => createDrizzleTranslator({
  schema,
  table: articles,
  columns: { comments: null, keyword: null },
  ops: {
    anyCommentContains: existsOp(commentMatching),
    noCommentContains: notExistsOp(commentMatching),
    contains: (col, v, ctx) => {
      if (ctx.field.typeId === 'fulltext') {
        const pattern = `%${String(v)}%`
        return sql`(${articles.title} ILIKE ${pattern} OR ${articles.body} ILIKE ${pattern})`
      }
      return drizzleOps.contains!(col, v, ctx)
    },
  },
})

beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client)
  await client.exec(`
    CREATE TABLE articles (id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE comments (id SERIAL PRIMARY KEY, article_id INTEGER NOT NULL, body TEXT NOT NULL);
    INSERT INTO articles (title, body) VALUES ('one', 'alpha'), ('two', 'beta'), ('three', 'gamma');
    INSERT INTO comments (article_id, body) VALUES (1, 'great post'), (1, 'meh'), (2, 'GREAT stuff');
  `)
})

const ids = async (ast: ValidAST) => {
  const rows = await db.select({ id: articles.id }).from(articles).where(translator().toWhere(checked(ast))).orderBy(articles.id)
  return rows.map((r) => r.id)
}

describe('existsOp / notExistsOp', () => {
  test('EXISTS matches parents with at least one matching child', async () => {
    expect(await ids({
      combinator: 'and',
      children: [{ field: 'comments', op: 'anyCommentContains', value: 'great' }],
    })).toEqual([1, 2])
  })

  test('NOT EXISTS matches parents with no matching child, including childless ones', async () => {
    expect(await ids({
      combinator: 'and',
      children: [{ field: 'comments', op: 'noCommentContains', value: 'great' }],
    })).toEqual([3])
  })

  test('combines with column conditions and parses from untrusted input', async () => {
    const parsed = parseAst({
      combinator: 'or',
      children: [
        { field: 'comments', op: 'anyCommentContains', value: 'meh' },
        { field: 'title', op: 'eq', value: 'three' },
      ],
    }, schema)
    if (!parsed.ok) throw new Error('expected ok')
    const rows = await db.select({ id: articles.id }).from(articles).where(translator().toWhere(parsed.ast)).orderBy(articles.id)
    expect(rows.map((r) => r.id)).toEqual([1, 3])
  })

  test('the subquery builder gets the value and the op context', () => {
    const seen: unknown[] = []
    const t = createDrizzleTranslator({
      schema,
      table: articles,
      columns: { comments: null, keyword: null },
      ops: {
        anyCommentContains: existsOp((v, ctx) => {
          seen.push(v, ctx.field.typeId)
          return commentMatching(v)
        }),
        noCommentContains: notExistsOp(commentMatching),
        contains: (_col, v) => sql`${v}`,
      },
    })
    t.toWhere(checked({ combinator: 'and', children: [{ field: 'comments', op: 'anyCommentContains', value: 'x' }] }))
    expect(seen).toEqual(['x', 'relation'])
  })
})

describe('fields mapped to null', () => {
  test('a custom handler gets col undefined and can search several columns', async () => {
    expect(await ids({
      combinator: 'and',
      children: [{ field: 'keyword', op: 'contains', value: 'gamm' }],
    })).toEqual([3])
    // `title` still goes through the built-in handler.
    expect(await ids({
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: 'tw' }],
    })).toEqual([2])
  })

  test('construction throws when an op of a null-mapped field has no custom handler', () => {
    expect(() => createDrizzleTranslator({
      schema,
      table: articles,
      columns: { comments: null, keyword: null },
      ops: { anyCommentContains: existsOp(commentMatching) },
    })).toThrow(/Field "comments" is mapped to null[\s\S]*Missing: noCommentContains/)
  })

  test('a built-in handler called without a column throws clearly', () => {
    const t = createDrizzleTranslator({
      schema,
      table: articles,
      columns: { comments: null, keyword: null },
      ops: {
        anyCommentContains: existsOp(commentMatching),
        noCommentContains: notExistsOp(commentMatching),
        // Forgot to branch on the fulltext field.
        contains: (col, v, ctx) => drizzleOps.contains!(col, v, ctx),
      },
    })
    expect(() => t.toWhere(checked({
      combinator: 'and',
      children: [{ field: 'keyword', op: 'contains', value: 'x' }],
    }))).toThrow(/Built-in op "contains" needs a column/)
  })
})
