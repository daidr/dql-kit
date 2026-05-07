import type { Label, RelativeUnit } from '@dql-kit/core'
import { ref, type Ref } from 'vue'

/**
 * App-supplied label table for the relative-time units (`minute` /
 * `hour` / `day` / `week` / `month`). Values follow `Label = string |
 * (() => string)`:
 *
 *  - Pass plain strings for static localisation:
 *      setRelativeUnitLabels({ day: '天', week: '周', ... })
 *
 *  - Pass lazy functions to plug into a reactive i18n source (e.g.
 *    vue-i18n). The function is invoked at render time, so when the
 *    underlying locale ref changes, components that read these labels
 *    re-render automatically:
 *
 *      import { i18n } from '@/plugins/i18n'
 *      setRelativeUnitLabels({
 *        day:  () => i18n.global.t('dql.unit.day'),
 *        week: () => i18n.global.t('dql.unit.week'),
 *        ...
 *      })
 *
 * Units missing from the map fall back to their key string (`'day'`,
 * `'week'`, ...), so callers can register a partial map without
 * breaking unspecified units.
 */
export type RelativeUnitLabels = Partial<Record<RelativeUnit, Label>>

const labelsRef: Ref<RelativeUnitLabels> = ref({})

/** Replace the entire relative-unit label map. Pass `{}` to reset. */
export const setRelativeUnitLabels = (labels: RelativeUnitLabels): void => {
  labelsRef.value = { ...labels }
}

/**
 * Resolve a unit's user-facing label, evaluating lazy functions at call
 * time so reactive i18n sources (e.g. vue-i18n) stay live. Falls back
 * to the unit key string when no label is registered for the unit.
 */
export const resolveRelativeUnitLabel = (unit: RelativeUnit | string): string => {
  const l = (labelsRef.value as Record<string, Label | undefined>)[unit]
  if (l === undefined) return unit
  return typeof l === 'function' ? l() : l
}
