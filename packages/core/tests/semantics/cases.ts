// Shared op-semantics cases: one fixture table, many conditions, and the
// row ids each condition must select. The in-memory evaluator (core) and
// every SQL adapter run this same file, so they can't disagree about NULL
// handling, bounds or case sensitivity without a test failing.
//
// The rules come from the "Op semantics" table in DESIGN.md. When adding
// an op, add its cases here first.

import { builtinOps, defineFilterSchema, f } from '../../src/index.ts'

export const semanticsSchema = defineFilterSchema({
  fields: {
    title: f.string(),
    code: f.string({ caseSensitive: true }),
    rating: f.number({ nullable: true }),
    status: f.enum(['draft', 'published'] as const, { nullable: true }),
    ownerId: f.id<number>({ nullable: true }),
    active: f.boolean({ nullable: true }),
    day: f.date({ nullable: true }).withOps([builtinOps.neq, builtinOps.notBetween]),
    at: f.datetime({ nullable: true }),
    seenAt: f.datetime(),
    dueDay: f.date(),
    tags: f.array(f.string()),
  },
})

export type SemanticsRow = {
  id: number
  title: string | null
  code: string | null
  rating: number | null
  status: 'draft' | 'published' | null
  ownerId: number | null
  active: boolean | null
  /** `YYYY-MM-DD`, as a PG `date` column returns it in string mode. */
  day: string | null
  /** ISO instant. */
  at: string | null
  /** ISO instant relative to the fixture's `now`, for `inLast`. */
  seenAt: string | null
  /** `YYYY-MM-DD` relative to the fixture's `now`, for relative ops on dates. */
  dueDay: string | null
  tags: string[] | null
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Fixture rows. `seenAt` is relative to `now` with wide margins, so a SQL
 * run whose `NOW()` is a few seconds off from `now` still agrees.
 */
export const semanticsRows = (now: Date): SemanticsRow[] => {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const dayOffset = (days: number) => new Date(now.getTime() + days * DAY).toISOString().slice(0, 10)
  return [
    {
      id: 1, title: 'Hello World', code: 'AB-1', rating: 5, status: 'published', ownerId: 1, active: true,
      day: '2024-01-31', at: '2024-01-31T18:30:00Z', seenAt: ago(1 * HOUR), dueDay: dayOffset(-1), tags: ['a', 'b'],
    },
    {
      id: 2, title: 'hello', code: 'ab-1', rating: 3, status: 'draft', ownerId: 2, active: false,
      day: '2024-01-30', at: '2024-01-30T23:59:59Z', seenAt: ago(3 * DAY), dueDay: dayOffset(3), tags: ['b'],
    },
    {
      id: 3, title: 'foo%bar', code: 'Ab-2', rating: 1, status: 'draft', ownerId: 1, active: true,
      day: '2024-02-01', at: '2024-02-01T00:00:00Z', seenAt: ago(40 * DAY), dueDay: dayOffset(-40), tags: [],
    },
    {
      id: 4, title: '', code: null, rating: null, status: null, ownerId: null, active: null,
      day: null, at: null, seenAt: null, dueDay: null, tags: null,
    },
    {
      // 2024-01-31T00:00:00+08:00 is 2024-01-30T16:00:00Z.
      id: 5, title: null, code: '', rating: 4, status: 'published', ownerId: 3, active: false,
      day: '2023-12-31', at: '2024-01-31T00:00:00+08:00', seenAt: ago(400 * DAY), dueDay: dayOffset(400), tags: ['c'],
    },
  ]
}

type Cond = { field: string, op: string, value?: unknown }
type Node = Cond | { combinator: 'and' | 'or', children: Node[] }

export type SemanticsCase = {
  name: string
  /** A condition, or a group for combinator cases. */
  node: Node
  expected: number[]
}

const c = (name: string, node: Node, expected: number[]): SemanticsCase => ({ name, node, expected })

export const semanticsCases: SemanticsCase[] = [
  // string
  c('string eq ignores case', { field: 'title', op: 'eq', value: 'HELLO' }, [2]),
  c('string neq ignores case, keeps NULL and empty', { field: 'title', op: 'neq', value: 'HELLO' }, [1, 3, 4, 5]),
  c('string in ignores case', { field: 'title', op: 'in', value: ['hello', 'hello world'] }, [1, 2]),
  c('string notIn ignores case, keeps NULL', { field: 'title', op: 'notIn', value: ['HELLO'] }, [1, 3, 4, 5]),
  c('string contains is case-insensitive', { field: 'title', op: 'contains', value: 'HELLO' }, [1, 2]),
  c('string contains treats % literally', { field: 'title', op: 'contains', value: '%' }, [3]),
  c('string contains treats _ literally', { field: 'title', op: 'contains', value: '_' }, []),
  c('string notContains keeps NULL and empty', { field: 'title', op: 'notContains', value: 'hello' }, [3, 4, 5]),
  c('string startsWith', { field: 'title', op: 'startsWith', value: 'he' }, [1, 2]),
  c('string endsWith', { field: 'title', op: 'endsWith', value: 'BAR' }, [3]),
  c('string isEmpty: NULL or empty', { field: 'title', op: 'isEmpty' }, [4, 5]),
  c('string notEmpty', { field: 'title', op: 'notEmpty' }, [1, 2, 3]),

  // case-sensitive string
  c('caseSensitive eq is exact', { field: 'code', op: 'eq', value: 'ab-1' }, [2]),
  c('caseSensitive neq is exact, keeps NULL', { field: 'code', op: 'neq', value: 'ab-1' }, [1, 3, 4, 5]),
  c('caseSensitive in is exact', { field: 'code', op: 'in', value: ['AB-1', 'Ab-2'] }, [1, 3]),
  c('caseSensitive contains is exact', { field: 'code', op: 'contains', value: 'b-' }, [2, 3]),
  c('caseSensitive notContains is exact', { field: 'code', op: 'notContains', value: 'B-' }, [2, 3, 4, 5]),
  c('caseSensitive startsWith is exact', { field: 'code', op: 'startsWith', value: 'A' }, [1, 3]),
  c('caseSensitive endsWith is exact', { field: 'code', op: 'endsWith', value: '-1' }, [1, 2]),

  // number
  c('number eq', { field: 'rating', op: 'eq', value: 3 }, [2]),
  c('number neq keeps NULL', { field: 'rating', op: 'neq', value: 3 }, [1, 3, 4, 5]),
  c('number gt', { field: 'rating', op: 'gt', value: 3 }, [1, 5]),
  c('number gte', { field: 'rating', op: 'gte', value: 3 }, [1, 2, 5]),
  c('number lt', { field: 'rating', op: 'lt', value: 3 }, [3]),
  c('number lte', { field: 'rating', op: 'lte', value: 3 }, [2, 3]),
  c('number between is inclusive', { field: 'rating', op: 'between', value: [3, 4] }, [2, 5]),
  c('number in', { field: 'rating', op: 'in', value: [1, 5] }, [1, 3]),
  c('number notIn keeps NULL', { field: 'rating', op: 'notIn', value: [1, 5] }, [2, 4, 5]),
  c('number notBetween keeps NULL', { field: 'rating', op: 'notBetween', value: [3, 4] }, [1, 3, 4]),
  c('nullable number isEmpty', { field: 'rating', op: 'isEmpty' }, [4]),
  c('nullable number notEmpty', { field: 'rating', op: 'notEmpty' }, [1, 2, 3, 5]),
  c('nullable enum isEmpty', { field: 'status', op: 'isEmpty' }, [4]),
  c('nullable id notEmpty', { field: 'ownerId', op: 'notEmpty' }, [1, 2, 3, 5]),
  c('nullable boolean isEmpty', { field: 'active', op: 'isEmpty' }, [4]),
  c('nullable date isEmpty', { field: 'day', op: 'isEmpty' }, [4]),
  c('nullable datetime notEmpty', { field: 'at', op: 'notEmpty' }, [1, 2, 3, 5]),

  // enum / id / boolean
  c('enum eq', { field: 'status', op: 'eq', value: 'draft' }, [2, 3]),
  c('enum neq keeps NULL', { field: 'status', op: 'neq', value: 'draft' }, [1, 4, 5]),
  c('enum in', { field: 'status', op: 'in', value: ['published'] }, [1, 5]),
  c('enum notIn keeps NULL', { field: 'status', op: 'notIn', value: ['published'] }, [2, 3, 4]),
  c('id eq', { field: 'ownerId', op: 'eq', value: 1 }, [1, 3]),
  c('id neq keeps NULL', { field: 'ownerId', op: 'neq', value: 1 }, [2, 4, 5]),
  c('id in', { field: 'ownerId', op: 'in', value: [2, 3] }, [2, 5]),
  c('id notIn keeps NULL', { field: 'ownerId', op: 'notIn', value: [2, 3] }, [1, 3, 4]),
  c('boolean eq true', { field: 'active', op: 'eq', value: true }, [1, 3]),
  c('boolean eq false skips NULL', { field: 'active', op: 'eq', value: false }, [2, 5]),

  // date (UTC calendar days)
  c('date eq', { field: 'day', op: 'eq', value: '2024-01-31' }, [1]),
  c('date neq keeps NULL', { field: 'day', op: 'neq', value: '2024-01-31' }, [2, 3, 4, 5]),
  c('date before is exclusive', { field: 'day', op: 'before', value: '2024-01-31' }, [2, 5]),
  c('date after is exclusive', { field: 'day', op: 'after', value: '2024-01-31' }, [3]),
  c('date between is inclusive', { field: 'day', op: 'between', value: ['2024-01-30', '2024-01-31'] }, [1, 2]),
  c('date notBetween keeps NULL', { field: 'day', op: 'notBetween', value: ['2024-01-30', '2024-01-31'] }, [3, 4, 5]),
  c('date onOrBefore is inclusive', { field: 'day', op: 'onOrBefore', value: '2024-01-30' }, [2, 5]),
  c('date onOrAfter is inclusive', { field: 'day', op: 'onOrAfter', value: '2024-01-31' }, [1, 3]),
  c('date inLast 7 day', { field: 'dueDay', op: 'inLast', value: { amount: 7, unit: 'day' } }, [1, 2, 5]),
  c('date inLast 2 month', { field: 'dueDay', op: 'inLast', value: { amount: 2, unit: 'month' } }, [1, 2, 3, 5]),
  c('date inNext 7 day', { field: 'dueDay', op: 'inNext', value: { amount: 7, unit: 'day' } }, [2]),
  c('date inNext 2 year', { field: 'dueDay', op: 'inNext', value: { amount: 2, unit: 'year' } }, [2, 5]),
  c('date notInLast 7 day keeps NULL', { field: 'dueDay', op: 'notInLast', value: { amount: 7, unit: 'day' } }, [3, 4]),

  // datetime (instants)
  c('datetime before', { field: 'at', op: 'before', value: '2024-01-31T00:00:00Z' }, [2, 5]),
  c('datetime after', { field: 'at', op: 'after', value: '2024-01-31T00:00:00Z' }, [1, 3]),
  c('datetime before compares instants across offsets', { field: 'at', op: 'before', value: '2024-01-31T08:00:00+08:00' }, [2, 5]),
  c('datetime before is exclusive', { field: 'at', op: 'before', value: '2024-02-01T00:00:00Z' }, [1, 2, 5]),
  c('datetime onOrBefore is inclusive', { field: 'at', op: 'onOrBefore', value: '2024-02-01T00:00:00Z' }, [1, 2, 3, 5]),
  c('datetime onOrAfter is inclusive', { field: 'at', op: 'onOrAfter', value: '2024-01-31T18:30:00Z' }, [1, 3]),
  c(
    'datetime between is inclusive',
    { field: 'at', op: 'between', value: ['2024-01-30T16:00:00Z', '2024-01-31T18:30:00Z'] },
    [1, 2, 5],
  ),
  c('inLast 30 minute', { field: 'seenAt', op: 'inLast', value: { amount: 30, unit: 'minute' } }, []),
  c('inLast 2 hour', { field: 'seenAt', op: 'inLast', value: { amount: 2, unit: 'hour' } }, [1]),
  c('inLast 1 day', { field: 'seenAt', op: 'inLast', value: { amount: 1, unit: 'day' } }, [1]),
  c('inLast 1 week', { field: 'seenAt', op: 'inLast', value: { amount: 1, unit: 'week' } }, [1, 2]),
  c('inLast 1 month', { field: 'seenAt', op: 'inLast', value: { amount: 1, unit: 'month' } }, [1, 2]),
  c('inLast 2 month', { field: 'seenAt', op: 'inLast', value: { amount: 2, unit: 'month' } }, [1, 2, 3]),
  c('inLast 2 year', { field: 'seenAt', op: 'inLast', value: { amount: 2, unit: 'year' } }, [1, 2, 3, 5]),
  c('notInLast 1 week keeps NULL', { field: 'seenAt', op: 'notInLast', value: { amount: 1, unit: 'week' } }, [3, 4, 5]),
  c('inNext excludes the past', { field: 'seenAt', op: 'inNext', value: { amount: 1, unit: 'year' } }, []),

  // array
  c('array contains', { field: 'tags', op: 'contains', value: 'b' }, [1, 2]),
  c('array contains is exact', { field: 'tags', op: 'contains', value: 'B' }, []),
  c('array notContains keeps NULL and empty', { field: 'tags', op: 'notContains', value: 'b' }, [3, 4, 5]),
  c('array containsAll', { field: 'tags', op: 'containsAll', value: ['a', 'b'] }, [1]),
  c('array containsAny', { field: 'tags', op: 'containsAny', value: ['a', 'c'] }, [1, 5]),
  c('array containsAny with no shared element', { field: 'tags', op: 'containsAny', value: ['z'] }, []),
  c('array isEmpty: NULL or zero length', { field: 'tags', op: 'isEmpty' }, [3, 4]),
  c('array notEmpty', { field: 'tags', op: 'notEmpty' }, [1, 2, 5]),

  // groups
  c(
    'or group',
    { combinator: 'or', children: [{ field: 'status', op: 'eq', value: 'draft' }, { field: 'rating', op: 'gt', value: 4 }] },
    [1, 2, 3],
  ),
  c(
    'and group with a nested or',
    {
      combinator: 'and',
      children: [
        { field: 'title', op: 'contains', value: 'hello' },
        { combinator: 'or', children: [{ field: 'active', op: 'eq', value: false }, { field: 'rating', op: 'gt', value: 4 }] },
      ],
    },
    [1, 2],
  ),
]

/** Wrap a case's node in a root group, as `parseAst` expects. */
export const rootOf = (node: Node) =>
  'combinator' in node ? node : { combinator: 'and' as const, children: [node] }
