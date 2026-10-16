import {
  toJsonSchema,
  type FilterSchema,
  type JsonSchema,
  type AstLimits,
  type ValidAST,
} from '@dql-kit/core'
import { Type, type SchemaOptions, type TSchema } from '@sinclair/typebox'

/**
 * A TypeBox schema whose static type is the Valid AST of the filter
 * schema it was generated from.
 */
export type TFilterAst<S extends FilterSchema = FilterSchema> = TSchema & {
  static: ValidAST<S>
}

const unsupported = (what: string): never => {
  throw new Error(`@dql-kit/typebox: unsupported JSON Schema ${what}`)
}

export type ToTypeBoxOptions = {
  /** Defaults to `DEFAULT_AST_LIMITS`, the same as `parseAst`. */
  limits?: Partial<AstLimits>
  /**
   * Extra keywords set on every generated node. For example Elysia's
   * `error`: without it, Elysia's development-mode validation message
   * expands every branch of every failed union, which for a filter AST
   * runs to megabytes.
   */
  schemaOptions?: SchemaOptions
}

const literalUnion = (
  values: ReadonlyArray<string | number | boolean>,
  o: SchemaOptions,
): TSchema =>
  values.length === 1
    ? Type.Literal(values[0]!, o)
    : Type.Union(values.map((v) => Type.Literal(v, o)), o)

// Maps the subset `toJsonSchema` emits onto TypeBox builders. `$ref`s
// are inlined; each definition is converted once and the resulting
// node reused, so `Condition` is shared by every group level.
type Ctx = {
  defs: Record<string, JsonSchema>
  cache: Map<string, TSchema>
  o: SchemaOptions
}

const convert = (node: JsonSchema, ctx: Ctx): TSchema => {
  const { defs, cache, o } = ctx
  if (node === true) return Type.Unknown(o)
  if (node === false) return Type.Never(o)

  if (node.$ref !== undefined) {
    const name = node.$ref.replace(/^#\/\$defs\//, '')
    const hit = cache.get(name)
    if (hit) return hit
    const def = defs[name] ?? unsupported(`$ref ${node.$ref}`)
    const converted = convert(def, ctx)
    cache.set(name, converted)
    return converted
  }
  if (node.const !== undefined) return Type.Literal(node.const, o)
  if (node.enum !== undefined) return literalUnion(node.enum, o)
  if (node.anyOf !== undefined) return Type.Union(node.anyOf.map((n) => convert(n, ctx)), o)
  if (node.not !== undefined) return Type.Not(convert(node.not, ctx), o)

  switch (node.type) {
    case 'string':
      return Type.String({ ...o, ...(node.pattern !== undefined && { pattern: node.pattern }) })
    case 'number':
      return Type.Number({
        ...o,
        ...(node.exclusiveMinimum !== undefined && { exclusiveMinimum: node.exclusiveMinimum }),
      })
    case 'boolean':
      return Type.Boolean(o)
    case 'array': {
      if (node.prefixItems !== undefined) {
        return Type.Tuple(node.prefixItems.map((n) => convert(n, ctx)), o)
      }
      const items = node.items === undefined ? Type.Unknown(o) : convert(node.items, ctx)
      return Type.Array(items, {
        ...o,
        ...(node.minItems !== undefined && { minItems: node.minItems }),
        ...(node.maxItems !== undefined && { maxItems: node.maxItems }),
      })
    }
    case 'object': {
      const required = new Set(node.required ?? [])
      const props: Record<string, TSchema> = {}
      for (const [key, value] of Object.entries(node.properties ?? {})) {
        const converted = convert(value, ctx)
        props[key] = required.has(key) ? converted : Type.Optional(converted)
      }
      return Type.Object(props, o)
    }
    default:
      return unsupported(`node ${JSON.stringify(node)}`)
  }
}

/**
 * TypeBox schema for a Valid AST over `schema`, e.g. for an Elysia
 * route body. Structure and limits come from `toJsonSchema`; see there
 * for what is (and is deliberately not) checked. Run the server-side
 * AST parser on the validated body as well.
 */
export const toTypeBox = <S extends FilterSchema>(
  schema: S,
  options: ToTypeBoxOptions = {},
): TFilterAst<S> => {
  const json = toJsonSchema(schema, options.limits)
  return convert(json, {
    defs: json.$defs ?? {},
    cache: new Map(),
    o: options.schemaOptions ?? {},
  }) as TFilterAst<S>
}
