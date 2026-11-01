import { resolveTimeZone, resolveWeekStart, type CheckedAST, type FilterSchema, type ValidNode } from '@dql-kit/core'
import { and, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type {
  AnyDrizzleTable,
  CreateTranslatorOptions,
  OpTranslator,
  Translator,
} from './types.ts'

const isGroupNode = (n: ValidNode): n is Extract<ValidNode, { combinator: unknown }> =>
  'combinator' in n

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * `createDrizzleTranslator` for one dialect: column mapping, op checks
 * and the tree walk are shared; `builtinOps` is the dialect's op table.
 */
export const createTranslatorFactory = (name: string, builtinOps: Record<string, OpTranslator>) =>
  <S extends FilterSchema>(opts: CreateTranslatorOptions<S>): Translator<S> => {
    const fail = (msg: string): never => {
      throw new Error(`[dql-kit/${name}] ${msg}`)
    }
    // Construction-time merge: built-in ops first, user `ops` override on
    // top. Result is frozen-by-convention — there is no post-construction
    // `registerOp`. Add custom ops via the `ops` option instead.
    const customOps = (opts.ops ?? {}) as Record<string, OpTranslator | undefined>
    const ops: Record<string, OpTranslator> = { ...builtinOps }
    for (const [op, fn] of Object.entries(customOps)) if (fn) ops[op] = fn
    const timeZone = resolveTimeZone(opts.timeZone)
    const weekStartsOn = resolveWeekStart(opts.weekStartsOn)
    const clock = opts.now ?? (() => new Date())

    const columns: Record<string, AnyColumn | undefined> = {}
    const explicit = (opts.columns ?? {}) as Record<string, AnyColumn | null | undefined>
    const table = ('table' in opts ? opts.table : undefined) as AnyDrizzleTable | undefined

    for (const [fieldKey, def] of Object.entries(opts.schema.fields)) {
      const fromExplicit = explicit[fieldKey]
      const opNames = def.ops.map((o) => o.name)
      if (fromExplicit === null) {
        // No column: only custom handlers can translate this field.
        const missing = opNames.filter((n) => !hasOwn(customOps, n) || !customOps[n])
        if (missing.length > 0) {
          fail(
            `Field "${fieldKey}" is mapped to null, so each of its ops needs a handler in "ops". `
              + `Missing: ${missing.join(', ')}.`,
          )
        }
        columns[fieldKey] = undefined
        continue
      }
      const col = fromExplicit ?? table?.[fieldKey]
      if (!col) {
        fail(
          `Missing column mapping for field "${fieldKey}". `
            + `Provide a "table" with a column of the same name, or include "${fieldKey}" in "columns".`,
        )
      }
      // An op this dialect can't translate fails here, not at query time.
      const unsupported = opNames.filter((n) => !hasOwn(ops, n))
      if (unsupported.length > 0) {
        fail(
          `No SQL translator registered for op${unsupported.length > 1 ? 's' : ''} `
            + `${unsupported.map((n) => `"${n}"`).join(', ')} on field "${fieldKey}". `
            + `Pass it via createDrizzleTranslator({ ops: { ${unsupported[0]}: ... } }).`,
        )
      }
      columns[fieldKey] = col
    }

    const allowedOps = new Map<string, ReadonlySet<string>>(
      Object.entries(opts.schema.fields).map(([key, def]) => [key, new Set(def.ops.map((o) => o.name))]),
    )

    const translateNode = (node: ValidNode, now: Date): SQL => {
      if (isGroupNode(node)) {
        if (node.children.length === 0) return sql`true`
        const parts = node.children.map((c) => translateNode(c, now)).filter((s): s is SQL => s !== undefined)
        if (parts.length === 0) return sql`true`
        if (parts.length === 1) return parts[0]!
        const joined = node.combinator === 'and' ? and(...parts) : or(...parts)
        if (!joined) return sql`true`
        return joined
      }
      if (!hasOwn(columns, node.field)) {
        fail(`AST references unknown field "${node.field}" not present in schema.`)
      }
      // The CheckedAST brand already guarantees this; re-checked because a
      // cast defeats the brand, and an op the field doesn't declare would
      // otherwise reach an op handler built for a different column type.
      if (!allowedOps.get(node.field)?.has(node.op)) {
        fail(
          `Op "${node.op}" is not allowed on field "${node.field}". `
            + `Parse untrusted input with parseAst() before translating.`,
        )
      }
      const opFn = hasOwn(ops, node.op) ? ops[node.op] : undefined
      if (!opFn) {
        return fail(
          `No SQL translator registered for op "${node.op}". `
            + `Pass it via createDrizzleTranslator({ ops: { ${node.op}: ... } }).`,
        )
      }
      const fieldDef = opts.schema.fields[node.field]!
      return opFn(columns[node.field], node.value, { field: fieldDef, timeZone, weekStartsOn, now })
    }

    return {
      toWhere(ast: CheckedAST<S>): SQL {
        if (ast.children.length === 0) return sql`true`
        // One clock reading per call, so every condition sees the same `now`.
        return translateNode(ast, clock())
      },
    }
  }
