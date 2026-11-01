import type { FieldDef, FilterSchema, Label } from '@dql-kit/core'

export type FieldGroupEntry = { key: string, def: FieldDef }

export type FieldGroup = {
  /** The schema's group key, or `null` for fields without a (known) group. */
  key: string | null
  label: Label | undefined
  fields: FieldGroupEntry[]
}

const isProductionMode = (): boolean => {
  try {
    const g = globalThis as { process?: { env?: { NODE_ENV?: string } } }
    return g.process?.env?.NODE_ENV === 'production'
  } catch {
    return false
  }
}
const warned = new Set<string>()

/**
 * The schema's fields in their groups, for a field picker. Groups are
 * sorted by `order` (groups without one follow, in declaration order),
 * and fields keep declaration order within a group. Fields without a
 * group, or naming a group the schema doesn't declare, come last under
 * `key: null`; an undeclared group warns once outside production.
 * Empty groups are left out.
 */
export const groupFields = (schema: FilterSchema): FieldGroup[] => {
  const declared = Object.entries(schema.groups ?? {})
  const byKey = new Map<string, FieldGroup>()
  const ordered = declared
    .map(([key, meta], i) => ({ key, meta, i }))
    .sort((a, b) => (a.meta.order ?? Infinity) - (b.meta.order ?? Infinity) || a.i - b.i)
  for (const { key, meta } of ordered) byKey.set(key, { key, label: meta.label, fields: [] })
  const ungrouped: FieldGroup = { key: null, label: undefined, fields: [] }

  for (const [key, def] of Object.entries(schema.fields)) {
    const group = def.group === undefined ? undefined : byKey.get(def.group)
    if (def.group !== undefined && !group && !isProductionMode() && !warned.has(def.group)) {
      warned.add(def.group)
      // eslint-disable-next-line no-console
      console.warn(
        `[dql-kit/vue] Field "${key}" names group "${def.group}", which the schema doesn't declare. `
          + 'It is listed with the ungrouped fields.',
      )
    }
    ;(group ?? ungrouped).fields.push({ key, def })
  }
  return [...byKey.values(), ungrouped].filter((g) => g.fields.length > 0)
}
