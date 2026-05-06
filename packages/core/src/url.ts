import { emptyAst } from './ast.ts'
import { checkShape, checkValueType } from './check.ts'
import type {
  Combinator,
  DroppedNode,
  FilterSchema,
  NodePath,
  ValidAST,
  ValidGroup,
  ValidNode,
} from './types.ts'

export const COMPACT_KEYS = {
  combinator: 'c',
  children: 'n',
  field: 'f',
  op: 'o',
  value: 'v',
} as const

type CompactGroup = { c: Combinator, n: CompactNode[] }
type CompactCondition = { f: string, o: string, v?: unknown }
type CompactNode = CompactGroup | CompactCondition

const isCompactGroup = (x: Record<string, unknown>): x is CompactGroup =>
  'c' in x && 'n' in x && Array.isArray((x as { n: unknown }).n)

const compactifyNode = (n: ValidNode): CompactNode => {
  if ('combinator' in n) {
    return { c: n.combinator, n: n.children.map(compactifyNode) }
  }
  const out: CompactCondition = { f: n.field, o: n.op }
  if (n.value !== undefined) out.v = n.value
  return out
}

export const toUrl = (ast: ValidAST): string => {
  if (ast.children.length === 0) return ''
  return encodeURIComponent(JSON.stringify(compactifyNode(ast)))
}

const decompactNode = (
  raw: unknown,
  schema: FilterSchema,
  path: NodePath,
  dropped: DroppedNode[],
  isRoot: boolean,
): ValidNode | null => {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    dropped.push({ path, reason: 'value_type_mismatch', detail: { got: typeof raw } })
    return null
  }
  const obj = raw as Record<string, unknown>

  if (isCompactGroup(obj)) {
    if (obj.c !== 'and' && obj.c !== 'or') {
      dropped.push({ path, reason: 'value_type_mismatch', detail: { combinator: obj.c } })
      return null
    }
    const children: ValidNode[] = []
    obj.n.forEach((child, i) => {
      const decoded = decompactNode(child, schema, [...path, i], dropped, false)
      if (decoded !== null) children.push(decoded)
    })
    if (!isRoot) {
      if (children.length === 0) return null
      if (children.length === 1) return children[0]!
    }
    return { combinator: obj.c, children } as ValidGroup
  }

  // condition
  const fieldName = obj.f
  const opName = obj.o
  if (typeof fieldName !== 'string') {
    dropped.push({ path, reason: 'unknown_field' })
    return null
  }
  const fieldDef = schema.fields[fieldName]
  if (!fieldDef) {
    dropped.push({ path, reason: 'unknown_field', detail: { field: fieldName } })
    return null
  }
  if (typeof opName !== 'string') {
    dropped.push({ path, reason: 'op_not_allowed', detail: { field: fieldName } })
    return null
  }
  const op = fieldDef.ops.find((o) => o.name === opName)
  if (!op) {
    dropped.push({ path, reason: 'op_not_allowed', detail: { field: fieldName, op: opName } })
    return null
  }
  if (op.valueShape === 'none') {
    if ('v' in obj) {
      dropped.push({
        path,
        reason: 'value_shape_mismatch',
        detail: { op: opName, expected: 'none' },
      })
      return null
    }
    return { field: fieldName, op: opName, value: undefined }
  }
  if (!('v' in obj)) {
    dropped.push({ path, reason: 'incomplete', detail: { missing: 'value' } })
    return null
  }
  if (!checkShape(obj.v, op.valueShape)) {
    dropped.push({
      path,
      reason: 'value_shape_mismatch',
      detail: { op: opName, expected: op.valueShape },
    })
    return null
  }
  if (!checkValueType(fieldDef, op.valueShape, obj.v)) {
    dropped.push({
      path,
      reason: 'value_type_mismatch',
      detail: { field: fieldName, op: opName },
    })
    return null
  }
  return { field: fieldName, op: opName, value: obj.v }
}

export const fromUrl = (
  encoded: string,
  schema: FilterSchema,
): { ast: ValidAST, dropped: DroppedNode[] } => {
  if (encoded === '') return { ast: emptyAst(), dropped: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(encoded))
  } catch {
    return {
      ast: emptyAst(),
      dropped: [{ path: [], reason: 'value_type_mismatch', detail: 'parse_error' }],
    }
  }

  // Version sniffer: a future envelope shape is { v: <number>, ast: ... }.
  // Day-1 emits bare AST (root group). At root, a bare group has `c` and `n`
  // but never a top-level numeric `v`, so detection is unambiguous.
  if (
    parsed != null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as { v?: unknown }).v === 'number'
  ) {
    throw new Error(
      `[dql-kit/core] URL envelope version ${(parsed as { v: number }).v} is not supported by this build.`,
    )
  }

  const dropped: DroppedNode[] = []
  const result = decompactNode(parsed, schema, [], dropped, true)
  if (result === null || !('combinator' in result)) {
    return { ast: emptyAst(), dropped }
  }
  return { ast: result as ValidAST, dropped }
}
