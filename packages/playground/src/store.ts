import { useFilter } from '@dql-kit/vue-headless'
import type { CommitMode, UseFilterReturn } from '@dql-kit/vue-headless'
import type { ValidAST } from '@dql-kit/core'
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

// ---------------------------------------------------------------------------
// localStorage persistence — schema spec + last-known-good Valid AST.
// Picked over sessionStorage so a closed-and-reopened tab retains state;
// picked over `useFilter({ persistDraft: 'session' })` so we can persist
// across schema reloads (the built-in mode binds to a sessionStorage key
// scoped per useFilter instance and uses sessionStorage only).
// ---------------------------------------------------------------------------

const STORAGE_KEY_SPEC = 'dql-kit/playground/spec'
const STORAGE_KEY_AST  = 'dql-kit/playground/valid-ast'

const safeStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const readPersistedSpecText = (): string | null =>
  safeStorage()?.getItem(STORAGE_KEY_SPEC) ?? null

const writePersistedSpecText = (text: string): void => {
  // setItem throws QuotaExceededError when localStorage is full. Treat
  // that as a no-op — losing one persistence cycle is preferable to
  // crashing the watcher and corrupting future writes.
  try {
    safeStorage()?.setItem(STORAGE_KEY_SPEC, text)
  } catch {
    /* storage full / disabled — accept silent loss of persistence */
  }
}

const readPersistedAst = (): ValidAST | null => {
  const raw = safeStorage()?.getItem(STORAGE_KEY_AST)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    // Minimal structural validation — we trust the writer (ourselves)
    // beyond this. If the schema has changed since the last write,
    // useFilter's prune step drops references to removed fields.
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      'combinator' in parsed &&
      'children' in parsed &&
      Array.isArray((parsed as { children: unknown }).children)
    ) {
      return parsed as ValidAST
    }
  } catch {
    // Corrupt JSON or storage error — fall through.
  }
  return null
}

const writePersistedAst = (ast: ValidAST): void => {
  try {
    safeStorage()?.setItem(STORAGE_KEY_AST, JSON.stringify(ast))
  } catch {
    /* storage full / disabled — see writePersistedSpecText */
  }
}

const clearPersistedAst = (): void => {
  try {
    safeStorage()?.removeItem(STORAGE_KEY_AST)
  } catch {
    /* ignore */
  }
}

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

const createFilter = (
  spec: SchemaSpec,
  config: PlaygroundConfig,
  initial?: ValidAST,
): UseFilterReturn => {
  const schema = buildSchemaFromSpec(spec)
  const fetchers = buildFetcherMap(spec)
  return useFilter({
    schema,
    fetchers,
    commitMode: config.commitMode,
    debounceMs: config.debounceMs,
    ...(initial !== undefined && { initial }),
  }) as UseFilterReturn
}

export const createPlaygroundStore = (): PlaygroundStore => {
  // 1) specText — restore from localStorage, fall back to default spec.
  const persistedSpecText = readPersistedSpecText()
  const initialSpecText = persistedSpecText ?? formatSpec(defaultSpec)
  const specText = ref<string>(initialSpecText)

  // 2) appliedSpec — try parsing the persisted text. If that fails (corrupt
  //    JSON / removed required fields / etc.), fall back silently to the
  //    default spec; the editor still shows the persisted text so the user
  //    can fix the typo without losing their work.
  const initialParsed = parseSpec(initialSpecText)
  const initialAppliedSpec: SchemaSpec = initialParsed.ok
    ? initialParsed.value
    : defaultSpec
  const appliedSpec = ref<SchemaSpec>(initialAppliedSpec)

  const config = ref<PlaygroundConfig>({ ...DEFAULT_CONFIG })

  const parsedSpec = computed(() => parseSpec(specText.value))

  // 3) filter — restore last-known-good ValidAST. useFilter's `initial`
  //    argument feeds it through prune(), so any references to fields
  //    that no longer exist in the (potentially edited) schema are
  //    dropped silently.
  const persistedAst = readPersistedAst()
  // shallowRef so reassigning the filter object doesn't try to deep-track
  // the composable's internal refs (which already track themselves).
  const filter = shallowRef<UseFilterReturn>(
    createFilter(initialAppliedSpec, config.value, persistedAst ?? undefined),
  )

  const applySpec = (): void => {
    const parsed = parsedSpec.value
    if (!parsed.ok) return
    appliedSpec.value = parsed.value
    filter.value = createFilter(
      parsed.value,
      config.value,
      // Preserve the user's filter across schema edits. prune() will drop
      // any conditions whose fields no longer exist in the new schema.
      filter.value.valid.value,
    )
  }

  const resetSpec = (): void => {
    appliedSpec.value = defaultSpec
    specText.value = formatSpec(defaultSpec)
    // Reset wipes the saved filter too — otherwise the user clicks
    // "reset" expecting a fresh start and is greeted with stale state.
    clearPersistedAst()
    filter.value = createFilter(defaultSpec, config.value)
  }

  // Re-create the filter when commitMode / debounceMs change. Keep the
  // current filter contents — config changes shouldn't blow away work.
  watch(
    () => [config.value.commitMode, config.value.debounceMs] as const,
    () => {
      filter.value = createFilter(
        appliedSpec.value,
        config.value,
        filter.value.valid.value,
      )
    },
  )

  // ---- Persistence watchers ---------------------------------------
  // Mirror specText writes into localStorage directly.
  watch(specText, (text) => writePersistedSpecText(text))

  // Mirror committed Valid AST writes — `valid` is a ComputedRef that
  // recomputes on every meaningful draft change, so observing its value
  // (via the closure over filter) covers both filter-replacement and
  // in-place edits.
  watch(
    () => filter.value.valid.value,
    (valid) => writePersistedAst(valid),
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
