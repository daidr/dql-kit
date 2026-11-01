import { exists, notExists, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { OpContext, OpTranslator } from './types.ts'

/**
 * Builds the subquery for one condition: usually a
 * `db.select().from(child).where(and(eq(child.parentId, parent.id), …))`
 * that correlates with the outer table and filters on `value`.
 */
export type SubqueryBuilder = (value: unknown, ctx: OpContext) => SQLWrapper

/**
 * Op handler for a related-row predicate: `EXISTS (subquery)`, e.g.
 * "has at least one comment containing X". Pair it with a field mapped
 * to `null` in `columns` and a custom op name:
 *
 * ```ts
 * ops: {
 *   anyCommentContains: existsOp((v) =>
 *     db.select({ one: sql`1` }).from(comments).where(and(
 *       eq(comments.articleId, articles.id),
 *       ilike(comments.body, `%${String(v)}%`),
 *     ))),
 * }
 * ```
 */
export const existsOp = (build: SubqueryBuilder): OpTranslator =>
  (_col, value, ctx): SQL => exists(build(value, ctx))

/** `NOT EXISTS (subquery)`: no related row matches. */
export const notExistsOp = (build: SubqueryBuilder): OpTranslator =>
  (_col, value, ctx): SQL => notExists(build(value, ctx))
