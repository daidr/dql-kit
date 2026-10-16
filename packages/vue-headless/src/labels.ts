import type { FieldDef, Label, OpDef } from '@dql-kit/core'
import type { DqlKitState } from './plugin.ts'

/**
 * Evaluate a `Label` (plain string or lazy thunk) at call time, so
 * reactive i18n sources stay live. `fallback` is used when no label is
 * set — typically the field key or op name.
 */
export const resolveLabel = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
}

/** Display label of a schema field, falling back to its key. */
export const resolveFieldLabel = (fieldKey: string, field: FieldDef | undefined): string =>
  resolveLabel(field?.label, fieldKey)

/**
 * Display label of an op. Precedence: the plugin instance's `opLabels`
 * (from `createDqlKit`) → the label baked into the schema's `OpDef` →
 * the op name. Pass the injected `DqlKitState` (or `null` when no
 * plugin is installed).
 */
export const resolveOpLabel = (op: OpDef, state?: DqlKitState | null): string =>
  resolveLabel(state?.opLabels[op.name] ?? op.label, op.name)
