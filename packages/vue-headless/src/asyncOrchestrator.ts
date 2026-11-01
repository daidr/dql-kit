import type { IdFetcher, Item, SearchPage } from '@dql-kit/core'
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
  /** More results are available through `loadMore` (paged fetchers). */
  hasMore: boolean
}

type Awaitable<T> = T | Promise<T>
type SearchFn<ID = string | number> = (q: string, signal: AbortSignal) => Awaitable<Item<ID>[]>
type SearchPageOf = SearchPage<string | number>
type PageFn = (q: string, cursor: unknown, signal: AbortSignal) => Awaitable<SearchPageOf>
/** A one-shot search function, or a fetcher with `search` / `searchPage`. */
export type SearchSource = SearchFn | Pick<IdFetcher, 'search' | 'searchPage'>

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

// Normalise every search source to a page fetcher. `key` is the user's
// own function, so sync detection survives across calls.
const toPageSource = (src: SearchSource): { key: object, fetch: PageFn } => {
  if (typeof src === 'function') {
    return { key: src, fetch: (q, _c, signal) => wrapItems(src(q, signal)) }
  }
  if (src.searchPage) return { key: src.searchPage, fetch: src.searchPage as PageFn }
  const search = src.search as SearchFn
  return { key: search, fetch: (q, _c, signal) => wrapItems(search(q, signal)) }
}

const wrapItems = (r: Awaitable<Item<string | number>[]>): Awaitable<SearchPageOf> =>
  r instanceof Promise ? r.then((items) => ({ items })) : { items: r }
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
    fetcher: SearchSource,
    debounceMs: number,
    onPatch: (patch: Partial<SearchSlotState>) => void,
  ) => void
  // Fetch the next page of the current search and append it (paged
  // fetchers only; a no-op when there is no next page or one is loading).
  loadMore: () => void
  // Put already-known labels into the cache (e.g. items a bulk paste
  // looked up), without fetching.
  seedLabels: (fieldKey: string, items: Item<string | number>[]) => void
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
  // Abort the current search and drop its late results, so the next
  // `setQuery` starts from a cleared slot.
  resetSearch: () => void
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
  const fetcherIsSync = new WeakMap<object, boolean>()

  const cancelSearch = () => {
    if (searchAbort) searchAbort.abort()
    searchAbort = null
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  // State of the current paged search, for `loadMore`.
  let paging: {
    epoch: number
    query: string
    fetch: PageFn
    cursor: unknown
    results: Item<string | number>[]
    onPatch: (patch: Partial<SearchSlotState>) => void
  } | null = null
  let loadingMore = false

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
    paging = null
    loadingMore = false

    searchEpoch++
    const myEpoch = searchEpoch
    const source = toPageSource(fetcher)

    if (fieldKey !== lastFieldKey) {
      lastFieldKey = fieldKey
      onPatch({ fieldKey, query, error: null, loading: false, results: [], hasMore: false })
    } else {
      onPatch({ fieldKey, query, error: null })
    }

    const ac = new AbortController()
    searchAbort = ac

    const landed = (page: SearchPageOf) => {
      paging = page.nextCursor === undefined
        ? null
        : { epoch: myEpoch, query, fetch: source.fetch, cursor: page.nextCursor, results: page.items, onPatch }
      onPatch({ loading: false, results: page.items, error: null, hasMore: paging !== null })
    }

    const run = () => {
      let result: Awaitable<SearchPageOf>
      try {
        result = source.fetch(query, undefined, ac.signal)
      } catch (err) {
        if (myEpoch === searchEpoch) {
          onPatch({ loading: false, error: toError(err) })
        }
        return
      }
      if (result instanceof Promise) {
        fetcherIsSync.set(source.key, false)
        onPatch({ loading: true })
        result
          .then((page) => {
            if (myEpoch !== searchEpoch) return
            landed(page)
          })
          .catch((err: unknown) => {
            if (myEpoch !== searchEpoch) return
            if (ac.signal.aborted) return
            onPatch({ loading: false, error: toError(err) })
          })
      } else {
        // Sync fast path: write through immediately, no loading flicker.
        fetcherIsSync.set(source.key, true)
        landed(result)
      }
    }

    // Unknown fetchers run immediately: that call tells us whether they
    // are sync. Only known-async fetchers are debounced.
    if (debounceMs > 0 && fetcherIsSync.get(source.key) === false) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (myEpoch === searchEpoch) run()
      }, debounceMs)
    } else {
      run()
    }
  }

  const loadMore: AsyncOrchestrator['loadMore'] = () => {
    const p = paging
    if (!p || loadingMore || p.epoch !== searchEpoch) return
    loadingMore = true
    const ac = new AbortController()
    searchAbort = ac
    const done = (page: SearchPageOf) => {
      loadingMore = false
      if (p.epoch !== searchEpoch || paging !== p) return
      const seen = new Set(p.results.map((i) => i.id))
      p.results = [...p.results, ...page.items.filter((i) => !seen.has(i.id))]
      if (page.nextCursor === undefined) paging = null
      else p.cursor = page.nextCursor
      p.onPatch({ loading: false, results: p.results, error: null, hasMore: paging !== null })
    }
    const fail = (err: unknown) => {
      loadingMore = false
      if (p.epoch !== searchEpoch || ac.signal.aborted) return
      // Keep the pages already shown; the next loadMore retries.
      p.onPatch({ loading: false, error: toError(err) })
    }
    let result: Awaitable<SearchPageOf>
    try {
      result = p.fetch(p.query, p.cursor, ac.signal)
    } catch (err) {
      fail(err)
      return
    }
    if (result instanceof Promise) {
      p.onPatch({ loading: true })
      result.then(done, fail)
    } else {
      done(result)
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

  const seedLabels: AsyncOrchestrator['seedLabels'] = (fieldKey, items) => {
    let bucket = cache.get(fieldKey)
    if (!bucket) {
      bucket = new Map()
      cache.set(fieldKey, bucket)
    }
    for (const item of items) {
      bucket.set(item.id, { status: 'resolved', label: item.label, meta: item.meta })
      retryAt.get(fieldKey)?.delete(item.id)
    }
    bumpCache()
  }

  const resetSearch: AsyncOrchestrator['resetSearch'] = () => {
    cancelSearch()
    paging = null
    loadingMore = false
    searchEpoch++
    lastFieldKey = null
  }

  const dispose: AsyncOrchestrator['dispose'] = () => {
    cancelSearch()
    paging = null
    loadingMore = false
    searchEpoch++
    lastFieldKey = null
    abortResolves()
    cache.clear()
    retryAt.clear()
    bumpCache()
  }

  return { setQuery, loadMore, resolveBatch, seedLabels, labelOf, invalidateLabels, resetSearch, dispose, _peek }
}
