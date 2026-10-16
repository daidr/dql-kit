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
  // Drive the single search slot. Cancels any prior in-flight fetcher
  // (AbortController) — for any field, since there is only one slot — and
  // bumps an epoch so a stale late arrival cannot overwrite a newer call's
  // results. Switching to a different field clears the previous field's
  // results right away.
  //
  // Debounce applies to async fetchers only. Whether a fetcher is sync is
  // learnt from its first call (which runs immediately); from then on a
  // sync fetcher writes through on every keystroke with no delay and no
  // loading flicker, an async one is debounced by `debounceMs`.
  setQuery: (
    fieldKey: string,
    query: string,
    fetcher: SearchFn,
    debounceMs: number,
    onPatch: (patch: Partial<SearchSlotState>) => void,
  ) => void
  // Batch-resolve labels for a list of ids on a given field. Cache is hit
  // exact: only ids missing from the cache are sent to the fetcher. Ids
  // whose last resolve failed (fetcher threw / rejected) become eligible
  // again after `resolveRetryMs`; ids the fetcher answered without
  // (genuinely unknown) stay cached as errors.
  resolveBatch: (fieldKey: string, ids: (string | number)[], fetcher: ResolveFn) => void
  // Reactive read of the resolve cache. Reads `epoch.value` so Vue tracks
  // the dependency; the cache itself is a plain Map for fast O(1) lookup.
  labelOf: (fieldKey: string, id: string | number) => LabelStatus
  // Drop cached labels (one field or all) and abort their in-flight resolves.
  invalidateLabels: (fieldKey?: string) => void
  // Abort all in-flight searches and resolves, clear all timers and
  // caches. Called by useFilter on scope dispose so unmounting a host
  // component doesn't leak fetchers or memory.
  dispose: () => void
  // Test-only: synchronous read of the current cache contents.
  _peek: (fieldKey: string, id: string | number) => LabelStatus
}

export type AsyncOrchestratorOptions = {
  /**
   * How long a failed resolve (fetcher threw or rejected) stays cached
   * before the id may be fetched again. Default 5000ms.
   */
  resolveRetryMs?: number
  /** Clock override for tests. */
  now?: () => number
}

const DEFAULT_RESOLVE_RETRY_MS = 5000

