// Calendar arithmetic in an IANA time zone, on the platform's `Intl`
// time-zone data. Shared by the in-memory evaluator and the SQL
// adapters, so both cut days and periods at the same instants.

const DAY_MS = 86_400_000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const formatters = new Map<string, Intl.DateTimeFormat>()
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, fmt)
  }
  return fmt
}

const resolvedZones = new Map<string, string>()

const isUtc = (timeZone: string): boolean => timeZone === 'UTC'

/**
 * Validate an IANA time zone name and return it in canonical form.
 * `undefined` means UTC. Throws a `RangeError` for a name the runtime
 * doesn't know, so a typo fails at construction instead of silently
 * filtering in the wrong zone.
 */
export const resolveTimeZone = (timeZone: string | undefined): string => {
  if (timeZone === undefined) return 'UTC'
  if (typeof timeZone !== 'string' || timeZone === '') {
    throw new RangeError(`[dql-kit/core] timeZone must be an IANA name such as "Europe/Berlin", got ${String(timeZone)}`)
  }
  const hit = resolvedZones.get(timeZone)
  if (hit !== undefined) return hit
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
  } catch {
    throw new RangeError(`[dql-kit/core] Unknown time zone "${timeZone}"; pass an IANA name such as "Europe/Berlin".`)
  }
  if (resolved === 'Etc/UTC' || resolved === 'Etc/GMT' || resolved === 'GMT') resolved = 'UTC'
  resolvedZones.set(timeZone, resolved)
  return resolved
}

// Wall-clock time of `t` in `timeZone`, as if that wall clock were UTC.
// Second precision, which is all IANA offsets need.
const wallClock = (t: number, timeZone: string): number => {
  if (isUtc(timeZone)) return t
  const parts: Record<string, number> = {}
  for (const p of formatterFor(timeZone).formatToParts(new Date(t))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const sec = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!)
  return sec + (((t % 1000) + 1000) % 1000)
}

const offsetAt = (t: number, timeZone: string): number => wallClock(t, timeZone) - t

/** Day number (days since 1970-01-01) of the calendar day `t` falls on in `timeZone`. */
export const zonedDayNumber = (t: number, timeZone: string): number =>
  Math.floor(wallClock(t, timeZone) / DAY_MS)

/** `YYYY-MM-DD` ↔ day number. */
export const dayToNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
export const numberToDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)

/** Whether `v` is a bare `YYYY-MM-DD` calendar day (not an instant). */
export const isBareDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v)

/**
 * First instant (epoch ms) of calendar day `day` (`YYYY-MM-DD`) in
 * `timeZone`. Usually local midnight; on a day whose midnight is
 * skipped by a daylight-saving jump it is the jump itself (local 01:00),
 * and when midnight happens twice it is the first one.
 */
export const startOfZonedDay = (day: string, timeZone: string): number => {
  const wall = Date.parse(`${day}T00:00:00Z`)
  if (isUtc(timeZone)) return wall
  const target = Math.floor(wall / DAY_MS)
  // Any instant whose wall clock reads `wall` is `wall - offset` for an
  // offset in force within a day of it; try each and keep the earliest
  // that lands on the day.
  const offsets = new Set([wall - DAY_MS, wall, wall + DAY_MS].map((t) => offsetAt(t, timeZone)))
  let best: number | undefined
  for (const off of offsets) {
    const t = wall - off
    if (zonedDayNumber(t, timeZone) >= target && (best === undefined || t < best)) best = t
  }
  return best ?? wall
}
