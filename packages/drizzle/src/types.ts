import type { CheckedAST, FieldDef, FilterSchema } from '@dql-kit/core'
import type { AnyColumn, SQL } from 'drizzle-orm'

export type AnyDrizzleTable = {
  [key: string]: AnyColumn
} & object

export type ColumnMap<F extends FilterSchema['fields']> = {
  [K in keyof F]?: AnyColumn
}

// Context passed to op translators. Adapters can branch on field.typeId
// (e.g. `contains` is ILIKE for string fields but `= ANY(col)` for array
// fields). Custom ops may ignore the third argument; TS tolerates fewer-
// param functions assigned here.
export type OpContext = { field: FieldDef }

export type OpTranslator = (col: AnyColumn, value: unknown, ctx: OpContext) => SQL

/**
 * Map of op name → custom SQL translator. Keys passed here override or
 * extend the built-in `drizzleOps`. This is the construction-time
 * channel for adding/overriding ops; there is no mutating
 * `registerOp` after construction by design (immutable translators
 * are safer in async-import / lazy-load codebases).
 */
export type OpMap = Record<string, OpTranslator>

export type CreateTranslatorOptions<S extends FilterSchema> =
  | { schema: S, table: AnyDrizzleTable, columns?: ColumnMap<S['fields']>, ops?: OpMap }
  | { schema: S, columns: ColumnMap<S['fields']>, ops?: OpMap }

export type Translator = {
  /**
   * Translate a parsed AST into a WHERE fragment. Only accepts the
   * output of `parseAst` from `@dql-kit/core`: run untrusted input
   * (request bodies, stored filters) through it first.
   */
  toWhere: (ast: CheckedAST) => SQL
}
