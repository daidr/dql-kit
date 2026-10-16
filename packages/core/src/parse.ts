import {
  checkShape,
  checkValueType,
  expectedTypeLabel,
  observedTypeLabel,
} from './check.ts'
import type {
  AstLimits,
  CheckedAST,
  Combinator,
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

// Copy a value into a fresh structure so the output AST never aliases
// caller-owned input. Values that passed the shape/type checks are
// primitives, arrays of primitives, or `{ amount, unit }` — except for
// custom typeIds without `delegateTo`, whose values are opaque and
// passed through as-is.
const copyValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.slice()
  if (isPlainObject(value) && has(value, 'amount') && has(value, 'unit')) {
    return { amount: value.amount, unit: value.unit }
  }
  return value
}

const walkCondition = (
  obj: Record<string, unknown>,
  path: NodePath,
  st: WalkState,
): ValidCondition | null => {
  const { keys, schema, errors } = st
  const fieldName = obj[keys.field]
  if (fieldName == null) {
    errors.push({ path, code: 'incomplete', missing: 'field' })
    return null
  }
  if (typeof fieldName !== 'string') {
    errors.push({ path, code: 'invalid_node', message: 'field must be a string' })
    return null
  }
  const field = has(schema.fields, fieldName) ? schema.fields[fieldName] : undefined
  if (!field) {
    errors.push({ path, code: 'unknown_field', field: fieldName })
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
  limits?: Partial<AstLimits>,
): ParseResult<S> => {
  const { ast, errors } = walkAst(json, schema, {
    keys: LONG_KEYS,
    limits: resolveLimits(limits),
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, ast: ast as CheckedAST as CheckedAST<S> }
}

export { resolveLimits }
