import { emptyAst } from './ast.ts'
import { expandCompactKeys, migrateAst, schemaVersion } from './migrate.ts'
import { LONG_KEYS, resolveLimits, walkAst, type NodeKeys } from './parse.ts'
import type {
  AstLimits,
  Combinator,
  DroppedNode,
  FilterSchema,
  ValidAST,
  ValidNode,
} from './types.ts'

export const COMPACT_KEYS = {
  combinator: 'c',
  children: 'n',
  field: 'f',
  op: 'o',
  value: 'v',
} as const satisfies NodeKeys

type CompactGroup = { c: Combinator, n: CompactNode[] }
type CompactCondition = { f: string, o: string, v?: unknown }
type CompactNode = CompactGroup | CompactCondition

const compactifyNode = (n: ValidNode): CompactNode => {
  if ('combinator' in n) {
    return { c: n.combinator, n: n.children.map(compactifyNode) }
  }
  const out: CompactCondition = { f: n.field, o: n.op }
  if (n.value !== undefined) out.v = n.value
  return out
}

/**
 * Serialise an AST to its URL form: compact-key JSON. The result is a
 * plain string, *not* URL-encoded — encoding belongs to whatever puts it
 * in a URL (the router, `URLSearchParams`, ...). Encoding here as well
 * would get it encoded twice.
 *
 * With a versioned `schema` the AST is wrapped in an envelope
 * `{ v: <version>, a: <ast> }`, so links outlive later schema changes
 * (see `migrations`). Without one it is the bare AST.
 */
export const toUrl = (ast: ValidAST, schema?: FilterSchema): string => {
  if (ast.children.length === 0) return ''
  const compact = compactifyNode(ast)
  const version = schema ? schemaVersion(schema) : 0
  return JSON.stringify(version > 0 ? { v: version, a: compact } : compact)
}

const parseJson = (raw: string): { ok: true, value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

// Current links carry the JSON as-is. Links shared before toUrl stopped
// encoding carry it percent-encoded once more (`%7B%22c%22...` after the
// router's own decoding), so fall back to decoding once.
const parseUrlValue = (raw: string): { ok: true, value: unknown } | { ok: false } => {
  const direct = parseJson(raw)
  if (direct.ok) return direct
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return { ok: false }
  }
  if (decoded === raw) return { ok: false }
  return parseJson(decoded)
}

/**
 * Parse a URL filter value (the output of `toUrl`) back into an AST.
 *
 * Lenient and total: never throws. Nodes that fail a check are dropped
 * and reported in `dropped`, and whatever survives is returned, so a
 * stale or hand-edited link still opens with the parts that make sense.
 * Applies the same rules as `parseAst` (including `limits`, which
 * default to `DEFAULT_AST_LIMITS`); a link that can't be parsed at all
 * yields an empty AST with a single `parse_error`, and one from a newer
 * schema version yields `unsupported_version`.
 *
 * A bare AST is version 0; an envelope `{ v, a }` carries its version.
 * Links older than the schema run through its `migrations` first, and
 * renamed fields are read through their `aliases`.
 */
export const fromUrl = <S extends FilterSchema>(
  value: string,
  schema: S,
  limits?: Partial<AstLimits>,
): { ast: ValidAST<S>, dropped: DroppedNode[] } => {
  if (value === '') return { ast: emptyAst(), dropped: [] }

  const parsed = parseUrlValue(value)
  if (!parsed.ok) {
    return { ast: emptyAst(), dropped: [{ path: [], code: 'parse_error' }] }
  }

  // Envelope sniffer: a bare AST is a root group (`c` + `n`, never a
  // top-level `v`), so a numeric `v` without `c` at the root is an
  // envelope `{ v, a }`.
  let root = parsed.value
  let version = 0
  if (
    root != null
    && typeof root === 'object'
    && !Array.isArray(root)
    && !('c' in root)
    && typeof (root as { v?: unknown }).v === 'number'
  ) {
    const env = root as { v: number, a?: unknown }
    version = env.v
    if (!Number.isInteger(version) || version < 1 || version > schemaVersion(schema)) {
      return { ast: emptyAst(), dropped: [{ path: [], code: 'unsupported_version', version }] }
    }
    if (env.a === undefined) return { ast: emptyAst(), dropped: [{ path: [], code: 'parse_error' }] }
    root = env.a
  }

  const walkOpts = { limits: resolveLimits(limits) }
  if (version === schemaVersion(schema)) {
    const { ast, errors } = walkAst(root, schema, { ...walkOpts, keys: COMPACT_KEYS })
    return { ast: ast as ValidAST<S>, dropped: errors }
  }
  // Older link: migrations work on long keys, as stored filters do.
  const migrated = migrateAst(expandCompactKeys(root), schema, version)
  if (!migrated.ok) return { ast: emptyAst(), dropped: [migrated.error] }
  const { ast, errors } = walkAst(migrated.value, schema, { ...walkOpts, keys: LONG_KEYS })
  return { ast: ast as ValidAST<S>, dropped: errors }
}
