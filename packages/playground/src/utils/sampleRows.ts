import type { SchemaSpec, FieldSpec } from './schemaSpec.ts'

export type SampleRow = { id: number } & Record<string, unknown>

const WORDS = ['Hello World', 'hello', 'Release notes', 'foo%bar', '', 'Weekly digest', 'draft idea', 'Changelog']
const TAGS = ['news', 'tech', 'life', 'urgent']
const ROW_COUNT = 10
const DAY = 86_400_000

// Deterministic sample values per field type, with a NULL every few rows
// so the negated ops' NULL handling is visible.
const valueFor = (spec: FieldSpec, i: number, now: number): unknown => {
  if (i % 5 === 4) return null
  switch (spec.type) {
    case 'string':
      return WORDS[i % WORDS.length]
    case 'number':
      return (i * 37) % 100
    case 'boolean':
      return i % 2 === 0
    case 'enum':
      return spec.values.length === 0 ? null : spec.values[i % spec.values.length]
    case 'date':
      return new Date(now - i * 9 * DAY).toISOString().slice(0, 10)
    case 'datetime':
      return new Date(now - i * i * 3 * DAY - i * 3_600_000).toISOString()
    case 'id':
      return (i % 8) + 1
    case 'array':
      if (spec.itemType === 'number') return Array.from({ length: i % 3 }, (_, k) => k + i)
      return TAGS.filter((_, k) => (i >> k) & 1)
  }
}

export const buildSampleRows = (spec: SchemaSpec, now = Date.now()): SampleRow[] =>
  Array.from({ length: ROW_COUNT }, (_, i) => {
    const row: SampleRow = { id: i + 1 }
    for (const [key, fieldSpec] of Object.entries(spec.fields)) {
      row[key] = valueFor(fieldSpec, i, now)
    }
    return row
  })
