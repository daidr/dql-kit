import type { FieldDef, FilterSchema, ValidAST } from '@dql-kit/core'
import type { AnyColumn, SQL } from 'drizzle-orm'

export type AnyDrizzleTable = {
  [key: string]: AnyColumn
} & object

export type ColumnMap<F extends FilterSchema['fields']> = {
  [K in keyof F]?: AnyColumn
}

// Context passed to op translators. Adapters can branch on field.typeId
// (e.g. `contains` is ILIKE for string fields but `= ANY(col)` for array
// fields). Custom ops registered via `registerOp` may ignore the third
// argument; TS tolerates fewer-param functions assigned here.
export type OpContext = { field: FieldDef }

export type OpTranslator = (col: AnyColumn, value: unknown, ctx: OpContext) => SQL

export type CreateTranslatorOptions<S extends FilterSchema> =
  | { schema: S, table: AnyDrizzleTable, columns?: ColumnMap<S['fields']> }
  | { schema: S, columns: ColumnMap<S['fields']> }

export type Translator = {
  toWhere: (ast: ValidAST) => SQL
  registerOp: (name: string, translator: OpTranslator) => void
}
