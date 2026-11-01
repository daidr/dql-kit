import type { FieldDef, FilterSchema, GroupMeta } from './types.ts'

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const subset = <F extends Record<string, FieldDef>, K extends keyof F & string>(
  schema: FilterSchema<F>,
  keep: (key: string) => boolean,
): FilterSchema<Pick<F, K>> => {
  const fields: Record<string, FieldDef> = {}
  for (const [key, def] of Object.entries(schema.fields)) if (keep(key)) fields[key] = def
  const used = new Set(Object.values(fields).map((d) => d.group).filter((g) => g !== undefined))
  const groups: Record<string, GroupMeta> = {}
  for (const [key, meta] of Object.entries(schema.groups)) if (used.has(key)) groups[key] = meta
  return {
    fields: fields as Pick<F, K>,
    groups,
    ...(schema.version !== undefined && { version: schema.version }),
    ...(schema.migrations !== undefined && { migrations: schema.migrations }),
  }
}

const checkKeys = (schema: FilterSchema, keys: readonly string[], fn: string): void => {
  for (const key of keys) {
    if (typeof key !== 'string' || !has(schema.fields, key)) {
      throw new Error(`[dql-kit/core] ${fn}: "${String(key)}" is not a field of the schema`)
    }
  }
}

/**
 * A schema with only the fields in `keys`, for per-role field access.
 * Groups no remaining field uses are dropped; field definitions,
 * `version` and `migrations` are shared with the original. Parsing
 * against the subset rejects every other field as `unknown_field`, and
 * the result still type-checks with a translator or matcher built for
 * the full schema. Throws for a key the schema doesn't have.
 */
export const pickFields = <F extends Record<string, FieldDef>, const K extends keyof F & string>(
  schema: FilterSchema<F>,
  keys: readonly K[],
): FilterSchema<Pick<F, K>> => {
  checkKeys(schema, keys, 'pickFields')
  const set = new Set<string>(keys)
  return subset<F, K>(schema, (key) => set.has(key))
}

/** The complement of `pickFields`: every field except those in `keys`. */
export const omitFields = <F extends Record<string, FieldDef>, const K extends keyof F & string>(
  schema: FilterSchema<F>,
  keys: readonly K[],
): FilterSchema<Omit<F, K>> => {
  checkKeys(schema, keys, 'omitFields')
  const set = new Set<string>(keys)
  return subset<F, Exclude<keyof F & string, K>>(schema, (key) => !set.has(key)) as FilterSchema<Omit<F, K>>
}
