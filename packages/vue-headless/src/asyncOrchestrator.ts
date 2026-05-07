import type { Item } from '@dql-kit/core'
import { ref, type Ref } from 'vue'
import type { LabelStatus } from './types.ts'

// Public state visible on `useFilter.search`. Carries the currently-edited
// fieldKey + query plus loading / error / results. The `setQuery` member is a
// stable closure attached to the slot so callers can write
// `filter.search.value.setQuery(...)` from JS or `filter.search.setQuery(...)`
// from a template (Vue auto-unwraps the ref).
export type SearchSlotState<ID = string | number> = {
  fieldKey: string | null
  query: string
  loading: boolean
  error: Error | null
  results: Item<ID>[]
}

type Awaitable<T> = T | Promise<T>
type SearchFn<ID = string | number> = (q: string, signal: AbortSignal) => Awaitable<Item<ID>[]>
type ResolveFn<ID = string | number> = (ids: ID[], signal: AbortSignal) => Awaitable<Item<ID>[]>

export type AsyncOrchestrator = {
  // Drive the single search slot. Cancels any prior in-flight fetcher for
  // the same fieldKey (AbortController) and bumps an epoch so a stale late
  // arrival cannot overwrite a newer call's results.
  setQuery: (
    fieldKey: string,
    query: string,
    fetcher: SearchFn,
    debounceMs: number,
    onPatch: (patch: Partial<SearchSlotState>) => void,
  ) => void
  // Batch-resolve labels for a list of ids on a given field. Cache is hit
  // exact: only ids missing from the cache are sent to the fetcher.
  resolveBatch: (fieldKey: string, ids: (string | number)[], fetcher: ResolveFn) => void
  // Reactive read of the resolve cache. Reads `epoch.value` so Vue tracks
  // the dependency; the cache itself is a plain Map for fast O(1) lookup.
  labelOf: (fieldKey: string, id: string | number) => LabelStatus
  invalidateLabels: (fieldKey?: string) => void
  // Abort all in-flight searches, clear all timers and caches. Called
  // by useFilter on scope dispose so unmounting a host component
  // doesn't leak fetchers or memory.
  dispose: () => void
  // Test-only: synchronous read of the current cache contents.
  _peek: (fieldKey: string, id: string | number) => LabelStatus
}

type SearchController = {
  abort: AbortController | null
  epoch: number
  debounceTimer: ReturnType<typeof setTimeout> | null
}

