import type { FilterSchema, ValidAST, ValidNode } from '@dql-kit/core'
import { and, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { drizzleOps } from './ops.ts'
import type {
  AnyDrizzleTable,
  CreateTranslatorOptions,
  OpTranslator,
  Translator,
} from './types.ts'

const isGroupNode = (n: ValidNode): n is Extract<ValidNode, { combinator: unknown }> =>
  'combinator' in n

export const createDrizzleTranslator = <S extends FilterSchema>(
  opts: CreateTranslatorOptions<S>,
): Translator => {
  const ops: Record<string, OpTranslator> = { ...drizzleOps }
  const columns: Record<string, AnyColumn> = {}

  const explicit = (opts.columns ?? {}) as Record<string, AnyColumn | undefined>
  const table = ('table' in opts ? opts.table : undefined) as AnyDrizzleTable | undefined

  for (const fieldKey of Object.keys(opts.schema.fields)) {
    const fromExplicit = explicit[fieldKey]
    const fromTable = table?.[fieldKey]
    const col = fromExplicit ?? fromTable
    if (!col) {
      throw new Error(
        `[dql-kit/drizzle] Missing column mapping for field "${fieldKey}". `
          + `Provide a "table" with a column of the same name, or include "${fieldKey}" in "columns".`,
      )
    }
    columns[fieldKey] = col
  }

  const translateNode = (node: ValidNode): SQL => {
    if (isGroupNode(node)) {
      if (node.children.length === 0) return sql`true`
      const parts = node.children.map(translateNode).filter((s): s is SQL => s !== undefined)
      if (parts.length === 0) return sql`true`
      if (parts.length === 1) return parts[0]!
      const joined = node.combinator === 'and' ? and(...parts) : or(...parts)
      if (!joined) return sql`true`
      return joined
    }
    const col = columns[node.field]
    if (!col) {
      throw new Error(
        `[dql-kit/drizzle] AST references unknown field "${node.field}" not present in schema.`,
      )
    }
    const opFn = ops[node.op]
    if (!opFn) {
      throw new Error(
        `[dql-kit/drizzle] No SQL translator registered for op "${node.op}". Use Translator.registerOp().`,
      )
    }
    return opFn(col, node.value)
  }

  return {
    toWhere(ast: ValidAST): SQL {
      if (ast.children.length === 0) return sql`true`
      return translateNode(ast)
    },
    registerOp(name: string, translator: OpTranslator): void {
      ops[name] = translator
    },
  }
}
