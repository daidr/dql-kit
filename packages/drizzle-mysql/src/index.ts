import { createTranslatorFactory } from '@dql-kit/drizzle-common'
import { drizzleOps } from './ops.ts'

/** Build a MySQL translator for a schema. See the README. */
export const createDrizzleTranslator = createTranslatorFactory('drizzle-mysql', drizzleOps)
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
