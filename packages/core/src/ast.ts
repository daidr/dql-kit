import {
  isGroup,
  type Analysis,
  type DraftAST,
  type DraftCondition,
  type DraftGroup,
  type DraftNode,
  type FilterSchema,
  type NodePath,
  type ValidAST,
  type ValidCondition,
  type ValidGroup,
  type ValidNode,
  type ValidationError,
} from './types.ts'
import {
  checkShape,
  checkValueType,
  expectedTypeLabel,
  observedTypeLabel,
} from './check.ts'

export const emptyAst = (): ValidAST => ({ combinator: 'and', children: [] })

export const emptyDraft = (): DraftAST => ({ combinator: 'and', children: [] })

export const isCondition = (
  n: DraftNode | ValidNode,
): n is DraftCondition | ValidCondition =>
  n != null && typeof n === 'object' && 'field' in n

// One-shot per-condition analysis. Produces:
//  - the pruned ValidCondition if all checks pass (else null);
//  - the ValidationError if a check failed (else null).
// Both being non-null is impossible — the first failed check returns
// null + the error; success returns the condition + null.
const analyzeCondition = (
  cond: DraftCondition,
  schema: FilterSchema,
  path: NodePath,
): { valid: ValidCondition | null, error: ValidationError | null } => {
  if (cond.field == null) {
    return { valid: null, error: { path, code: 'incomplete', missing: 'field' } }
  }
  const field = schema.fields[cond.field]
  if (!field) {
    return { valid: null, error: { path, code: 'unknown_field', field: cond.field } }
  }
  if (cond.op == null) {
    return { valid: null, error: { path, code: 'incomplete', missing: 'op' } }
  }
  const op = field.ops.find((o) => o.name === cond.op)
  if (!op) {
    return {
      valid: null,
      error: { path, code: 'op_not_allowed', field: cond.field, op: cond.op },
    }
  }
  if (op.valueShape === 'none') {
    // Lenient prune semantics: a stray value on a `none`-shape op is
    // normalised away rather than dropping the whole condition. We
    // still report a `value_shape_mismatch` so explicit `validate`
    // surfaces the schema/draft mismatch — the executable AST and the
    // error list are independent.
    if (cond.value !== undefined) {
      return {
        valid: { field: cond.field, op: cond.op, value: undefined },
        error: { path, code: 'value_shape_mismatch', op: cond.op, expected: 'none' },
      }
    }
    return {
      valid: { field: cond.field, op: cond.op, value: undefined },
      error: null,
    }
  }
  if (cond.value === undefined) {
    return { valid: null, error: { path, code: 'incomplete', missing: 'value' } }
  }
  if (!checkShape(cond.value, op.valueShape)) {
    return {
      valid: null,
      error: { path, code: 'value_shape_mismatch', op: cond.op, expected: op.valueShape },
    }
  }
  if (!checkValueType(field, op.valueShape, cond.value)) {
    return {
      valid: null,
      error: {
        path,
        code: 'value_type_mismatch',
        expected: expectedTypeLabel(field),
        got: observedTypeLabel(cond.value),
      },
    }
  }
  return {
    valid: { field: cond.field, op: cond.op, value: cond.value },
    error: null,
  }
}

const analyzeNode = (
  node: DraftNode,
  schema: FilterSchema,
  path: NodePath,
  errors: ValidationError[],
  isRoot: boolean,
): ValidNode | null => {
  if (isGroup(node)) {
    const group = node as DraftGroup
    const children: ValidNode[] = []
    group.children.forEach((child, i) => {
      const pruned = analyzeNode(child, schema, [...path, i], errors, false)
      if (pruned !== null) children.push(pruned)
    })
    if (!isRoot) {
      if (children.length === 0) return null
      if (children.length === 1) return children[0]!
    }
    return { combinator: group.combinator, children } as ValidGroup
  }
  const { valid, error } = analyzeCondition(node as DraftCondition, schema, path)
  if (error) errors.push(error)
  return valid
}

/**
 * Single-walk analyzer: produces both the pruned ValidAST and the list
 * of ValidationErrors at once. `prune` and `validate` are thin wrappers
 * around this — prefer `analyze` directly when you need both.
 */
export const analyze = (
  draft: DraftAST,
  schema: FilterSchema,
): Analysis => {
  const errors: ValidationError[] = []
  const result = analyzeNode(draft, schema, [], errors, true)
  if (result === null || !isGroup(result)) {
    return { ast: emptyAst(), errors }
  }
  return { ast: result as ValidAST, errors }
}

export const prune = (draft: DraftAST, schema: FilterSchema): ValidAST =>
  analyze(draft, schema).ast

export const validate = (
  draft: DraftAST,
  schema: FilterSchema,
): { ok: true, ast: ValidAST } | { ok: false, errors: ValidationError[] } => {
  const { ast, errors } = analyze(draft, schema)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, ast }
}

export const astRefersTo = (
  ast: ValidAST | DraftAST,
  fieldKey: string,
): boolean => {
  const visit = (node: DraftNode | ValidNode): boolean => {
    if (isGroup(node)) {
      return (node as DraftGroup | ValidGroup).children.some(visit)
    }
    return (node as DraftCondition | ValidCondition).field === fieldKey
  }
  return visit(ast)
}

/**
 * Structural deep-equality for ValidAST. Stable — does not depend on
 * key order, but ValidAST is produced from a deterministic walk so
 * key order is incidental. Used by useFilter to detect committed-vs-live
 * AST differences without serialising to JSON on every keystroke.
 */
export const astEqual = (a: ValidNode, b: ValidNode): boolean => {
  if (a === b) return true
  if (isGroup(a)) {
    if (!isGroup(b)) return false
    if (a.combinator !== b.combinator) return false
    if (a.children.length !== b.children.length) return false
    for (let i = 0; i < a.children.length; i++) {
      if (!astEqual(a.children[i]!, b.children[i]!)) return false
    }
    return true
  }
  if (isGroup(b)) return false
  if (a.field !== b.field || a.op !== b.op) return false
  return valueEqual(a.value, b.value)
}

const valueEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(bo, k)) return false
      if (!valueEqual(ao[k], bo[k])) return false
    }
    return true
  }
  return false
}
