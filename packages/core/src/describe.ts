import type { RelativeUnit } from './check.ts'
import type { PeriodUnit } from './period.ts'
import type {
  Combinator,
  FieldDef,
  FilterSchema,
  Label,
  OpDef,
  ValidAST,
  ValidNode,
  ValueShape,
} from './types.ts'

/**
 * Human-readable description of a valid AST: a tree mirroring the AST,
 * with field / op labels resolved and each value split into parts.
 * Works without a UI (audit logs, notifications, server-side summaries);
 * the Vue layer adds plugin labels and resolved id labels on top.
 */

/**
 * Display state of a part whose text is still being looked up (an id
 * label that is loading, or failed to load). Absent = final text.
 */
export type ValuePartStatus = 'loading' | 'error'

/** One value of a condition, raw, with the text it displays as. */
export type ValuePart = RawValuePart & { text: string, status?: ValuePartStatus }

/** A `ValuePart` before its text is filled in. */
export type RawValuePart =
  | { kind: 'scalar', value: unknown }
  | { kind: 'relative', amount: number, unit: RelativeUnit }
  | { kind: 'period', unit: PeriodUnit, offset: number }

export type DescribedCondition = {
  kind: 'condition'
  path: number[]
  field: string
  op: string
  shape: ValueShape
  fieldLabel: string
  opLabel: string
  valueParts: ValuePart[]
  /** `fieldLabel opLabel values`, e.g. `Status is any of Draft, Published`. */
  text: string
}

export type DescribedGroup = {
  kind: 'group'
  path: number[]
  combinator: Combinator
  children: DescribedNode[]
  /** Children joined by `AND` / `OR`; nested groups in parentheses. */
  text: string
}

export type DescribedNode = DescribedCondition | DescribedGroup

export type DescribeContext = { fieldKey: string, field: FieldDef }

export type DescribeOptions = {
  /** Label of an op. Defaults to the op's schema label, then its name. */
  opLabel?: (op: OpDef, ctx: DescribeContext) => string | undefined
  /**
   * Text of one value. Return `undefined` to keep the default: enum
   * value labels, `7 day` for relative values, `current month` /
   * `previous week` / `month -3` for periods, `String(value)` otherwise.
   * Return `{ text, status }` to mark a text as provisional.
   */
  valueText?: (
    part: RawValuePart,
    ctx: DescribeContext,
  ) => string | { text: string, status?: ValuePartStatus } | undefined
}

const labelText = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
}

const elementField = (field: FieldDef): FieldDef =>
  field.typeId === 'array' && field.itemType ? field.itemType : field

const periodWord = (offset: number): string | undefined =>
  offset === 0 ? 'current' : offset === -1 ? 'previous' : offset === 1 ? 'next' : undefined

/** Default text of a value part (see `DescribeOptions.valueText`). */
export const defaultValueText = (part: RawValuePart, ctx: DescribeContext): string => {
  switch (part.kind) {
    case 'relative':
      return `${part.amount} ${part.unit}`
    case 'period': {
      const word = periodWord(part.offset)
      if (word) return `${word} ${part.unit}`
      return `${part.unit} ${part.offset > 0 ? '+' : ''}${part.offset}`
    }
    case 'scalar': {
      const hit = elementField(ctx.field).enumValues?.find((e) => e.value === part.value)
      if (hit) return labelText(hit.label, String(hit.value))
      return String(part.value)
    }
  }
}

const rawParts = (shape: ValueShape, value: unknown): RawValuePart[] => {
  switch (shape) {
    case 'none':
      return []
    case 'pair':
    case 'list':
      return (Array.isArray(value) ? value : [value]).map((v) => ({ kind: 'scalar', value: v }))
    case 'relative': {
      const v = value as { amount: number, unit: RelativeUnit }
      return [{ kind: 'relative', amount: v.amount, unit: v.unit }]
    }
    case 'period': {
      const v = value as { unit: PeriodUnit, offset: number }
      return [{ kind: 'period', unit: v.unit, offset: v.offset }]
    }
    default:
      return [{ kind: 'scalar', value }]
  }
}

const joinValues = (shape: ValueShape, parts: ValuePart[]): string => {
  if (parts.length === 0) return ''
  if (shape === 'pair') return parts.map((p) => p.text).join(' – ')
  return parts.map((p) => p.text).join(', ')
}

/**
 * Describe `ast` against `schema`. Conditions whose field or op the
 * schema doesn't know (only possible through a cast) keep their raw
 * key / name as label.
 */
export const describeAst = (
  ast: ValidAST,
  schema: FilterSchema,
  options: DescribeOptions = {},
): DescribedGroup => {
  const visit = (node: ValidNode, path: number[]): DescribedNode => {
    if ('combinator' in node) {
      const children = node.children.map((c, i) => visit(c, [...path, i]))
      const word = node.combinator === 'and' ? ' AND ' : ' OR '
      const text = children
        .map((c) => (c.kind === 'group' && c.children.length > 1 ? `(${c.text})` : c.text))
        .join(word)
      return { kind: 'group', path, combinator: node.combinator, children, text }
    }
    const field = Object.prototype.hasOwnProperty.call(schema.fields, node.field)
      ? schema.fields[node.field]
      : undefined
    const op = field?.ops.find((o) => o.name === node.op)
    const shape: ValueShape = op?.valueShape ?? (node.value === undefined ? 'none' : 'single')
    const fieldLabel = labelText(field?.label, node.field)
    const ctx: DescribeContext = { fieldKey: node.field, field: field ?? { typeId: 'unknown', ops: [] } }
    const opLabel = (op && options.opLabel?.(op, ctx)) ?? labelText(op?.label, node.op)
    const valueParts = rawParts(shape, node.value).map((raw): ValuePart => {
      const custom = options.valueText?.(raw, ctx)
      if (custom === undefined) return { ...raw, text: defaultValueText(raw, ctx) }
      if (typeof custom === 'string') return { ...raw, text: custom }
      return { ...raw, text: custom.text, ...(custom.status && { status: custom.status }) }
    })
    const values = joinValues(shape, valueParts)
    return {
      kind: 'condition',
      path,
      field: node.field,
      op: node.op,
      shape,
      fieldLabel,
      opLabel,
      valueParts,
      text: values === '' ? `${fieldLabel} ${opLabel}` : `${fieldLabel} ${opLabel} ${values}`,
    }
  }
  return visit(ast, []) as DescribedGroup
}
