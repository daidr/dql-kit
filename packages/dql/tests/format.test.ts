import { describe, expect, test } from 'bun:test'
import { defineFilterSchema, f, prune } from '@dql-kit/core'
import type { DraftAST } from '@dql-kit/core'
import { format } from '../src/format.ts'
import { parse } from '../src/parse.ts'

const schema = defineFilterSchema({
  fields: {
    title:       f.string({ label: 'Title' }),
    rating:      f.number({ label: 'Rating' }),
    count:       f.number(),
    status:      f.enum(['draft', 'published', 'archived'] as const),
    priority:    f.enum([0, 1, 2] as const),
    isActive:    f.boolean(),
    publishedAt: f.datetime(),
    publishedOn: f.date(),
    tags:        f.array(f.string()),
    authorId:    f.id<number>(),
    name:        f.string(),
  },
})

describe('format — empty', () => {
  test('empty draft → empty string', () => {
    expect(format({ combinator: 'and', children: [] }, schema)).toBe('')
  })
})

describe('format — single condition (Q15 literals)', () => {
  test('string contains', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: 'hello' }],
    }
    expect(format(draft, schema)).toBe('title contains "hello"')
  })

  test('eq → =', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'count', op: 'eq', value: 5 }],
    }
    expect(format(draft, schema)).toBe('count = 5')
  })

  test('neq → !=', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'count', op: 'neq', value: 5 }],
    }
    expect(format(draft, schema)).toBe('count != 5')
  })

  test('boolean', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'isActive', op: 'eq', value: true }],
    }
    expect(format(draft, schema)).toBe('isActive = true')
  })

  test('none-shape op', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'name', op: 'isEmpty' }],
    }
    expect(format(draft, schema)).toBe('name isEmpty')
  })

  test('enum string', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'eq', value: 'draft' }],
    }
    expect(format(draft, schema)).toBe('status = "draft"')
  })

  test('enum number', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'priority', op: 'eq', value: 1 }],
    }
    expect(format(draft, schema)).toBe('priority = 1')
  })

  test('id number', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'authorId', op: 'eq', value: 42 }],
    }
    expect(format(draft, schema)).toBe('authorId = 42')
  })

  test('date string preserved with quotes', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'publishedOn', op: 'eq', value: '2024-01-15' }],
    }
    expect(format(draft, schema)).toBe('publishedOn = "2024-01-15"')
  })
})

describe('format — list (Q15 [a, b, c])', () => {
  test('string list', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: ['draft', 'published'] }],
    }
    expect(format(draft, schema)).toBe('status in ["draft", "published"]')
  })

  test('number list', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'priority', op: 'in', value: [0, 1, 2] }],
    }
    expect(format(draft, schema)).toBe('priority in [0, 1, 2]')
  })

  test('empty list', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: [] }],
    }
    expect(format(draft, schema)).toBe('status in []')
  })
})

describe('format — pair / range (Q15 lo..hi)', () => {
  test('numeric between', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'count', op: 'between', value: [1, 10] }],
    }
    expect(format(draft, schema)).toBe('count between 1..10')
  })

  test('date range with quotes', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{
        field: 'publishedOn',
        op: 'between',
        value: ['2024-01-01', '2024-12-31'],
      }],
    }
    expect(format(draft, schema)).toBe(
      'publishedOn between "2024-01-01".."2024-12-31"',
    )
  })
})

describe('format — relative (Q15 7 days)', () => {
  test('plural for amount > 1', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{
        field: 'publishedAt',
        op: 'inLast',
        value: { amount: 7, unit: 'day' },
      }],
    }
    expect(format(draft, schema)).toBe('publishedAt inLast 7 days')
  })

  test('singular for amount === 1', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{
        field: 'publishedAt',
        op: 'inLast',
        value: { amount: 1, unit: 'day' },
      }],
    }
    expect(format(draft, schema)).toBe('publishedAt inLast 1 day')
  })

  test('week / month / hour / minute pluralisation', () => {
    const cases: Array<[string, number, string]> = [
      ['minute', 5, 'minutes'],
      ['hour',   2, 'hours'],
      ['week',   3, 'weeks'],
      ['month',  6, 'months'],
    ]
    for (const [unit, amount, expected] of cases) {
      const draft: DraftAST = {
        combinator: 'and',
        children: [{
          field: 'publishedAt',
          op: 'inLast',
          value: { amount, unit },
        }],
      }
      expect(format(draft, schema)).toContain(`${amount} ${expected}`)
    }
  })
})

