import { describe, expect, test } from 'bun:test'
import { defineFilterSchema, f, type Item } from '@dql-kit/core'
import { provideCompletions } from '../src/lsp/completions.ts'
import type { FetcherMap } from '../src/types.ts'

const search = async (q: string): Promise<Item<number>[]> => {
  const all: Item<number>[] = [
    { id: 1, label: 'Alice' },
    { id: 2, label: 'Bob' },
    { id: 3, label: 'Carol' },
  ]
  return all.filter((i) => i.label.toLowerCase().startsWith(q.toLowerCase()))
}

const resolve = async (ids: ReadonlyArray<number>): Promise<Item<number>[]> => {
  const map: Record<number, string> = { 1: 'Alice', 2: 'Bob', 3: 'Carol' }
  return ids.map((id) => ({ id, label: map[id] ?? '' }))
}

const schema = defineFilterSchema({
  fields: {
    title:       f.string({ label: 'Title' }),
    rating:      f.number(),
    count:       f.number(),
    status:      f.enum(['draft', 'published', 'archived'] as const, {
      label: 'Status',
      valueLabels: { draft: '草稿', published: '已发布' },
    }),
    isActive:    f.boolean(),
    publishedAt: f.datetime(),
    publishedOn: f.date(),
    authorId:    f.id<number>(),
    name:        f.string(),
  },
})

const fetchers: FetcherMap = {
  authorId: { search: search as never, resolve: resolve as never },
}

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label)

describe('completions — field slot', () => {
  test('empty document → all fields', async () => {
    const c = await provideCompletions('', 0, schema)
    expect(c.length).toBe(Object.keys(schema.fields).length)
    expect(c[0]!.kind).toBe('field')
    expect(c[0]!.insertText.endsWith(' ')).toBe(true) // trailing space (Q11)
  })

  test('after `and ` → field slot', async () => {
    const text = 'title contains "x" and '
    const c = await provideCompletions(text, text.length, schema)
    expect(c.every((i) => i.kind === 'field')).toBe(true)
  })

  test('partial field name filters', async () => {
    const c = await provideCompletions('rat', 3, schema)
    expect(labels(c)).toEqual(['rating'])
  })

  test('schema declaration order is preserved', async () => {
    const c = await provideCompletions('', 0, schema)
    const expected = Object.keys(schema.fields)
    expect(labels(c)).toEqual(expected)
  })
})

describe('completions — op slot', () => {
  test('after `title ` → string ops', async () => {
    const text = 'title '
    const c = await provideCompletions(text, text.length, schema)
    expect(c.every((i) => i.kind === 'op')).toBe(true)
    // string ops include eq, contains, startsWith, ...
    expect(labels(c)).toContain('contains')
    expect(labels(c)).toContain('eq')
  })

  test('after `rating ` → number ops include between', async () => {
    const text = 'rating '
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toContain('between')
    expect(labels(c)).toContain('gte')
  })

  test('op snippet for `between` includes range placeholder', async () => {
    const text = 'rating '
    const c = await provideCompletions(text, text.length, schema)
    const between = c.find((i) => i.label === 'between')!
    expect(between.insertText).toContain('..')
  })

  test('op snippet for `in` includes [] placeholder', async () => {
    const text = 'status '
    const c = await provideCompletions(text, text.length, schema)
    const inOp = c.find((i) => i.label === 'in')!
    expect(inOp.insertText).toContain('[')
  })

  test('op snippet for none-shape op (isEmpty) has no placeholder', async () => {
    const text = 'name '
    const c = await provideCompletions(text, text.length, schema)
    const isEmpty = c.find((i) => i.label === 'isEmpty')
    expect(isEmpty).toBeDefined()
    expect(isEmpty!.insertText).toBe('isEmpty')
  })
})

describe('completions — value slot', () => {
  test('boolean field offers true / false', async () => {
    const text = 'isActive = '
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toEqual(['true', 'false'])
  })

  test('enum field offers enum values with label detail', async () => {
    const text = 'status = '
    const c = await provideCompletions(text, text.length, schema)
    expect(c.length).toBe(3)
    expect(c[0]!.label).toBe('"draft"')
    expect(c[0]!.detail).toBe('草稿')
  })

  test('date field offers ISO snippet', async () => {
    const text = 'publishedOn = '
    const c = await provideCompletions(text, text.length, schema)
    expect(c[0]!.label).toContain('YYYY-MM-DD')
    expect(c[0]!.kind).toBe('snippet')
  })

  test('id field calls fetcher.search() asynchronously', async () => {
    const text = 'authorId = '
    const c = await provideCompletions(text, text.length, schema, { fetchers })
    // search('') returns all 3
    expect(c).toHaveLength(3)
    // Human-readable label is the primary `label` (visible on every row);
    // id literal lands in `detail` and `filterText` so the popup is
    // legible without hovering each item.
    expect(c[0]!.label).toBe('Alice')
    expect(c[0]!.detail).toBe('1')
    expect(c[0]!.filterText).toBe('Alice 1')
    expect(c[0]!.insertText).toBe('1')
  })

  test('id field search filters by partial inside string', async () => {
    const text = 'authorId = "B'
    const c = await provideCompletions(text, text.length, schema, { fetchers })
    // search('B') returns Bob only
    expect(c).toHaveLength(1)
    expect(c[0]!.label).toBe('Bob')
    expect(c[0]!.detail).toBe('2')
  })

  test('id field returns empty when no fetcher registered', async () => {
    const text = 'authorId = '
    const c = await provideCompletions(text, text.length, schema)
    expect(c).toEqual([])
  })
})

describe('completions — list_element slot', () => {
  test('after `[` in enum field offers values', async () => {
    const text = 'status in ['
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toEqual(['"draft"', '"published"', '"archived"'])
  })

  test('after `, ` inside [] still in list_element', async () => {
    const text = 'status in ["draft", '
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toEqual(['"draft"', '"published"', '"archived"'])
  })
})

describe('completions — continuation slot', () => {
  test('after complete condition → and / or', async () => {
    const text = 'title contains "x" '
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toEqual(['and', 'or'])
  })

  test('after closing ] → continuation', async () => {
    const text = 'status in ["draft"] '
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toEqual(['and', 'or'])
  })
})

describe('completions — unit slot', () => {
  test('after `inLast 7 ` → units', async () => {
    const text = 'publishedAt inLast 7 '
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toContain('day')
    expect(labels(c)).toContain('days')
    expect(labels(c)).toContain('week')
  })

  test('partial unit filters', async () => {
    const text = 'publishedAt inLast 7 d'
    const c = await provideCompletions(text, text.length, schema)
    expect(labels(c)).toContain('day')
    expect(labels(c)).toContain('days')
    expect(labels(c)).not.toContain('week')
  })
})

describe('completions — sort order', () => {
  test('sortText is zero-padded indexes', async () => {
    const c = await provideCompletions('', 0, schema)
    for (let i = 0; i < c.length; i++) {
      expect(c[i]!.sortText).toBe(String(i).padStart(4, '0'))
    }
  })
})