export const createAsyncOrchestrator = (): AsyncOrchestrator => {
  const cache = new Map<string, Map<string | number, LabelStatus>>()
  const epoch: Ref<number> = ref(0)
  const bumpCache = () => {
    epoch.value++
  }

  const searchControllers = new Map<string, SearchController>()
  const getSearchController = (fieldKey: string): SearchController => {
    let c = searchControllers.get(fieldKey)
    if (!c) {
      c = { abort: null, epoch: 0, debounceTimer: null }
      searchControllers.set(fieldKey, c)
    }
    return c
  }

  const setQuery: AsyncOrchestrator['setQuery'] = (
    fieldKey,
    query,
    fetcher,
    debounceMs,
    onPatch,
  ) => {
    const c = getSearchController(fieldKey)

    // Abort any in-flight fetcher for this field. The fetcher itself is
    // expected to honour `signal.aborted`; we additionally drop late
    // resolutions via the epoch check.
    if (c.abort) c.abort.abort()
    if (c.debounceTimer !== null) {
      clearTimeout(c.debounceTimer)
      c.debounceTimer = null
    }

    c.epoch++
    const myEpoch = c.epoch

    onPatch({ fieldKey, query, error: null })

    const ac = new AbortController()
    c.abort = ac

    const run = () => {
      onPatch({ loading: true })
      let result: ReturnType<SearchFn>
      try {
        result = fetcher(query, ac.signal)
      } catch (err) {
        if (myEpoch === c.epoch) {
          onPatch({ loading: false, error: err as Error })
        }
        return
      }
      if (result instanceof Promise) {
        result
          .then((items) => {
            if (myEpoch !== c.epoch) return
            onPatch({ loading: false, results: items, error: null })
          })
          .catch((err: unknown) => {
            if (myEpoch !== c.epoch) return
            if (ac.signal.aborted) return
            onPatch({ loading: false, error: err instanceof Error ? err : new Error(String(err)) })
          })
      } else {
        // Sync fast path: write through immediately, no debounce delay,
        // no loading flicker.
        if (myEpoch === c.epoch) {
          onPatch({ loading: false, results: result, error: null })
        }
      }
    }

    if (debounceMs > 0 && fetcher.length >= 0) {
      // The debounce is purely temporal; sync fast path is detected after
      // calling the fetcher (which we can't avoid for sync detection unless
      // we introduce a separate flag — keeping behaviour uniform here).
      c.debounceTimer = setTimeout(() => {
        c.debounceTimer = null
        if (myEpoch === c.epoch) run()
      }, debounceMs)
    } else {
      run()
    }
  }

  const resolveBatch: AsyncOrchestrator['resolveBatch'] = (fieldKey, ids, fetcher) => {
    let bucket = cache.get(fieldKey)
    if (!bucket) {
      bucket = new Map()
      cache.set(fieldKey, bucket)
    }

    // Only fetch ids that aren't already in the cache (any status counts
    // as cached — pending/resolved/error all suppress re-fetch within the
    // instance lifetime, per DESIGN.md Q13).
    const missing = ids.filter((id) => !bucket!.has(id))
    if (missing.length === 0) return

    for (const id of missing) {
      bucket.set(id, { status: 'pending' })
    }
    bumpCache()

    const ac = new AbortController()

    const handleItems = (items: Item<string | number>[]) => {
      for (const item of items) {
        bucket!.set(item.id, { status: 'resolved', label: item.label, meta: item.meta })
      }
      // Any id we asked for but didn't get back: surface as error so the
      // UI can fall back to '#<id>' (Q13: partial resolve failure).
      for (const id of missing) {
        const cur = bucket!.get(id)
        if (cur && cur.status === 'pending') {
          bucket!.set(id, { status: 'error', id })
        }
      }
      bumpCache()
    }

    let result: ReturnType<ResolveFn>
    try {
      result = fetcher(missing as never, ac.signal)
    } catch {
      for (const id of missing) {
        bucket.set(id, { status: 'error', id })
      }
      bumpCache()
      return
    }
    if (result instanceof Promise) {
      result.then((items) => handleItems(items as Item<string | number>[])).catch(() => {
        for (const id of missing) {
          bucket!.set(id, { status: 'error', id })
        }
        bumpCache()
      })
    } else {
      handleItems(result as Item<string | number>[])
    }
  }

  const labelOf: AsyncOrchestrator['labelOf'] = (fieldKey, id) => {
    // Touch the reactive epoch so any computed/template that calls labelOf
    // re-evaluates when the cache mutates.
    void epoch.value
    return cache.get(fieldKey)?.get(id) ?? { status: 'pending' }
  }

  const invalidateLabels: AsyncOrchestrator['invalidateLabels'] = (fieldKey) => {
    if (fieldKey === undefined) {
      cache.clear()
    } else {
      cache.delete(fieldKey)
    }
    bumpCache()
  }

  const _peek: AsyncOrchestrator['_peek'] = (fieldKey, id) =>
    cache.get(fieldKey)?.get(id) ?? { status: 'pending' }

  const dispose: AsyncOrchestrator['dispose'] = () => {
    for (const c of searchControllers.values()) {
      if (c.abort) c.abort.abort()
      if (c.debounceTimer !== null) clearTimeout(c.debounceTimer)
    }
    searchControllers.clear()
    cache.clear()
    bumpCache()
  }

  return { setQuery, resolveBatch, labelOf, invalidateLabels, dispose, _peek }
}
