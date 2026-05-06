import type { FilterSchema, ValidAST } from '@dql-kit/core'
import type { AnyColumn, SQL } from 'drizzle-orm'

export type AnyDrizzleTable = {
  [key: string]: AnyColumn
} & object

export type ColumnMap<F extends FilterSchema['fields']> = {
  [K in keyof F]?: AnyColumn
}

export type OpTranslator = (col: AnyColumn, value: unknown) => SQL

export type CreateTranslatorOptions<S extends FilterSchema> =
  | { schema: S, table: AnyDrizzleTable, columns?: ColumnMap<S['fields']> }
  | { schema: S, columns: ColumnMap<S['fields']> }

export type Translator = {
  toWhere: (ast: ValidAST) => SQL
  registerOp: (name: string, translator: OpTranslator) => void
}
