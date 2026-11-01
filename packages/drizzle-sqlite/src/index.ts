import { createTranslatorFactory } from '@dql-kit/drizzle-common'
import { drizzleOps } from './ops.ts'

/** Build a SQLite translator for a schema. See the README. */
export const createDrizzleTranslator = createTranslatorFactory('drizzle-sqlite', drizzleOps)
export { drizzleOps }
export { existsOp, notExistsOp, type SubqueryBuilder } from '@dql-kit/drizzle-common'
export type {
  AnyDrizzleTable,
  CalendarTranslatorOptions,
  ColumnMap,
  CreateTranslatorOptions,
  OpContext,
  OpMap,
  OpTranslator,
  Translator,
} from '@dql-kit/drizzle-common'
