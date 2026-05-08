import { describe, expect, test } from 'bun:test'
import { defineFilterSchema, f } from '@dql-kit/core'
import { provideDiagnostics } from '../src/lsp/diagnostics.ts'

const schema = defineFilterSchema({
  fields: {
    title:    f.string(),
    rating:   f.number(),
    count:    f.number(),
    status:   f.enum(['draft', 'published'] as const),
    isActive: f.boolean(),
    name:     f.string(),
  },
})

describe('provideDiagnostics — clean input', () => {
  test('empty document has no diagnostics', async () => {
    const d = await provideDiagnostics('', schema)
    expect(d).toEqual([])
  })

  test('legal single condition has no diagnostics', async () => {
    const d = await provideDiagnostics('title contains "hi"', schema)
    expect(d).toEqual([])
  })

  test('legal complex document has no diagnostics', async () => {
    const text =
      '(title contains "x" or status in ["draft"]) and rating between 1..10'
    const d = await provideDiagnostics(text, schema)
    expect(d).toEqual([])
  })
})

describe('provideDiagnostics — syntax errors map to ranges', () => {
  test('unclosed string', async () => {
    const d = await provideDiagnostics('title contains "hi', schema)
    expect(d.some((e) => e.code === 'unclosed_string')).toBe(true)
    const e = d.find((e) => e.code === 'unclosed_string')!
    expect(e.severity).toBe('error')
  })

  test('mixed and/or', async () => {
    const d = await provideDiagnostics('a = 1 and b = 2 or c = 3', schema)
    expect(d.some((e) => e.code === 'mixed_combinator')).toBe(true)
  })

  test('unmatched paren', async () => {
    const d = await provideDiagnostics('(a = 1', schema)
    expect(d.some((e) => e.code === 'unmatched_paren')).toBe(true)
  })

  test('unmatched bracket', async () => {
    const d = await provideDiagnostics('status in ["a"', schema)
    expect(d.some((e) => e.code === 'unmatched_bracket')).toBe(true)
  })
})

describe('provideDiagnostics — schema errors highlight precise sub-range', () => {
  test('unknown_field highlights the field token', async () => {
    const text = 'bogus contains "hi"'
    const d = await provideDiagnostics(text, schema)
    const e = d.find((e) => e.code === 'unknown_field')
    expect(e).toBeDefined()
    expect(text.slice(e!.range.from, e!.range.to)).toBe('bogus')
  })

  test('op_not_allowed highlights the op token', async () => {
    const text = 'title bogusOp "hi"'
    const d = await provideDiagnostics(text, schema)
    const e = d.find((e) => e.code === 'op_not_allowed')
    expect(e).toBeDefined()
    expect(text.slice(e!.range.from, e!.range.to)).toBe('bogusOp')
  })

  test('value_type_mismatch highlights the value token', async () => {
    const text = 'rating = "not-a-number"'
    const d = await provideDiagnostics(text, schema)
    const e = d.find((e) => e.code === 'value_type_mismatch')
    expect(e).toBeDefined()
    expect(text.slice(e!.range.from, e!.range.to)).toBe('"not-a-number"')
  })

  test('value_shape_mismatch on `between` with single scalar', async () => {
    // `between` is pair-shape — passing a single number triggers the
    // mismatch.
    const text = 'count between 5'
    const d = await provideDiagnostics(text, schema)
    expect(d.some((e) => e.code === 'value_shape_mismatch')).toBe(true)
  })
})

describe('provideDiagnostics — incomplete severity', () => {
  test('default `incomplete` is hint-level (Q9)', async () => {
    const d = await provideDiagnostics('title', schema)
    const e = d.find((e) => e.code === 'incomplete')
    expect(e).toBeDefined()
    expect(e!.severity).toBe('hint')
  })

  test('overrideable to error', async () => {
    const d = await provideDiagnostics('title', schema, {
      incompleteSeverity: 'error',
    })
    const e = d.find((e) => e.code === 'incomplete')
    expect(e!.severity).toBe('error')
  })
})

describe('provideDiagnostics — empty enum value reports value_type_mismatch', () => {
  test('"bogus-status" → not in enumValues → mismatch', async () => {
    const d = await provideDiagnostics('status = "bogus-status"', schema)
    expect(d.some((e) => e.code === 'value_type_mismatch')).toBe(true)
  })
})
