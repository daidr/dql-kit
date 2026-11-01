// Dialect-neutral internals of the dql-kit Drizzle adapters. Each
// adapter supplies a `Dialect` and re-exports the public pieces.
export { createTranslatorFactory } from './translator.ts'
export {
  buildOps,
  checkRelative,
  effectiveTypeId,
  escapeLike,
  foldsCase,
  guardOps,
  isDayField,
  orNull,
  type Dialect,
  type RelativeValue,
} from './ops.ts'
export { existsOp, notExistsOp, type SubqueryBuilder } from './exists.ts'
export type {
  AnyDrizzleTable,
  CalendarTranslatorOptions,
  ColumnMap,
  ColumnOp,
  CreateTranslatorOptions,
  OpContext,
  OpMap,
  OpTranslator,
  Translator,
} from './types.ts'
