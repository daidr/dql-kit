import { RELATIVE_UNITS } from './check.ts'
import { resolveLimits } from './parse.ts'
import type { AstLimits, FieldDef, FilterSchema, ValueShape } from './types.ts'

/**
 * The subset of JSON Schema (draft 2020-12) that `toJsonSchema` emits.
 * Kept deliberately small so adapters (e.g. `@dql-kit/typebox`) can map
 * every keyword mechanically; anything outside it is a generator bug.
 */
export type JsonSchema = boolean | JsonSchemaObject

export type JsonSchemaObject = {
  $schema?: string
  $ref?: string
  $defs?: Record<string, JsonSchema>
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean'
  const?: string | number | boolean
  enum?: ReadonlyArray<string | number>
  anyOf?: JsonSchema[]
  not?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  prefixItems?: JsonSchema[]
  minItems?: number
  maxItems?: number
  pattern?: string
  exclusiveMinimum?: number
}

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'

// Mirrors `checkPrimitive` in check.ts. `true` = unconstrained, used for
// custom typeIds without `delegateTo` (and an `array` field missing its
// itemType), which `checkPrimitive` also lets through.
const elementSchema = (field: FieldDef): JsonSchema => {
  const effective = field.delegateTo ?? field.typeId
  switch (effective) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'enum': {
      const values = (field.enumValues ?? []).map((e) => e.value)
      return values.length === 0 ? false : { enum: values }
    }
    case 'date':
      return { type: 'string', pattern: DATE_PATTERN }
    case 'datetime':
      // `Date.parse` accepts more than any pattern could describe;
      // parseability is left to `parseAst`.
      return { type: 'string' }
    case 'id':
      return { anyOf: [{ type: 'string' }, { type: 'number' }] }
    default:
      return true
  }
}

const valueSchema = (
  field: FieldDef,
  shape: Exclude<ValueShape, 'none'>,
  limits: AstLimits,
): JsonSchema => {
  const element =
    field.typeId === 'array' && field.itemType
      ? elementSchema(field.itemType)
      : elementSchema(field)
  switch (shape) {
    case 'single':
      // `checkShape('single')` rejects arrays and relative-shaped
      // objects; typed elements already exclude both.
      return element === true
        ? {
            not: {
              anyOf: [
                { type: 'array' },
                { type: 'object', properties: { amount: true, unit: true }, required: ['amount', 'unit'] },
              ],
            },
          }
        : element
    case 'pair':
      return { type: 'array', prefixItems: [element, element], minItems: 2, maxItems: 2 }
    case 'list':
      return { type: 'array', items: element, maxItems: limits.maxListLength }
    case 'relative':
      return {
        type: 'object',
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          unit: { enum: RELATIVE_UNITS },
        },
        required: ['amount', 'unit'],
      }
  }
}

const opsConst = (ops: string[]): JsonSchema =>
  ops.length === 1 ? { const: ops[0]! } : { enum: ops }

// One branch per (field, valueShape): ops of the same shape on the same
// field share a value schema, so they collapse into one `enum`.
const conditionSchema = (
  schema: FilterSchema,
  limits: AstLimits,
): JsonSchema => {
  const branches: JsonSchema[] = []
  for (const [key, field] of Object.entries(schema.fields)) {
    const byShape = new Map<ValueShape, string[]>()
    for (const op of field.ops) {
      const names = byShape.get(op.valueShape)
      if (names) names.push(op.name)
      else byShape.set(op.valueShape, [op.name])
    }
    for (const [shape, ops] of byShape) {
      if (shape === 'none') {
        branches.push({
          type: 'object',
          properties: { field: { const: key }, op: opsConst(ops), value: false },
          required: ['field', 'op'],
        })
      } else {
        branches.push({
          type: 'object',
          properties: {
            field: { const: key },
            op: opsConst(ops),
            value: valueSchema(field, shape, limits),
          },
          required: ['field', 'op', 'value'],
        })
      }
    }
  }
  return branches.length === 1 ? branches[0]! : { anyOf: branches }
}

const groupSchema = (child: JsonSchema, limits: AstLimits): JsonSchema => ({
  type: 'object',
  properties: {
    combinator: { enum: ['and', 'or'] },
    // The root counts towards `maxNodes`, so no group can hold more
    // than `maxNodes - 1` children. The total itself is not expressible.
    children: { type: 'array', items: child, maxItems: Math.max(0, limits.maxNodes - 1) },
  },
  required: ['combinator', 'children'],
})

/**
 * JSON Schema for a Valid AST over `schema`, for validating request
 * bodies and describing them in OpenAPI.
 *
 * Nesting is unrolled to `limits.maxDepth` levels (`$defs.Group1` …
 * `GroupN`) instead of a recursive `$ref`, so a validator walks at most
 * that deep and pathological nesting is rejected without recursing.
 *
 * Limits default to `DEFAULT_AST_LIMITS`, the same as `parseAst`.
 *
 * The schema is never stricter than `parseAst` with the same limits:
 * every AST `parseAst` accepts validates. What it cannot express (total
 * node count, datetime parseability) is still checked by `parseAst`,
 * which servers must run on the validated body anyway.
 */
export const toJsonSchema = (
  schema: FilterSchema,
  limits: Partial<AstLimits> = {},
): JsonSchemaObject => {
  const l = resolveLimits(limits)
  if (!Number.isInteger(l.maxDepth) || l.maxDepth < 1) {
    throw new RangeError(`maxDepth must be a positive integer, got ${l.maxDepth}`)
  }
  const $defs: Record<string, JsonSchema> = { Condition: conditionSchema(schema, l) }
  const condition: JsonSchema = { $ref: '#/$defs/Condition' }
  for (let depth = l.maxDepth; depth >= 1; depth--) {
    const child: JsonSchema =
      depth === l.maxDepth
        ? condition
        : { anyOf: [condition, { $ref: `#/$defs/Group${depth + 1}` }] }
    $defs[`Group${depth}`] = groupSchema(child, l)
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: '#/$defs/Group1',
    $defs,
  }
}
