import type { FilterSchema, ParseError } from './types.ts'

/** Current version of a schema: its `version`, or 0 when unversioned. */
export const schemaVersion = (schema: FilterSchema): number => schema.version ?? 0

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  x != null && typeof x === 'object' && !Array.isArray(x)

// Rename compact node keys (`c`/`n`/`f`/`o`/`v`) to long ones so URL
// ASTs reach migrations in the same shape as stored filters. Only node
// positions are renamed (the root and `n` entries); values pass as-is.
// Iterative, so a deeply nested hostile URL can't overflow the stack;
// the walker's limits reject it afterwards.
export const expandCompactKeys = (raw: unknown): unknown => {
  if (!isPlainObject(raw)) return raw
  const map: Record<string, string> = { c: 'combinator', n: 'children', f: 'field', o: 'op', v: 'value' }
  const rename = (node: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[map[k] ?? k] = v
    return out
  }
  const root = rename(raw)
  const stack: Record<string, unknown>[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (!Array.isArray(node.children)) continue
    node.children = node.children.map((child) => {
      if (!isPlainObject(child)) return child
      const renamed = rename(child)
      stack.push(renamed)
      return renamed
    })
  }
  return root
}

export type MigrationResult =
  | { ok: true, value: unknown }
  | { ok: false, error: ParseError }

/**
 * Bring a long-key AST JSON from `fromVersion` up to the schema's
 * version by running `migrations[fromVersion]`, `[fromVersion + 1]`, …
 * in order (a missing step is a no-op). Never throws: a newer or
 * malformed version is `unsupported_version`, a throwing migration
 * `parse_error`.
 */
export const migrateAst = (json: unknown, schema: FilterSchema, fromVersion: number): MigrationResult => {
  const current = schemaVersion(schema)
  if (!Number.isInteger(fromVersion) || fromVersion < 0 || fromVersion > current) {
    return { ok: false, error: { path: [], code: 'unsupported_version', version: fromVersion } }
  }
  let value = json
  let copied = false
  for (let v = fromVersion; v < current; v++) {
    const step = schema.migrations?.[v]
    if (!step) continue
    try {
      // Migrations may edit in place; never let them touch the caller's input.
      if (!copied) {
        value = structuredClone(value)
        copied = true
      }
      value = step(value)
    } catch {
      return { ok: false, error: { path: [], code: 'parse_error' } }
    }
  }
  return { ok: true, value }
}
