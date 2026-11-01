import { defineFilterSchema, f } from '@dql-kit/core'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  createLocalPresetStorage,
  createMemoryUrlAdapter,
  useFilter,
  usePresets,
  type Preset,
  type PresetStorage,
} from '../src/index.ts'

const schema = defineFilterSchema({
  version: 2,
  migrations: {
    1: (ast) => {
      const a = ast as { children: { field: string, value?: unknown }[] }
      for (const c of a.children) if (c.field === 'status' && c.value === 'live') c.value = 'published'
      return a
    },
  },
  fields: {
    title: f.string({ aliases: ['name'] }),
    status: f.enum(['draft', 'published'] as const),
  },
})

const memoryStore = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('usePresets', () => {
  it('saves the committed filter with the schema version and lists it', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: { combinator: 'and', children: [{ field: 'title', op: 'eq', value: 'x' }] },
    })
    const presets = usePresets({ filter, storage: createLocalPresetStorage('p', memoryStore()) })
    await flush()
    const saved = await presets.save('Mine')
    expect(saved).toMatchObject({ name: 'Mine', version: 2, ast: filter.committedValid.value })
    expect(presets.presets.value.map((p) => p.name)).toEqual(['Mine'])
  })

  it('apply migrates an old preset and reports what no longer validates', async () => {
    const store = memoryStore()
    const old: Preset = {
      id: 'old',
      name: 'Old',
      version: 1,
      ast: {
        combinator: 'and',
        children: [
          { field: 'name', op: 'eq', value: 'x' },
          { field: 'status', op: 'eq', value: 'live' },
          { field: 'gone', op: 'eq', value: 1 },
        ],
      },
    }
    store.setItem('p', JSON.stringify([old]))
    const filter = useFilter({ schema, sync: 'none' })
    const presets = usePresets({ filter, storage: createLocalPresetStorage('p', store) })
    await flush()
    expect(await presets.apply('old')).toBe(true)
    await nextTick()
    expect(filter.committedValid.value.children).toEqual([
      { field: 'title', op: 'eq', value: 'x' },
      { field: 'status', op: 'eq', value: 'published' },
    ])
    expect(filter.dropped.value).toEqual([{ path: [2], code: 'unknown_field', field: 'gone' }])
    expect(await presets.apply('nope')).toBe(false)
  })

  it('rename and remove go through storage', async () => {
    const filter = useFilter({ schema, sync: 'none' })
    const presets = usePresets({ filter, storage: createLocalPresetStorage('p', memoryStore()) })
    const a = await presets.save('A')
    await presets.rename(a.id, 'B')
    expect(presets.presets.value.map((p) => p.name)).toEqual(['B'])
    await presets.remove(a.id)
    expect(presets.presets.value).toEqual([])
  })

  it('works with async storage and surfaces errors', async () => {
    let fail = false
    const list: Preset[] = []
    const storage: PresetStorage = {
      list: async () => { if (fail) throw new Error('down'); return [...list] },
      save: async (p) => { list.push(p) },
      remove: async () => {},
      rename: async () => {},
    }
    const filter = useFilter({ schema, sync: 'none' })
    const presets = usePresets({ filter, storage })
    await presets.save('A')
    expect(presets.presets.value).toHaveLength(1)
    fail = true
    await expect(presets.refresh()).rejects.toThrow('down')
    expect((presets.error.value as Error).message).toBe('down')
    expect(presets.loading.value).toBe(false)
  })
})

describe('createLocalPresetStorage', () => {
  it('treats unreadable contents as empty and falls back to memory', async () => {
    const store = memoryStore()
    store.setItem('p', '{not json')
    expect(await createLocalPresetStorage('p', store).list()).toEqual([])
    const mem = createLocalPresetStorage('p', null)
    await mem.save({ id: '1', name: 'x', version: 0, ast: {} })
    expect((await mem.list()).map((p) => p.id)).toEqual(['1'])
  })
})

describe('useFilter URL envelope', () => {
  it('a versioned schema writes { v, a } and reads old bare links through migrations', async () => {
    const adapter = createMemoryUrlAdapter(JSON.stringify({ c: 'and', n: [{ f: 'name', o: 'eq', v: 'x' }] }))
    const filter = useFilter({ schema, sync: adapter })
    expect(filter.committedValid.value.children).toEqual([{ field: 'title', op: 'eq', value: 'x' }])
    filter.applyAst({ combinator: 'and', children: [{ field: 'status', op: 'eq', value: 'draft' }] })
    await nextTick()
    expect(JSON.parse(adapter.read())).toEqual({ v: 2, a: { c: 'and', n: [{ f: 'status', o: 'eq', v: 'draft' }] } })
  })
})
