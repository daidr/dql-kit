import { parseAst, type FieldDef, type FilterSchema, type ValidAST } from '@dql-kit/core'
import { createDrizzleTranslator } from '@dql-kit/drizzle'
import {
  PgDialect,
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

const dialect = new PgDialect()

// Drizzle's column-builder types are over-precise — each `text()`,
// `integer()` etc. returns a different generic instantiation, so a
// uniform `Record<string, ColumnBuilder>` doesn't typecheck even though
// `pgTable` accepts the heterogeneous record fine. The virtual table is
// only consumed by the translator (which casts to `AnyColumn` anyway),
// so the loss of static typing here is harmless.
const columnFor = (field: FieldDef): unknown => {
  const id = field.delegateTo ?? field.typeId
  switch (id) {
    case 'string':   return text()
    case 'number':   return integer()
    case 'boolean':  return boolean()
    case 'enum':     return text()
    case 'date':     return date()
    case 'datetime': return timestamp({ withTimezone: true })
    case 'id':       return integer()
    case 'array': {
      const inner =
        field.itemType?.delegateTo ?? field.itemType?.typeId ?? 'string'
      return inner === 'number' ? integer().array() : text().array()
    }
    default:
      return text()
  }
}

const buildTable = (schema: FilterSchema): Record<string, AnyPgColumn> => {
  const cols: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema.fields)) {
    cols[key] = columnFor(field)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pgTable('virtual', cols as any) as unknown as Record<
    string,
    AnyPgColumn
  >
}

export type SqlPreview =
  | { ok: true, sql: string, params: unknown[] }
  | { ok: false, error: string }

export const previewSql = (
  schema: FilterSchema,
  ast: ValidAST,
): SqlPreview => {
  // Same path a server takes: parse the AST against the schema, then
  // translate. Only a parsed (CheckedAST) value is accepted by toWhere.
  const parsed = parseAst(ast, schema)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.errors.map((e) => `${e.code} @ [${e.path.join(', ')}]`).join('\n'),
    }
  }
  try {
    const table = buildTable(schema)
    const translator = createDrizzleTranslator({
      schema,
      columns: table,
    })
    const where = translator.toWhere(parsed.ast)
    const { sql, params } = dialect.sqlToQuery(where)
    return { ok: true, sql: `SELECT *\nFROM virtual\nWHERE ${sql};`, params }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
