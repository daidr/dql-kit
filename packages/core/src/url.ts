import { emptyAst } from './ast.ts'
import { resolveLimits, walkAst, type NodeKeys } from './parse.ts'
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
 */
export const toUrl = (ast: ValidAST): string => {
  if (ast.children.length === 0) return ''
  return JSON.stringify(compactifyNode(ast))
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
 * yields an empty AST with a single `parse_error`, and one using a newer
 * envelope version yields `unsupported_version`.
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

  // Version sniffer: a future envelope shape is { v: <number>, ast: ... }.
  // Day-1 emits a bare root group (`c` + `n`, never a top-level `v`), so
  // a numeric `v` without `c` at the root is unambiguously an envelope.
  const root = parsed.value
  if (
    root != null
    && typeof root === 'object'
    && !Array.isArray(root)
    && !('c' in root)
    && typeof (root as { v?: unknown }).v === 'number'
  ) {
    return {
      ast: emptyAst(),
      dropped: [{ path: [], code: 'unsupported_version', version: (root as { v: number }).v }],
    }
  }

  const { ast, errors } = walkAst(root, schema, {
    keys: COMPACT_KEYS,
    limits: resolveLimits(limits),
  })
  return { ast: ast as ValidAST<S>, dropped: errors }
}
