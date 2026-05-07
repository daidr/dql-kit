import type { Label, RelativeUnit } from '@dql-kit/core'
import {
  reactive,
  type App,
  type Component,
  type InjectionKey,
  type ObjectPlugin,
} from 'vue'

/**
 * Per-typeId renderer set. Either a single component (used regardless
 * of value shape) or a per-shape map. The resolver looks up
 * `set[shape] ?? set.default`.
 */
export type RendererSet =
  | Component
  | {
      default?: Component
      pair?: Component
      list?: Component
      relative?: Component
    }

export type RelativeUnitLabels = Partial<Record<RelativeUnit, Label>>
export type OpLabels = Record<string, Label>

export interface DqlKitOptions {
  /**
   * Map of field typeId → renderer set. Use for `f.custom(...)` types
   * whose default UI doesn't fit, or to override built-in renderers.
   */
  renderers?: Record<string, RendererSet>
  /**
   * Labels for relative-time units (`minute` / `hour` / `day` /
   * `week` / `month`). Values can be plain strings or lazy thunks
   * for reactive i18n integration. Without these, the UI falls back
   * to the unit key string itself (e.g. "day").
   */
  relativeUnitLabels?: RelativeUnitLabels
  /**
   * Per-op-name display label. Overrides the OpDef.label baked into
   * the schema (which itself defaults to the op name). Use to
   * localise built-in op names.
   */
  opLabels?: OpLabels
}

/**
 * Reactive state surface — what `inject(dqlKitInjectionKey)` returns
 * inside a component. Mutating any map propagates to all components
 * that read from it (label thunks re-evaluate on render, the renderer
 * Map's `get` re-runs).
 *
 * The `register*` / `set*` methods exist on the same object so user
 * code can hold a single reference (in Pinia, in a closure) and drive
 * updates from anywhere.
 */
export interface DqlKitState {
  renderers: Map<string, RendererSet>
  relativeUnitLabels: RelativeUnitLabels
  opLabels: OpLabels
  registerRenderer: (typeId: string, set: RendererSet) => void
  setRelativeUnitLabels: (labels: RelativeUnitLabels) => void
  setOpLabels: (labels: OpLabels) => void
}

/**
 * The thing returned by `createDqlKit(...)`. Extends Vue's
 * `ObjectPlugin` so `app.use(dqlKit)` matches the ObjectPlugin
 * branch of `Plugin<Options>` directly. The state surface is also
 * exposed on the same object so callers can do
 * `dqlKit.setOpLabels(...)` from outside a Vue tree.
 */
export interface DqlKitInstance extends DqlKitState, ObjectPlugin {}

export const dqlKitInjectionKey: InjectionKey<DqlKitState> =
  Symbol('dql-kit/state')

/**
 * Construct a dql-kit Vue plugin.
 *
 * ```ts
 * const dqlKit = createDqlKit({
 *   relativeUnitLabels: { day: '天', week: '周', ... },
 *   opLabels: { eq: '等于', neq: '不等于', ... },
 *   renderers: { fulltext: { default: MyFullTextInput } },
 * })
 * app.use(dqlKit)
 * ```
 *
 * Multiple Vue apps (SSR, microfrontends, Storybook stories) can each
 * install their own instance without contaminating one another — there
 * is no module-level shared state.
 */
export const createDqlKit = (options: DqlKitOptions = {}): DqlKitInstance => {
  const renderers = new Map<string, RendererSet>(
    Object.entries(options.renderers ?? {}),
  )
  // The label maps are reactive so lazy-thunk values that read from a
  // reactive locale source still re-render components when the locale
  // changes.
  const relativeUnitLabels = reactive<RelativeUnitLabels>({
    ...options.relativeUnitLabels,
  })
  const opLabels = reactive<OpLabels>({ ...options.opLabels })

  const state: DqlKitState = {
    renderers,
    relativeUnitLabels,
    opLabels,
    registerRenderer(typeId, set) {
      renderers.set(typeId, set)
    },
    setRelativeUnitLabels(labels) {
      // Replace, not merge — predictable for callers swapping locales.
      for (const k of Object.keys(relativeUnitLabels) as RelativeUnit[]) {
        delete relativeUnitLabels[k]
      }
      Object.assign(relativeUnitLabels, labels)
    },
    setOpLabels(labels) {
      for (const k of Object.keys(opLabels)) {
        delete opLabels[k]
      }
      Object.assign(opLabels, labels)
    },
  }

  return {
    ...state,
    install(app: App) {
      app.provide(dqlKitInjectionKey, state)
    },
  }
}
