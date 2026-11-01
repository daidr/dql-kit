import { restoreAst, schemaVersion, type ValidAST } from '@dql-kit/core'
import { ref, toRaw, type Ref } from 'vue'
import type { UseFilterReturn } from './types.ts'

type Awaitable<T> = T | Promise<T>

/** A saved filter. `ast` is long-key JSON as of schema `version`. */
export type Preset = {
  id: string
  name: string
  /** Schema version the AST was saved with (0 = unversioned). */
  version: number
  ast: unknown
}

/**
 * Where presets live. Methods may be sync or async, so the same
 * interface covers `localStorage` and a backend API.
 */
export type PresetStorage = {
  list: () => Awaitable<Preset[]>
  save: (preset: Preset) => Awaitable<void>
  remove: (id: string) => Awaitable<void>
  rename: (id: string, name: string) => Awaitable<void>
}

export type UsePresetsOptions = {
  filter: UseFilterReturn
  storage: PresetStorage
}

export type UsePresetsReturn = {
  presets: Ref<Preset[]>
  /** True while a storage call is in flight. */
  loading: Ref<boolean>
  /** The last storage error, cleared by the next successful call. */
  error: Ref<unknown>
  /** Re-read the list from storage. */
  refresh: () => Promise<void>
  /** Save the committed filter under `name`; resolves to the new preset. */
  save: (name: string) => Promise<Preset>
  /**
   * Apply a preset: run the schema's migrations from the preset's
   * version, keep what still validates (`applyAst`), and report the
   * rest through `filter.dropped`. Resolves to `false` for an unknown id.
   */
  apply: (id: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
}

const newId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Saved filter presets on top of a `useFilter` instance. Storage is the
 * app's choice (`createLocalPresetStorage` for the browser, or an
 * object that calls your API); this composable only moves ASTs in and
 * out and runs them through the schema's migrations on the way back.
 * Loads the list once on creation.
 */
export const usePresets = (opts: UsePresetsOptions): UsePresetsReturn => {
  const { filter, storage } = opts
  const presets = ref<Preset[]>([])
  const loading = ref(false)
  const error = ref<unknown>(null)

  const run = async <T>(fn: () => Awaitable<T>): Promise<T> => {
    loading.value = true
    try {
      const out = await fn()
      error.value = null
      return out
    } catch (e) {
      error.value = e
      throw e
    } finally {
      loading.value = false
    }
  }

  const refresh = async () => {
    presets.value = await run(() => storage.list())
  }

  const save = async (name: string): Promise<Preset> => {
    const schema = filter.schema.value
    const preset: Preset = {
      id: newId(),
      name,
      version: schema ? schemaVersion(schema) : 0,
      ast: structuredClone(toRaw(filter.committedValid.value)),
    }
    await run(() => storage.save(preset))
    await refresh()
    return preset
  }

  const apply = async (id: string): Promise<boolean> => {
    const preset = presets.value.find((p) => p.id === id)
    const schema = filter.schema.value
    if (!preset || !schema) return false
    const { ast, dropped } = restoreAst(toRaw(preset.ast), schema, {
      fromVersion: typeof preset.version === 'number' ? preset.version : 0,
    })
    filter.applyAst(ast as ValidAST)
    filter.dropped.value = dropped
    return true
  }

  const remove = async (id: string) => {
    await run(() => storage.remove(id))
    await refresh()
  }

  const rename = async (id: string, name: string) => {
    await run(() => storage.rename(id, name))
    await refresh()
  }

  // Initial load; a failure lands in `error`.
  refresh().catch(() => {})

  return { presets, loading, error, refresh, save, apply, remove, rename }
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

const browserStorage = (): KeyValueStore | null => {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage
    return s ?? null
  } catch {
    return null
  }
}

/**
 * `PresetStorage` backed by `localStorage` (or any `getItem` / `setItem`
 * store) under one key. Falls back to memory when no store is available
 * (SSR, privacy modes), and treats unreadable contents as empty.
 */
export const createLocalPresetStorage = (
  key: string,
  store: KeyValueStore | null = browserStorage(),
): PresetStorage => {
  let memory: Preset[] = []
  const read = (): Preset[] => {
    if (!store) return memory
    try {
      const parsed: unknown = JSON.parse(store.getItem(key) ?? '[]')
      return Array.isArray(parsed)
        ? parsed.filter((p): p is Preset =>
            p != null && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string')
        : []
    } catch {
      return []
    }
  }
  const write = (list: Preset[]) => {
    memory = list
    store?.setItem(key, JSON.stringify(list))
  }
  return {
    list: () => read(),
    save: (preset) => write([...read().filter((p) => p.id !== preset.id), preset]),
    remove: (id) => write(read().filter((p) => p.id !== id)),
    rename: (id, name) => write(read().map((p) => (p.id === id ? { ...p, name } : p))),
  }
}