describe('format — connectors and grouping', () => {
  test('AND of two conditions', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'contains', value: 'x' },
        { field: 'count', op: 'eq', value: 5 },
      ],
    }
    expect(format(draft, schema)).toBe('title contains "x" and count = 5')
  })

  test('OR root combinator', () => {
    const draft: DraftAST = {
      combinator: 'or',
      children: [
        { field: 'count', op: 'eq', value: 1 },
        { field: 'count', op: 'eq', value: 2 },
      ],
    }
    expect(format(draft, schema)).toBe('count = 1 or count = 2')
  })

  test('non-root group always parenthesised', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        {
          combinator: 'or',
          children: [
            { field: 'count', op: 'eq', value: 1 },
            { field: 'count', op: 'eq', value: 2 },
          ],
        },
        { field: 'isActive', op: 'eq', value: true },
      ],
    }
    expect(format(draft, schema)).toBe(
      '(count = 1 or count = 2) and isActive = true',
    )
  })
})

describe('format — incomplete dropping (Q15 v1 limitation)', () => {
  test('null field condition is dropped', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: null, op: null }],
    }
    expect(format(draft, schema)).toBe('')
  })

  test('null op condition is dropped', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: null }],
    }
    expect(format(draft, schema)).toBe('')
  })

  test('missing required value is dropped', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: undefined }],
    }
    expect(format(draft, schema)).toBe('')
  })

  test('mix: complete and incomplete coexist — incomplete dropped', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [
        { field: 'title', op: 'contains', value: 'hello' },
        { field: 'count', op: null },
      ],
    }
    expect(format(draft, schema)).toBe('title contains "hello"')
  })
})

describe('format — string escaping', () => {
  test('embedded quote', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a"b' }],
    }
    expect(format(draft, schema)).toBe('title = "a\\"b"')
  })

  test('embedded backslash', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a\\b' }],
    }
    expect(format(draft, schema)).toBe('title = "a\\\\b"')
  })

  test('embedded newline', () => {
    const draft: DraftAST = {
      combinator: 'and',
      children: [{ field: 'title', op: 'eq', value: 'a\nb' }],
    }
    expect(format(draft, schema)).toBe('title = "a\\nb"')
  })
})

describe('format ↔ parse round-trip', () => {
  // parse(format(prune(draft))) ≡ prune(draft)
  // (semantic equivalence on pruned ValidAST)
  const cases: Array<[string, DraftAST]> = [
    ['empty', { combinator: 'and', children: [] }],
    ['single string', {
      combinator: 'and',
      children: [{ field: 'title', op: 'contains', value: 'hello' }],
    }],
    ['list', {
      combinator: 'and',
      children: [{ field: 'status', op: 'in', value: ['draft', 'published'] }],
    }],
    ['range', {
      combinator: 'and',
      children: [{ field: 'count', op: 'between', value: [1, 10] }],
    }],
    ['relative', {
      combinator: 'and',
      children: [{
        field: 'publishedAt', op: 'inLast', value: { amount: 7, unit: 'day' },
      }],
    }],
    ['nested OR inside AND', {
      combinator: 'and',
      children: [
        {
          combinator: 'or',
          children: [
            { field: 'title', op: 'contains', value: 'a' },
            { field: 'title', op: 'contains', value: 'b' },
          ],
        },
        { field: 'count', op: 'gt', value: 3 },
      ],
    }],
  ]

  for (const [label, draft] of cases) {
    test(`round-trip: ${label}`, () => {
      const text = format(draft, schema)
      const reparsed = parse(text).draft
      expect(prune(reparsed, schema)).toEqual(prune(draft, schema))
    })
  }
})
