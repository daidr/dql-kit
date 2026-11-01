import {
  checkPairOrder,
  checkShape,
  checkValueType,
  expectedTypeLabel,
  observedTypeLabel,
} from './check.ts'
import { migrateAst, schemaVersion } from './migrate.ts'
import type {
  AstLimits,
  CheckedAST,
  Combinator,
  DroppedNode,
  FilterSchema,
  NodePath,
  ParseError,
  ParseResult,
  ValidAST,
  ValidCondition,
  ValidGroup,
  ValidNode,
} from './types.ts'

/**
 * Defaults for `parseAst` / `fromUrl`. Generous for hand-built filters
 * (the UI rarely nests past 3 levels or goes beyond a few dozen
 * conditions), tight enough that a hostile payload can't blow the stack
 * or make the translator emit a megabyte of SQL.
 */
export const DEFAULT_AST_LIMITS: Readonly<AstLimits> = Object.freeze({
  maxDepth: 8,
  maxNodes: 200,
  maxListLength: 100,
})

// Property names the walker reads. The long form is the AST itself; the
// compact form is the URL wire format (see `COMPACT_KEYS` in url.ts).
export type NodeKeys = {
  combinator: string
  children: string
  field: string
  op: string
  value: string
}

export const LONG_KEYS: NodeKeys = {
  combinator: 'combinator',
  children: 'children',
  field: 'field',
  op: 'op',
  value: 'value',
}

export type WalkOptions = {
  keys: NodeKeys
  // `null` = no limits. Used by `analyze` on in-memory drafts, whose
  // shape the UI controls; every untrusted entry point passes limits.
  limits: AstLimits | null
}

type WalkState = {
  schema: FilterSchema
  keys: NodeKeys
  limits: AstLimits | null
  errors: ParseError[]
  nodes: number
  nodesExceeded: boolean
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  x != null && typeof x === 'object' && !Array.isArray(x)

const has = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

const isCombinator = (x: unknown): x is Combinator => x === 'and' || x === 'or'

// alias → field key, built once per schema object.
const aliasMaps = new WeakMap<FilterSchema, Map<string, string>>()
const aliasTarget = (schema: FilterSchema, name: string): string | undefined => {
  let map = aliasMaps.get(schema)
  if (!map) {
    map = new Map()
    for (const [key, def] of Object.entries(schema.fields)) {
      for (const alias of def.aliases ?? []) {
        if (!has(schema.fields, alias) && !map.has(alias)) map.set(alias, key)
      }
    }
    aliasMaps.set(schema, map)
  }
  return map.get(name)
}

// Copy a value into a fresh structure so the output AST never aliases
// caller-owned input. Values that passed the shape/type checks are
// primitives, arrays of primitives, `{ amount, unit }` or `{ unit, offset }`,
// except for custom typeIds without `delegateTo`, whose values are
// opaque and passed through as-is.
const copyValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.slice()
  if (isPlainObject(value) && has(value, 'amount') && has(value, 'unit')) {
    return { amount: value.amount, unit: value.unit }
  }
  if (isPlainObject(value) && has(value, 'unit') && has(value, 'offset')) {
    return { unit: value.unit, offset: value.offset }
  }
  return value
}

