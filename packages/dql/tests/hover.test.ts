import { describe, expect, test } from 'bun:test'
import { defineFilterSchema, f, type Item } from '@dql-kit/core'
import { provideHover } from '../src/lsp/hover.ts'
import type { FetcherMap } from '../src/types.ts'

const search = async (): Promise<Item<number>[]> => []
const resolve = async (
  ids: ReadonlyArray<number>,
): Promise<Item<number>[]> => {
  const map: Record<number, string> = { 1: 'Alice', 2: 'Bob' }
  return ids.map((id) => ({ id, label: map[id] ?? '' }))
}

const schema = defineFilterSchema({
  fields: {
    title:    f.string({ label: 'Article title' }),
    rating:   f.number({ label: 'Score' }),
    authorId: f.id<number>({ label: 'Author' }),
  },
})

const fetchers: FetcherMap = {
  authorId: { search: search as never, resolve: resolve as never },
}

describe('hover — field token', () => {
  test('shows field label and type', async () => {
    const text = 'title contains "hi"'
    const offset = 2 // inside "title"
    const h = await provideHover(text, offset, schema)
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('Article title')
    expect(h!.contents).toContain('string')
  })

  test('returns null on unknown field', async () => {
    const text = 'bogus contains "hi"'
    const h = await provideHover(text, 2, schema)
    expect(h).toBeNull()
  })
})

describe('hover — op token', () => {
  test('shows op name and value shape', async () => {
    const text = 'title contains "hi"'
    const offset = 8 // inside "contains"
    const h = await provideHover(text, offset, schema)
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('contains')
    expect(h!.contents).toContain('single')
  })

  test('symbolic op `=` resolves to eq', async () => {
    const text = 'rating = 5'
    const offset = 7 // on `=`
    const h = await provideHover(text, offset, schema)
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('eq')
  })
})

describe('hover — id value token', () => {
  test('resolves label for hovered id', async () => {
    const text = 'authorId = 1'
    const offset = 11 // inside "1"
    const h = await provideHover(text, offset, schema, { fetchers })
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('Alice')
  })

  test('list-of-ids resolves the specific hovered id', async () => {
    const text = 'authorId in [1, 2]'
    const offsetForBob = text.indexOf('2', 14)
    const h = await provideHover(text, offsetForBob, schema, { fetchers })
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('Bob')
  })

  test('falls back gracefully when resolve returns nothing', async () => {
    const text = 'authorId = 999'
    const offset = 12
    const h = await provideHover(text, offset, schema, { fetchers })
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('999')
  })

  test('without fetcher map, shows raw id (not silently null)', async () => {
    const text = 'authorId = 1'
    const offset = 11
    const h = await provideHover(text, offset, schema)
    expect(h).not.toBeNull()
    expect(h!.contents).toContain('1')
  })
})

describe('hover — non-hover positions', () => {
  test('whitespace returns null', async () => {
    const h = await provideHover('title contains "hi"', 5, schema) // space
    expect(h).toBeNull()
  })

  test('empty document returns null', async () => {
    const h = await provideHover('', 0, schema)
    expect(h).toBeNull()
  })
})
