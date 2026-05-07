import type { UrlAdapter } from '@dql-kit/vue-headless'
import { watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'

const queryToString = (
  raw: string | (string | null)[] | null | undefined,
): string => (typeof raw === 'string' ? raw : '')

/**
 * vue-router adapter for `useFilter({ sync: vueRouterUrlAdapter(...) })`.
 *
 * Must be called from a component setup() (or any context where
 * `useRoute()` / `useRouter()` work) so the route ref is reactive.
 * Uses `router.replace` so filter edits don't pile up in the
 * history stack.
 *
 * Per-filter `queryKey` → URL `?<queryKey>=...`. Two filters on one
 * page should pass distinct keys.
 */
export const vueRouterUrlAdapter = (
  options: { queryKey?: string } = {},
): UrlAdapter => {
  const queryKey = options.queryKey ?? 'filter'
  const router = useRouter()
  const route = useRoute()
  if (!router || !route) {
    throw new Error(
      `[@dql-kit/vue-router-sync] vueRouterUrlAdapter requires a vue-router context. `
        + `Install vue-router and provide it via app.use(router) before the component mounts.`,
    )
  }

  return {
    read: () => queryToString(route.query[queryKey]),
    write: (encoded) => {
      const cur = queryToString(route.query[queryKey])
      if (cur === encoded) return
      const nextQuery: LocationQueryRaw = { ...route.query }
      if (encoded.length === 0) {
        delete nextQuery[queryKey]
      } else {
        nextQuery[queryKey] = encoded
      }
      void router.replace({ query: nextQuery })
    },
    watch: (cb) => {
      const stop = watch(
        () => queryToString(route.query[queryKey]),
        (raw) => cb(raw),
      )
      return stop
    },
  }
}