export const createAsyncOrchestrator = (
  options: AsyncOrchestratorOptions = {},
): AsyncOrchestrator => {
  const resolveRetryMs = options.resolveRetryMs ?? DEFAULT_RESOLVE_RETRY_MS
  const now = options.now ?? (() => Date.now())

  const cache = new Map<string, Map<string | number, LabelStatus>>()
  // fieldKey → id → timestamp after which a transient failure may be
  // retried. Only ids whose fetch threw / rejected are listed here.
  const retryAt = new Map<string, Map<string | number, number>>()
  // In-flight resolves per field, so invalidate / dispose can abort them.
  const resolveControllers = new Map<string, Set<AbortController>>()
  const epoch: Ref<number> = ref(0)
  const bumpCache = () => {
    epoch.value++
  }

  // ---- search ----------------------------------------------------------

  // One slot → one controller. A late result for field A must never land
  // in the slot after the user moved on to field B.
  let searchAbort: AbortController | null = null
  let searchEpoch = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let lastFieldKey: string | null = null
  // Learnt per fetcher function: true = returns synchronously.
  const fetcherIsSync = new WeakMap<SearchFn, boolean>()

  const cancelSearch = () => {
    if (searchAbort) searchAbort.abort()
    searchAbort = null
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  const setQuery: AsyncOrchestrator['setQuery'] = (
    fieldKey,
    query,
    fetcher,
    debounceMs,
    onPatch,
  ) => {
    // Abort any in-flight fetcher. The fetcher itself is expected to
    // honour `signal.aborted`; we additionally drop late resolutions via
    // the epoch check.
    cancelSearch()

    searchEpoch++
    const myEpoch = searchEpoch

    if (fieldKey !== lastFieldKey) {
      lastFieldKey = fieldKey
      onPatch({ fieldKey, query, error: null, loading: false, results: [] })
    } else {
      onPatch({ fieldKey, query, error: null })
    }

    const ac = new AbortController()
    searchAbort = ac

    const run = () => {
      let result: ReturnType<SearchFn>
      try {
        result = fetcher(query, ac.signal)
      } catch (err) {
        if (myEpoch === searchEpoch) {
          onPatch({ loading: false, error: err instanceof Error ? err : new Error(String(err)) })
        }
        return
      }
      if (result instanceof Promise) {
        fetcherIsSync.set(fetcher, false)
        onPatch({ loading: true })
        result
          .then((items) => {
            if (myEpoch !== searchEpoch) return
            onPatch({ loading: false, results: items, error: null })
          })
          .catch((err: unknown) => {
            if (myEpoch !== searchEpoch) return
            if (ac.signal.aborted) return
            onPatch({ loading: false, error: err instanceof Error ? err : new Error(String(err)) })
          })
      } else {
        // Sync fast path: write through immediately, no loading flicker.
        fetcherIsSync.set(fetcher, true)
        onPatch({ loading: false, results: result, error: null })
      }
    }

    // Unknown fetchers run immediately: that call tells us whether they
    // are sync. Only known-async fetchers are debounced.
    if (debounceMs > 0 && fetcherIsSync.get(fetcher) === false) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (myEpoch === searchEpoch) run()
      }, debounceMs)
    } else {
      run()
    }
  }

  // ---- resolve ---------------------------------------------------------

  const resolveBatch: AsyncOrchestrator['resolveBatch'] = (fieldKey, ids, fetcher) => {
    let bucket = cache.get(fieldKey)
    if (!bucket) {
      bucket = new Map()
      cache.set(fieldKey, bucket)
    }
    let retries = retryAt.get(fieldKey)
    if (!retries) {
      retries = new Map()
      retryAt.set(fieldKey, retries)
    }
    const b = bucket
    const r = retries

    // Fetch ids that aren't cached, plus transient failures whose retry
    // window has passed. pending / resolved / not-found suppress re-fetch.
    const t = now()
    const missing = [...new Set(ids)].filter((id) => {
      if (!b.has(id)) return true
      const at = r.get(id)
      return at !== undefined && t >= at
    })
    if (missing.length === 0) return

    for (const id of missing) {
      b.set(id, { status: 'pending' })
      r.delete(id)
    }
    bumpCache()

    const ac = new AbortController()
    let controllers = resolveControllers.get(fieldKey)
    if (!controllers) {
      controllers = new Set()
      resolveControllers.set(fieldKey, controllers)
    }
    const cs = controllers
    cs.add(ac)
    const settle = () => {
      cs.delete(ac)
    }

    const handleItems = (items: Item<string | number>[]) => {
      settle()
      if (ac.signal.aborted) return
      for (const item of items) {
        b.set(item.id, { status: 'resolved', label: item.label, meta: item.meta })
      }
      // Any id we asked for but didn't get back: the fetcher answered and
      // doesn't know it, so surface as a (cached) error and let the UI
      // fall back to '#<id>' (Q13: partial resolve failure).
      for (const id of missing) {
        const cur = b.get(id)
        if (cur && cur.status === 'pending') {
          b.set(id, { status: 'error', id })
        }
      }
      bumpCache()
    }

    const handleFailure = () => {
      settle()
      if (ac.signal.aborted) return
      // Transient: network / server error. Cache the error so the UI shows
      // the fallback, but allow a retry once the window passes.
      const retryTime = now() + resolveRetryMs
      for (const id of missing) {
        b.set(id, { status: 'error', id })
        r.set(id, retryTime)
      }
      bumpCache()
    }

    let result: ReturnType<ResolveFn>
    try {
      result = fetcher(missing as never, ac.signal)
    } catch {
      handleFailure()
      return
    }
    if (result instanceof Promise) {
      result.then((items) => handleItems(items as Item<string | number>[]), handleFailure)
    } else {
      handleItems(result as Item<string | number>[])
    }
  }

  const abortResolves = (fieldKey?: string) => {
    const keys = fieldKey === undefined ? [...resolveControllers.keys()] : [fieldKey]
    for (const k of keys) {
      const cs = resolveControllers.get(k)
      if (!cs) continue
      for (const ac of cs) ac.abort()
      resolveControllers.delete(k)
    }
  }

  const labelOf: AsyncOrchestrator['labelOf'] = (fieldKey, id) => {
    // Touch the reactive epoch so any computed/template that calls labelOf
    // re-evaluates when the cache mutates.
    void epoch.value
    return cache.get(fieldKey)?.get(id) ?? { status: 'pending' }
  }

  const invalidateLabels: AsyncOrchestrator['invalidateLabels'] = (fieldKey) => {
    abortResolves(fieldKey)
    if (fieldKey === undefined) {
      cache.clear()
      retryAt.clear()
    } else {
      cache.delete(fieldKey)
      retryAt.delete(fieldKey)
    }
    bumpCache()
  }

  const _peek: AsyncOrchestrator['_peek'] = (fieldKey, id) =>
    cache.get(fieldKey)?.get(id) ?? { status: 'pending' }

  const dispose: AsyncOrchestrator['dispose'] = () => {
    cancelSearch()
    searchEpoch++
    lastFieldKey = null
    abortResolves()
    cache.clear()
    retryAt.clear()
    bumpCache()
  }

  return { setQuery, resolveBatch, labelOf, invalidateLabels, dispose, _peek }
}
