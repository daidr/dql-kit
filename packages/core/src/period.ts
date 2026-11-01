import { numberToDay, resolveTimeZone, zonedDayNumber } from './zone.ts'

/** Calendar units of the `period` value shape (`inPeriod`). */
export const PERIOD_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type PeriodUnit = (typeof PERIOD_UNITS)[number]
const periodUnitSet = new Set<string>(PERIOD_UNITS)

export const isPeriodUnit = (s: unknown): s is PeriodUnit =>
  typeof s === 'string' && periodUnitSet.has(s)

/** Largest `|offset|` a period value may carry. */
export const MAX_PERIOD_OFFSET = 100

/**
 * Value of a `period`-shape op such as `inPeriod`: the calendar `unit`
 * containing today shifted by `offset` units. `{ unit: 'month', offset: 0 }`
 * is this month, `offset: -1` last month, `offset: 1` next month.
 */
export type PeriodValue<U extends PeriodUnit = PeriodUnit> = { unit: U, offset: number }

/** First day of the week: 0 = Sunday, 1 = Monday (the default), … 6 = Saturday. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type CalendarOptions = {
  /** IANA time zone that decides where days start. Defaults to UTC. */
  timeZone?: string
  /** First day of the week for `week` periods. Defaults to 1 (Monday). */
  weekStartsOn?: WeekStart
}

/** Validate `weekStartsOn`; `undefined` means Monday. */
export const resolveWeekStart = (w: number | undefined): WeekStart => {
  if (w === undefined) return 1
  if (!Number.isInteger(w) || w < 0 || w > 6) {
    throw new RangeError(`[dql-kit/core] weekStartsOn must be an integer from 0 (Sunday) to 6 (Saturday), got ${String(w)}`)
  }
  return w as WeekStart
}

export const isPeriodValue = (v: unknown): v is PeriodValue => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  return isPeriodUnit(r.unit)
    && typeof r.offset === 'number'
    && Number.isInteger(r.offset)
    && Math.abs(r.offset) <= MAX_PERIOD_OFFSET
}

const monthStart = (y: number, m: number): number => Math.floor(Date.UTC(y, m, 1) / 86_400_000)

/**
 * Half-open calendar-day range `[from, to)` of a period value, as
 * `YYYY-MM-DD` strings, with "today" taken in `timeZone`. Shared by the
 * in-memory evaluator and the SQL adapters.
 *
 * A `date` field matches days in the range; a `datetime` field matches
 * instants from the start of `from` up to (excluding) the start of `to`
 * in the same zone, so a period on a daylight-saving change is 23 or 25
 * hours long, as it is on the wall clock.
 */
export const periodRange = (
  value: PeriodValue,
  now: Date,
  options: CalendarOptions = {},
): { from: string, to: string } => {
  const timeZone = resolveTimeZone(options.timeZone)
  const weekStart = resolveWeekStart(options.weekStartsOn)
  const today = zonedDayNumber(now.getTime(), timeZone)
  const d = new Date(today * 86_400_000)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const k = value.offset
  let from: number
  let to: number
  switch (value.unit) {
    case 'day':
      from = today + k
      to = from + 1
      break
    case 'week': {
      const back = (d.getUTCDay() - weekStart + 7) % 7
      from = today - back + 7 * k
      to = from + 7
      break
    }
    case 'month':
      from = monthStart(y, m + k)
      to = monthStart(y, m + k + 1)
      break
    case 'quarter': {
      const q = m - (m % 3) + 3 * k
      from = monthStart(y, q)
      to = monthStart(y, q + 3)
      break
    }
    case 'year':
      from = monthStart(y + k, 0)
      to = monthStart(y + k + 1, 0)
      break
  }
  return { from: numberToDay(from), to: numberToDay(to) }
}
