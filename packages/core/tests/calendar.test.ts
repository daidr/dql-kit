import { describe, expect, test } from 'bun:test'
import {
  createMatcher,
  defineFilterSchema,
  f,
  parseAst,
  periodRange,
  relativeDateRange,
  resolveTimeZone,
  resolveWeekStart,
  startOfZonedDay,
  toJsonSchema,
} from '../src/index.ts'

const NY = 'America/New_York'
const iso = (t: number) => new Date(t).toISOString()

describe('resolveTimeZone', () => {
  test('defaults to UTC and canonicalises UTC aliases', () => {
    expect(resolveTimeZone(undefined)).toBe('UTC')
    expect(resolveTimeZone('Etc/UTC')).toBe('UTC')
    expect(resolveTimeZone(NY)).toBe(NY)
  })

  test('rejects unknown and empty names', () => {
    expect(() => resolveTimeZone('Mars/Olympus')).toThrow(/Unknown time zone "Mars\/Olympus"/)
    expect(() => resolveTimeZone('')).toThrow(RangeError)
  })
})

describe('resolveWeekStart', () => {
  test('defaults to Monday and accepts 0–6', () => {
    expect(resolveWeekStart(undefined)).toBe(1)
    expect(resolveWeekStart(0)).toBe(0)
    expect(() => resolveWeekStart(7)).toThrow(/weekStartsOn/)
    expect(() => resolveWeekStart(1.5)).toThrow(/weekStartsOn/)
  })
})

describe('startOfZonedDay', () => {
  test('local midnight, including on daylight-saving days', () => {
    expect(iso(startOfZonedDay('2024-03-10', 'UTC'))).toBe('2024-03-10T00:00:00.000Z')
    expect(iso(startOfZonedDay('2024-03-10', NY))).toBe('2024-03-10T05:00:00.000Z')
    expect(iso(startOfZonedDay('2024-03-11', NY))).toBe('2024-03-11T04:00:00.000Z')
    expect(iso(startOfZonedDay('2024-11-04', NY))).toBe('2024-11-04T05:00:00.000Z')
    expect(iso(startOfZonedDay('2024-03-10', 'Asia/Kolkata'))).toBe('2024-03-09T18:30:00.000Z')
  })

  test('a skipped midnight starts the day at the jump', () => {
    // Chile moved clocks from 00:00 to 01:00 on 2024-09-08.
    expect(iso(startOfZonedDay('2024-09-08', 'America/Santiago'))).toBe('2024-09-08T04:00:00.000Z')
  })
})

describe('periodRange', () => {
  const now = new Date('2024-03-10T12:00:00Z') // Sunday

  test('each unit, half-open', () => {
    expect(periodRange({ unit: 'day', offset: 0 }, now)).toEqual({ from: '2024-03-10', to: '2024-03-11' })
    expect(periodRange({ unit: 'week', offset: 0 }, now)).toEqual({ from: '2024-03-04', to: '2024-03-11' })
    expect(periodRange({ unit: 'week', offset: 0 }, now, { weekStartsOn: 0 })).toEqual({ from: '2024-03-10', to: '2024-03-17' })
    expect(periodRange({ unit: 'month', offset: -1 }, now)).toEqual({ from: '2024-02-01', to: '2024-03-01' })
    expect(periodRange({ unit: 'quarter', offset: 0 }, now)).toEqual({ from: '2024-01-01', to: '2024-04-01' })
    expect(periodRange({ unit: 'quarter', offset: -1 }, now)).toEqual({ from: '2023-10-01', to: '2024-01-01' })
    expect(periodRange({ unit: 'year', offset: 1 }, now)).toEqual({ from: '2025-01-01', to: '2026-01-01' })
  })

  test('offsets roll over years', () => {
    expect(periodRange({ unit: 'month', offset: 10 }, now)).toEqual({ from: '2025-01-01', to: '2025-02-01' })
    expect(periodRange({ unit: 'month', offset: -3 }, now)).toEqual({ from: '2023-12-01', to: '2024-01-01' })
  })

  test('today is taken in the zone', () => {
    const late = new Date('2024-03-11T02:00:00Z') // still Sunday in New York
    expect(periodRange({ unit: 'day', offset: 0 }, late)).toEqual({ from: '2024-03-11', to: '2024-03-12' })
    expect(periodRange({ unit: 'day', offset: 0 }, late, { timeZone: NY })).toEqual({ from: '2024-03-10', to: '2024-03-11' })
    expect(relativeDateRange('inNext', { amount: 1, unit: 'day' }, late, { timeZone: NY }))
      .toEqual({ from: '2024-03-10', to: '2024-03-11' })
  })
})

describe('period values', () => {
  const s = defineFilterSchema({ fields: { at: f.datetime(), title: f.string() } })
  const run = (value: unknown, field = 'at', op = 'inPeriod') =>
    parseAst({ combinator: 'and', children: [{ field, op, value }] }, s)

  test('accepts { unit, offset } and copies it', () => {
    const input = { unit: 'month', offset: -1 }
    const r = run(input)
    if (!r.ok) throw new Error('parse')
    const value = (r.ast.children[0] as { value: unknown }).value
    expect(value).toEqual(input)
    expect(value).not.toBe(input)
  })

  test('rejects unknown units, fractional and out-of-range offsets', () => {
    for (const bad of [
      { unit: 'decade', offset: 0 },
      { unit: 'day', offset: 0.5 },
      { unit: 'day', offset: 101 },
      { unit: 'day' },
      { amount: 1, unit: 'day' },
    ]) {
      const r = run(bad)
      expect(r.ok ? [] : r.errors).toEqual([{ path: [0], code: 'value_shape_mismatch', op: 'inPeriod', expected: 'period' }])
    }
    expect(run({ unit: 'day', offset: -100 }).ok).toBe(true)
  })

  test('JSON Schema describes the period shape', () => {
    const js = JSON.stringify(toJsonSchema(s))
    expect(js).toContain('"enum":["day","week","month","quarter","year"]')
    expect(js).toContain('"offset":{"type":"integer","minimum":-100,"maximum":100}')
  })
})

describe('createMatcher calendar options', () => {
  const s = defineFilterSchema({ fields: { day: f.date() } })
  const one = (value: string) => {
    const r = parseAst({ combinator: 'and', children: [{ field: 'day', op: 'eq', value }] }, s)
    if (!r.ok) throw new Error('parse')
    return r.ast
  }

  test('validates the zone and week start at construction', () => {
    expect(() => createMatcher({ schema: s, timeZone: 'Nope/Nope' })).toThrow(/Unknown time zone/)
    expect(() => createMatcher({ schema: s, weekStartsOn: 9 as never })).toThrow(/weekStartsOn/)
  })

  test('date fields cut instants in the zone, bare days stay put', () => {
    const m = createMatcher({ schema: s, timeZone: NY })
    expect(m.matches(one('2024-03-09'), { day: new Date('2024-03-10T04:59:59Z') })).toBe(true)
    expect(m.matches(one('2024-03-10'), { day: '2024-03-10T05:00:00Z' })).toBe(true)
    expect(m.matches(one('2024-03-10'), { day: '2024-03-10' })).toBe(true)
  })
})
