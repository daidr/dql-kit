import {
  isGroup,
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

const pruneCondition = (
  cond: DraftCondition,
  schema: FilterSchema,
): ValidCondition | null => {
  if (cond.field == null || cond.op == null) return null
  const field = schema.fields[cond.field]
  if (!field) return null
  const op = field.ops.find((o) => o.name === cond.op)
  if (!op) return null
  if (op.valueShape === 'none') {
    return { field: cond.field, op: cond.op, value: undefined }
  }
  if (cond.value === undefined) return null
  if (!checkShape(cond.value, op.valueShape)) return null
  if (!checkValueType(field, op.valueShape, cond.value)) return null
  return { field: cond.field, op: cond.op, value: cond.value }
}

const pruneNode = (
  node: DraftNode,
  schema: FilterSchema,
  isRoot: boolean,
): ValidNode | null => {
  if (isGroup(node)) {
    const group = node as DraftGroup
    const children: ValidNode[] = []
    for (const child of group.children) {
      const pruned = pruneNode(child, schema, false)
      if (pruned !== null) children.push(pruned)
    }
    if (!isRoot) {
      if (children.length === 0) return null
      if (children.length === 1) return children[0]!
    }
    return { combinator: group.combinator, children } as ValidGroup
  }
  return pruneCondition(node as DraftCondition, schema)
}

export const prune = (draft: DraftAST, schema: FilterSchema): ValidAST => {
  const result = pruneNode(draft, schema, true)
  if (result === null || !isGroup(result)) return emptyAst()
  return result as ValidAST
}

const validateCondition = (
  cond: DraftCondition,
  schema: FilterSchema,
  path: NodePath,
): ValidationError[] => {
  if (cond.field == null) {
    return [{ path, code: 'incomplete', missing: 'field' }]
  }
  const field = schema.fields[cond.field]
  if (!field) {
    return [{ path, code: 'unknown_field', field: cond.field }]
  }
  if (cond.op == null) {
    return [{ path, code: 'incomplete', missing: 'op' }]
  }
  const op = field.ops.find((o) => o.name === cond.op)
  if (!op) {
    return [{ path, code: 'op_not_allowed', field: cond.field, op: cond.op }]
  }
  if (op.valueShape === 'none') return []
  if (cond.value === undefined) {
    return [{ path, code: 'incomplete', missing: 'value' }]
  }
  if (!checkShape(cond.value, op.valueShape)) {
    return [
      {
        path,
        code: 'value_shape_mismatch',
        op: cond.op,
        expected: op.valueShape,
      },
    ]
  }
  if (!checkValueType(field, op.valueShape, cond.value)) {
    return [
      {
        path,
        code: 'value_type_mismatch',
        expected: expectedTypeLabel(field),
        got: observedTypeLabel(cond.value),
      },
    ]
  }
  return []
}

const collectErrors = (
  node: DraftNode,
  schema: FilterSchema,
  path: NodePath,
  out: ValidationError[],
): void => {
  if (isGroup(node)) {
    const group = node as DraftGroup
    group.children.forEach((child, i) => {
      collectErrors(child, schema, [...path, i], out)
    })
    return
  }
  out.push(...validateCondition(node as DraftCondition, schema, path))
}

export const validate = (
  draft: DraftAST,
  schema: FilterSchema,
): { ok: true, ast: ValidAST } | { ok: false, errors: ValidationError[] } => {
  const errors: ValidationError[] = []
  collectErrors(draft, schema, [], errors)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, ast: prune(draft, schema) }
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
