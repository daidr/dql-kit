import {
  isGroup,
  type Analysis,
  type DraftAST,
  type DraftCondition,
  type DraftGroup,
  type DraftNode,
  type FilterSchema,
  type ParseError,
  type ValidAST,
  type ValidCondition,
  type ValidGroup,
  type ValidNode,
  type ValidationError,
} from './types.ts'
import { LONG_KEYS, walkAst } from './parse.ts'

export const emptyAst = (): ValidAST => ({ combinator: 'and', children: [] })

export const emptyDraft = (): DraftAST => ({ combinator: 'and', children: [] })

export const isCondition = (
  n: DraftNode | ValidNode,
): n is DraftCondition | ValidCondition =>
  n != null && typeof n === 'object' && 'field' in n

const isValidationError = (e: ParseError): e is ValidationError =>
  e.code === 'unknown_field'
  || e.code === 'op_not_allowed'
  || e.code === 'value_type_mismatch'
  || e.code === 'value_shape_mismatch'
  || e.code === 'incomplete'

/**
 * Single-walk analyzer: produces both the pruned ValidAST and the list
 * of ValidationErrors at once. `prune` and `validate` are thin wrappers
 * around this — prefer `analyze` directly when you need both.
 *
 * Shares its walker with `parseAst` and `fromUrl`, minus the size
 * limits: a draft is built by this process's own UI. Structural
 * problems a well-typed draft can't have (non-object nodes and the
 * like) are pruned without an error; use `parseAst` for input whose
 * shape isn't guaranteed by the type system.
 */
export const analyze = (
  draft: DraftAST,
  schema: FilterSchema,
): Analysis => {
  const { ast, errors } = walkAst(draft, schema, { keys: LONG_KEYS, limits: null })
  return { ast, errors: errors.filter(isValidationError) }
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
