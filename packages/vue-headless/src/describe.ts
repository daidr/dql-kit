import {
  describeAst,
  type DescribedGroup,
  type FieldDef,
  type FilterSchema,
  type Label,
  type ValidAST,
} from '@dql-kit/core'
import { resolveOpLabel } from './labels.ts'
import type { DqlKitState } from './plugin.ts'
import type { LabelStatus } from './types.ts'

const text = (label: Label | undefined): string | undefined =>
  label === undefined ? undefined : typeof label === 'function' ? label() : label

const isIdField = (field: FieldDef): boolean => {
  const el = field.typeId === 'array' && field.itemType ? field.itemType : field
  return (el.delegateTo ?? el.typeId) === 'id'
}

/**
 * `describeAst` with the UI's labels: op labels and relative / period
 * unit labels from the plugin, and id values through `labelOf`
 * (`status: 'loading'` while a label is being fetched, `'error'` and
 * `#id` when it failed).
 */
export const describeWithLabels = (
  ast: ValidAST,
  schema: FilterSchema,
  state: DqlKitState | null,
  labelOf: (fieldKey: string, id: string | number) => LabelStatus,
): DescribedGroup =>
  describeAst(ast, schema, {
    opLabel: (op) => resolveOpLabel(op, state),
    valueText: (part, ctx) => {
      if (part.kind === 'relative') {
        const unit = text(state?.relativeUnitLabels[part.unit])
        return unit === undefined ? undefined : `${part.amount} ${unit}`
      }
      if (part.kind === 'period') {
        const labels = state?.periodLabels
        if (!labels) return undefined
        const unit = text(labels[part.unit]) ?? part.unit
        const word = part.offset === 0 ? 'current' : part.offset === -1 ? 'previous' : part.offset === 1 ? 'next' : undefined
        if (word) return `${text(labels[word]) ?? word} ${unit}`
        return `${unit} ${part.offset > 0 ? '+' : ''}${part.offset}`
      }
      if (!isIdField(ctx.field)) return undefined
      const id = part.value
      if (typeof id !== 'string' && typeof id !== 'number') return undefined
      const s = labelOf(ctx.fieldKey, id)
      if (s.status === 'resolved') return s.label
      if (s.status === 'pending') return { text: '…', status: 'loading' }
      return { text: `#${id}`, status: 'error' }
    },
  })