const walkCondition = (
  obj: Record<string, unknown>,
  path: NodePath,
  st: WalkState,
): ValidCondition | null => {
  const { keys, schema, errors } = st
  const rawField = obj[keys.field]
  if (rawField == null) {
    errors.push({ path, code: 'incomplete', missing: 'field' })
    return null
  }
  if (typeof rawField !== 'string') {
    errors.push({ path, code: 'invalid_node', message: 'field must be a string' })
    return null
  }
  // A renamed field is still read under its old name (`aliases`), and
  // written back under the new one.
  const fieldName = has(schema.fields, rawField) ? rawField : aliasTarget(schema, rawField)
  const field = fieldName !== undefined && has(schema.fields, fieldName) ? schema.fields[fieldName] : undefined
  if (!field || fieldName === undefined) {
    errors.push({ path, code: 'unknown_field', field: rawField })
    return null
  }
  const opName = obj[keys.op]
  if (opName == null) {
    errors.push({ path, code: 'incomplete', missing: 'op' })
    return null
  }
  if (typeof opName !== 'string') {
    errors.push({ path, code: 'invalid_node', message: 'op must be a string' })
    return null
  }
  const op = field.ops.find((o) => o.name === opName)
  if (!op) {
    errors.push({ path, code: 'op_not_allowed', field: fieldName, op: opName })
    return null
  }

  const value = obj[keys.value]
  if (op.valueShape === 'none') {
    // Lenient prune semantics: a stray value on a `none`-shape op is
    // normalised away rather than dropping the whole condition. The
    // error is still reported, so strict callers (`validate`,
    // `parseAst`) reject it; lenient ones (`prune`, `fromUrl`) keep the
    // condition and surface the error.
    if (value !== undefined) {
      errors.push({ path, code: 'value_shape_mismatch', op: opName, expected: 'none' })
    }
    return { field: fieldName, op: opName, value: undefined }
  }
  if (value === undefined) {
    errors.push({ path, code: 'incomplete', missing: 'value' })
    return null
  }
  if (!checkShape(value, op.valueShape)) {
    errors.push({ path, code: 'value_shape_mismatch', op: opName, expected: op.valueShape })
    return null
  }
  // An empty list is the "nothing picked yet" state of a multi-select:
  // `in []` would match no rows and `notIn []` every row, so treat it
  // as a missing value rather than a real condition.
  if (op.valueShape === 'list' && (value as unknown[]).length === 0) {
    errors.push({ path, code: 'incomplete', missing: 'value' })
    return null
  }
  if (
    st.limits
    && op.valueShape === 'list'
    && (value as unknown[]).length > st.limits.maxListLength
  ) {
    errors.push({
      path,
      code: 'limit_exceeded',
      limit: 'maxListLength',
      max: st.limits.maxListLength,
    })
    return null
  }
  if (!checkValueType(field, op.valueShape, value)) {
    errors.push({
      path,
      code: 'value_type_mismatch',
      expected: expectedTypeLabel(field),
      got: observedTypeLabel(value),
    })
    return null
  }
  if (op.valueShape === 'pair' && !checkPairOrder(field, value)) {
    errors.push({ path, code: 'invalid_range', op: opName })
    return null
  }
  return { field: fieldName, op: opName, value: copyValue(value) }
}

// `depth` is the group-nesting level of `raw` if it is a group: the root
// group is level 1. Recursion only descends into groups, and a group past
// `maxDepth` is rejected before its children are visited, so the call
// stack is bounded by `maxDepth` whenever limits are set.
const walkNode = (
  raw: unknown,
  path: NodePath,
  depth: number,
  st: WalkState,
): ValidNode | null => {
  const { keys, limits, errors } = st

  if (limits) {
    if (st.nodes >= limits.maxNodes) {
      if (!st.nodesExceeded) {
        st.nodesExceeded = true
        errors.push({ path, code: 'limit_exceeded', limit: 'maxNodes', max: limits.maxNodes })
      }
      return null
    }
  }
  st.nodes++

  if (!isPlainObject(raw)) {
    errors.push({ path, code: 'invalid_node', message: `expected an object, got ${observedTypeLabel(raw)}` })
    return null
  }

  const isGroupLike = has(raw, keys.combinator) || has(raw, keys.children)
  if (!isGroupLike) return walkCondition(raw, path, st)

  const combinator = raw[keys.combinator]
  const children = raw[keys.children]
  if (!isCombinator(combinator)) {
    errors.push({ path, code: 'invalid_node', message: 'combinator must be "and" or "or"' })
    return null
  }
  if (!Array.isArray(children)) {
    errors.push({ path, code: 'invalid_node', message: 'children must be an array' })
    return null
  }
  if (limits && depth > limits.maxDepth) {
    errors.push({ path, code: 'limit_exceeded', limit: 'maxDepth', max: limits.maxDepth })
    return null
  }

  const out: ValidNode[] = []
  for (let i = 0; i < children.length; i++) {
    if (st.nodesExceeded) break
    const child = walkNode(children[i], [...path, i], depth + 1, st)
    if (child !== null) out.push(child)
  }
  // Normalise: a non-root group that pruned down to nothing disappears;
  // one with a single child is replaced by that child (the combinator of
  // a one-element group is meaningless).
  if (path.length > 0) {
    if (out.length === 0) return null
    if (out.length === 1) return out[0]!
  }
  return { combinator, children: out } as ValidGroup
}

