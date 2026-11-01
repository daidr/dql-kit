import type { CheckedAST, FieldDef, FilterSchema, WeekStart } from '@dql-kit/core'
import type { AnyColumn, SQL } from 'drizzle-orm'

export type AnyDrizzleTable = {
  [key: string]: AnyColumn
} & object

/**
 * Field → column. `null` means the field has no column of its own (a
 * related-table predicate, a search across several columns): every op
 * on it must then have a custom handler, which receives `col` as
 * `undefined`.
 */
export type ColumnMap<F extends FilterSchema['fields']> = {
  [K in keyof F]?: AnyColumn | null
}

// Context passed to op translators. Adapters can branch on field.typeId
// (e.g. `contains` is ILIKE for string fields but `= ANY(col)` for array
// fields). Custom ops may ignore the third argument; TS tolerates fewer-
// param functions assigned here.
export type OpContext = {
  field: FieldDef
  /** Resolved IANA zone where calendar days start (`'UTC'` by default). */
  timeZone: string
  /** First day of the week for `inPeriod` weeks. */
  weekStartsOn: WeekStart
  /** Clock reading for this `toWhere` call, for bounds computed in JS. */
  now: Date
}

/**
 * SQL for one condition. `col` is the field's column, or `undefined`
 * for a field mapped to `null` in `columns`.
 */
export type OpTranslator = (col: AnyColumn | undefined, value: unknown, ctx: OpContext) => SQL

/** A built-in op handler: always called with a column. */
export type ColumnOp = (col: AnyColumn, value: unknown, ctx: OpContext) => SQL

/**
 * Map of op name → custom SQL translator. Keys passed here override or
 * extend the built-in `drizzleOps`. This is the construction-time
 * channel for adding/overriding ops; there is no mutating
 * `registerOp` after construction by design (immutable translators
 * are safer in async-import / lazy-load codebases).
 */
export type OpMap = Record<string, OpTranslator>

export type CalendarTranslatorOptions = {
  /**
   * IANA time zone (e.g. `'Europe/Berlin'`) where calendar days start.
   * Decides the bounds of `inPeriod`, of relative ops on `date` fields,
   * and of `date` comparisons on timestamp columns. PG `date` columns
   * hold plain days and are not shifted. Defaults to UTC. Validated at
   * construction.
   */
  timeZone?: string
  /** First day of the week for `inPeriod` weeks: 0 = Sunday … 6. Defaults to 1 (Monday). */
  weekStartsOn?: WeekStart
  /**
   * Clock for bounds computed in JS (`inPeriod`, relative ops on `date`
   * fields), read once per `toWhere` call. Defaults to the current time.
   * Relative ops on `datetime` fields use the database's `NOW()`.
   */
  now?: () => Date
}

export type CreateTranslatorOptions<S extends FilterSchema> = CalendarTranslatorOptions & (
  | { schema: S, table: AnyDrizzleTable, columns?: ColumnMap<S['fields']>, ops?: OpMap }
  | { schema: S, columns: ColumnMap<S['fields']>, ops?: OpMap }
)

export type Translator<S extends FilterSchema = FilterSchema> = {
  /**
   * Translate a parsed AST into a WHERE fragment. Only accepts the
   * output of `parseAst` from `@dql-kit/core`: run untrusted input
   * (request bodies, stored filters) through it first.
   *
   * Typed by the translator's schema, so an AST parsed against an
   * unrelated schema doesn't compile (one parsed against a subset of
   * its fields does). Method syntax keeps `Translator<S>` assignable to
   * the loose `Translator`.
   */
  toWhere(ast: CheckedAST<S>): SQL
}
