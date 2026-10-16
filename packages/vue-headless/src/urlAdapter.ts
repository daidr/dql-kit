/**
 * Pluggable URL synchroniser. `useFilter` knows nothing about which
 * router (vue-router, Nuxt, hand-rolled history-API code) is in use —
 * it only talks to a `UrlAdapter`.
 *
 * Implementations:
 *
 *   - **`@dql-kit/vue-headless/vue-router`** — the canonical adapter for
 *     apps using vue-router; pass it the filter's `queryKey`.
 *   - **Hand-rolled** — anything matching this contract works. See
 *     `createMemoryUrlAdapter` for the simplest possible reference
 *     implementation.
 *
 * Lifecycle:
 *
 *   - `read()` is called on hook setup to seed the initial AST.
 *   - `write(encoded)` is called whenever the committed AST changes
 *     (every keystroke in `'auto'` mode, only on `commit()` in
 *     `'manual'` mode). Implementations should debounce / coalesce
 *     redundant writes themselves if needed; useFilter already
 *     suppresses duplicate `read() === encoded` writes.
 *   - `watch(cb)` registers a listener for *external* URL changes
 *     (back/forward, pasted link, sibling navigation). The callback
 *     receives the raw value string. Returns a teardown function;
 *     useFilter calls it on unmount via effectScope.
 *
 * Values are `toUrl` output: plain (not percent-encoded) JSON. The
 * adapter owns URL encoding — `read` returns the decoded query value
 * and `write` hands the plain string to whatever builds the URL, so it
 * is encoded exactly once.
 */
export interface UrlAdapter {
  read: () => string
  write: (encoded: string) => void
  watch: (cb: (encoded: string) => void) => () => void
}

/**
 * No-dependency in-memory adapter. Useful for tests, Storybook, and
 * environments without a router. The "URL" is a single string held in
 * a closure; `watch` notifies subscribers on `write`.
 */
export const createMemoryUrlAdapter = (initial = ''): UrlAdapter => {
  let value = initial
  const subs = new Set<(encoded: string) => void>()
  return {
    read: () => value,
    write: (encoded) => {
      if (encoded === value) return
      value = encoded
      for (const cb of subs) cb(encoded)
    },
    watch: (cb) => {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
  }
}
