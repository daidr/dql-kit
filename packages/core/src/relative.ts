import type { RelativeUnit } from './check.ts'

const DAY_MS = 86_400_000
const UNIT_MS: Partial<Record<RelativeUnit, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
}

/**
 * Move an instant by `amount unit`, the way PostgreSQL adds an interval
 * to a timestamp: fixed-length units in milliseconds; months and years
 * on the UTC calendar, clamped to the end of a shorter month, with a
 * fractional month counted as 30-day days.
 */
export const shiftByInterval = (
  from: Date,
  amount: number,
  unit: RelativeUnit,
  sign: 1 | -1,
): Date => {
  const fixed = UNIT_MS[unit]
  if (fixed !== undefined) return new Date(from.getTime() + sign * amount * fixed)
  const months = unit === 'year' ? amount * 12 : amount
  const whole = Math.trunc(months)
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth() + sign * whole
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const shifted = Date.UTC(
    y, m, Math.min(from.getUTCDate(), lastDay),
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds(),
  )
  return new Date(shifted + sign * (months - whole) * 30 * DAY_MS)
}

const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10)

/**
 * Inclusive UTC calendar-day range of a relative op on a `date` field,
 * as `YYYY-MM-DD` strings. Shared by the in-memory evaluator and the SQL
 * adapters so both cut days the same way.
 *
 * - `inLast` → from `today − amount unit` (inclusive), no upper bound
 *   (like `inLast` on datetime, which has none either);
 * - `inNext` → from today to `today + amount unit`, both inclusive.
 *
 * `notInLast` is the negation of `inLast`.
 */
export const relativeDateRange = (
  op: 'inLast' | 'inNext',
  value: { amount: number, unit: RelativeUnit },
  now: Date,
): { from: string, to?: string } => {
  const today = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS)
  if (op === 'inLast') {
    return { from: isoDay(shiftByInterval(today, value.amount, value.unit, -1).getTime()) }
  }
  return {
    from: isoDay(today.getTime()),
    to: isoDay(shiftByInterval(today, value.amount, value.unit, 1).getTime()),
  }
}
