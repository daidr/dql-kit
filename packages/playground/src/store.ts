import { useFilter } from '@dql-kit/vue-headless'
import type { CommitMode, UseFilterReturn } from '@dql-kit/vue-headless'
import {
  computed,
  inject,
  provide,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from 'vue'
import {
  buildFetcherMap,
  buildSchemaFromSpec,
  defaultSpec,
  type SchemaSpec,
} from './utils/schemaSpec.ts'

export type PlaygroundConfig = {
  commitMode: CommitMode
  debounceMs: number
  showFloatingPanel: boolean
  opLocale: 'en' | 'zh'
}

const DEFAULT_CONFIG: PlaygroundConfig = {
  commitMode: 'auto',
  debounceMs: 250,
  showFloatingPanel: true,
  opLocale: 'zh',
}

export type PlaygroundStore = {
  /** Raw JSON spec text user types into the schema editor. */
  specText: Ref<string>
  /** Parsed spec — null when the JSON is invalid. */
  parsedSpec: ComputedRef<{ ok: true, value: SchemaSpec } | { ok: false, error: string }>
  /** Last-known-good spec applied to the filter. */
  appliedSpec: Ref<SchemaSpec>
  /** The live filter instance. Replaced when schema changes. */
  filter: ShallowRef<UseFilterReturn>
  config: Ref<PlaygroundConfig>
  applySpec: () => void
  resetSpec: () => void
}

const storeKey: InjectionKey<PlaygroundStore> = Symbol('dql-kit/playground')

const formatSpec = (spec: SchemaSpec): string =>
  JSON.stringify(spec, null, 2)

const parseSpec = (
  text: string,
): { ok: true, value: SchemaSpec } | { ok: false, error: string } => {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || !('fields' in parsed)) {
      return { ok: false, error: 'spec 必须是包含 "fields" 的对象' }
    }
    return { ok: true, value: parsed as SchemaSpec }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const createFilter = (spec: SchemaSpec, config: PlaygroundConfig): UseFilterReturn => {
  const schema = buildSchemaFromSpec(spec)
  const fetchers = buildFetcherMap(spec)
  return useFilter({
    schema,
    fetchers,
    commitMode: config.commitMode,
    debounceMs: config.debounceMs,
  }) as UseFilterReturn
}

export const createPlaygroundStore = (): PlaygroundStore => {
  const appliedSpec = ref<SchemaSpec>(defaultSpec)
  const specText = ref<string>(formatSpec(defaultSpec))
  const config = ref<PlaygroundConfig>({ ...DEFAULT_CONFIG })

  const parsedSpec = computed(() => parseSpec(specText.value))

  // shallowRef so reassigning the filter object doesn't try to deep-track
  // the composable's internal refs (which already track themselves).
  const filter = shallowRef<UseFilterReturn>(
    createFilter(appliedSpec.value, config.value),
  )

  const applySpec = (): void => {
    const parsed = parsedSpec.value
    if (!parsed.ok) return
    appliedSpec.value = parsed.value
    filter.value = createFilter(parsed.value, config.value)
  }

  const resetSpec = (): void => {
    appliedSpec.value = defaultSpec
    specText.value = formatSpec(defaultSpec)
    filter.value = createFilter(defaultSpec, config.value)
  }

  // Re-create the filter when commitMode / debounceMs change.
  watch(
    () => [config.value.commitMode, config.value.debounceMs] as const,
    () => {
      filter.value = createFilter(appliedSpec.value, config.value)
    },
  )

  return {
    specText,
    parsedSpec,
    appliedSpec,
    filter,
    config,
    applySpec,
    resetSpec,
  }
}

export const providePlaygroundStore = (store: PlaygroundStore): void => {
  provide(storeKey, store)
}

export const usePlaygroundStore = (): PlaygroundStore => {
  const store = inject(storeKey)
  if (!store) {
    throw new Error('[playground] store not provided — wrap in <App>')
  }
  return store
}
