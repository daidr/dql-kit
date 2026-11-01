import type { RelativeUnit } from '@dql-kit/core'
import {
  dqlKitInjectionKey,
  type DqlKitState,
  type PeriodLabels,
  type RelativeUnitLabels,
} from '@dql-kit/vue-headless'
import { getCurrentInstance, inject } from 'vue'

export type { PeriodLabels, RelativeUnitLabels }

/**
 * Resolve the active dql-kit state from the Vue tree, or `null` when
 * no plugin is installed (e.g. a renderer mounted outside of any
 * `app.use(createDqlKit(...))` boundary). Callers fall back to the
 * unit key string in that case.
 */
const useState = (): DqlKitState | null => {
  if (!getCurrentInstance()) return null
  return inject(dqlKitInjectionKey, null)
}

/**
 * Resolve a unit's user-facing label, evaluating lazy thunks at call
 * time so reactive i18n sources (e.g. vue-i18n) stay live.
 *
 * Falls back to the unit key string itself (`'day'`, `'week'`, ...)
 * when no plugin is installed or the unit isn't registered. Apps
 * register labels via `createDqlKit({ relativeUnitLabels: ... })`.
 */
export const resolveRelativeUnitLabel = (unit: RelativeUnit | string): string => {
  const state = useState()
  const labels = state?.relativeUnitLabels as Record<string, unknown> | undefined
  const l = labels?.[unit]
  if (l === undefined) return unit
  return typeof l === 'function' ? (l as () => string)() : (l as string)
}

/**
 * Resolve a calendar-period label (a period unit, or `current` /
 * `previous` / `next` / `custom`), falling back to the key itself.
 * Apps register labels via `createDqlKit({ periodLabels: ... })`.
 */
export const resolvePeriodLabel = (key: keyof PeriodLabels | string): string => {
  const state = useState()
  const labels = state?.periodLabels as Record<string, unknown> | undefined
  const l = labels?.[key]
  if (l === undefined) return key
  return typeof l === 'function' ? (l as () => string)() : (l as string)
}

const ID_INPUT_DEFAULTS = {
  recent: 'Recent',
  loadMore: 'Load more',
  notFound: 'Not found:',
  truncated: 'List limit reached; the remaining ids were left out.',
} as const

/**
 * Resolve a text of the id inputs (see `IdInputLabels`), falling back
 * to English. Apps register texts via `createDqlKit({ idInputLabels })`.
 */
export const resolveIdInputLabel = (key: keyof typeof ID_INPUT_DEFAULTS): string => {
  const state = useState()
  const l = (state?.idInputLabels as Record<string, unknown> | undefined)?.[key]
  if (l === undefined) return ID_INPUT_DEFAULTS[key]
  return typeof l === 'function' ? (l as () => string)() : (l as string)
}