/**
 * The one walker behind `analyze`, `parseAst` and `fromUrl`, so every
 * entry point (in-memory drafts, request bodies, URLs) applies the same
 * rules. Always returns the best-effort pruned AST plus every problem it
 * found; strictness is the caller's decision.
 */
export const walkAst = (
  raw: unknown,
  schema: FilterSchema,
  opts: WalkOptions,
): { ast: ValidAST, errors: ParseError[] } => {
  const st: WalkState = {
    schema,
    keys: opts.keys,
    limits: opts.limits,
    errors: [],
    nodes: 0,
    nodesExceeded: false,
  }
  const isRootGroup =
    isPlainObject(raw) && (has(raw, opts.keys.combinator) || has(raw, opts.keys.children))
  if (!isRootGroup) {
    st.errors.push({
      path: [],
      code: 'invalid_node',
      message: 'root must be a group with combinator and children',
    })
    return { ast: { combinator: 'and', children: [] }, errors: st.errors }
  }
  const result = walkNode(raw, [], 1, st)
  if (result === null || !('combinator' in result)) {
    return { ast: { combinator: 'and', children: [] }, errors: st.errors }
  }
  return { ast: result as ValidAST, errors: st.errors }
}

const resolveLimits = (limits?: Partial<AstLimits>): AstLimits => ({
  ...DEFAULT_AST_LIMITS,
  ...limits,
})

export type ParseOptions = Partial<AstLimits> & {
  /**
   * Schema version `json` was written with (e.g. stored next to a saved
   * filter). Older ASTs run through the schema's `migrations` first.
   * Defaults to the schema's current version (no migration).
   */
  fromVersion?: number
}

/**
 * Parse an untrusted AST (a request body, a stored filter, anything that
 * did not come from this process's own `useFilter`) against a schema.
 *
 * Strict: any problem — unknown field, op not allowed on that field,
 * wrong value shape or type, malformed node, or a limit exceeded —
 * fails the whole parse. On success the AST is normalised (empty groups
 * removed, single-child groups collapsed, no extra keys) and branded as
 * `CheckedAST`, the only type the SQL translators accept.
 *
 * `json` is a parsed JSON value, not a string.
 */
export const parseAst = <S extends FilterSchema>(
  json: unknown,
  schema: S,
  options?: ParseOptions,
): ParseResult<S> => {
  const { fromVersion, ...limits } = options ?? {}
  const migrated = migrateAst(json, schema, fromVersion ?? schemaVersion(schema))
  if (!migrated.ok) return { ok: false, errors: [migrated.error] }
  const { ast, errors } = walkAst(migrated.value, schema, {
    keys: LONG_KEYS,
    limits: resolveLimits(limits),
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, ast: ast as CheckedAST as CheckedAST<S> }
}

/**
 * Lenient counterpart of `parseAst` for long-key ASTs you stored
 * yourself (saved presets, persisted drafts): runs migrations from
 * `fromVersion`, then keeps every node that passes and reports the rest
 * in `dropped`, like `fromUrl`. Never throws.
 */
export const restoreAst = <S extends FilterSchema>(
  json: unknown,
  schema: S,
  options?: ParseOptions,
): { ast: ValidAST<S>, dropped: DroppedNode[] } => {
  const { fromVersion, ...limits } = options ?? {}
  const migrated = migrateAst(json, schema, fromVersion ?? schemaVersion(schema))
  if (!migrated.ok) return { ast: { combinator: 'and', children: [] }, dropped: [migrated.error] }
  const { ast, errors } = walkAst(migrated.value, schema, { keys: LONG_KEYS, limits: resolveLimits(limits) })
  return { ast: ast as ValidAST<S>, dropped: errors }
}

export { resolveLimits }
