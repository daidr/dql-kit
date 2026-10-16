import { RELATIVE_UNITS } from '../src/check.ts'
import type { FilterSchema } from '../src/types.ts'

// Seeded generator of arbitrary (mostly well-formed, often invalid)
// ASTs for cross-checking validators against `analyze`.
export const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const SCALARS: unknown[] = [
  'x', '', 'draft', 'published', 'post', 'pending', 0, 1, 2, -3.5, true, false, null,
  '2024-01-01', '2024-01-01T10:00:00Z', 'not-a-date', {}, { amount: 1, unit: 'day' },
]

export const randomAst = (schema: FilterSchema, rand: () => number, maxDepth = 4): unknown => {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const fields = Object.keys(schema.fields)
  const scalar = (): unknown => {
    const field = schema.fields[pick(fields)]!
    const enumVals = field.enumValues?.map((e) => e.value) ?? []
    return rand() < 0.3 && enumVals.length ? pick(enumVals) : pick(SCALARS)
  }
  const value = (): unknown => {
    const r = rand()
    if (r < 0.1) return undefined
    if (r < 0.45) return scalar()
    if (r < 0.65) return [scalar(), scalar()]
    if (r < 0.8) return Array.from({ length: Math.floor(rand() * 4) }, scalar)
    if (r < 0.95) {
      return { amount: pick([1, 0, -1, 2.5, '3']), unit: pick([...RELATIVE_UNITS, 'year']) }
    }
    return [scalar()]
  }
  const condition = (): unknown => {
    const key = rand() < 0.95 ? pick(fields) : 'nope'
    const field = schema.fields[key]
    const ops = field?.ops.map((o) => o.name) ?? ['eq']
    const op = rand() < 0.9 ? pick(ops) : pick(['eq', 'contains', 'inLast', 'isEmpty', 'between'])
    const v = value()
    return v === undefined ? { field: key, op } : { field: key, op, value: v }
  }
  const group = (depth: number): unknown => ({
    combinator: rand() < 0.5 ? 'and' : 'or',
    children: Array.from({ length: Math.floor(rand() * 4) }, () =>
      depth < maxDepth && rand() < 0.3 ? group(depth + 1) : condition()),
  })
  return group(1)
}
