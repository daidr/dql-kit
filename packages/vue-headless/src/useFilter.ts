import {
  emptyAst,
  emptyDraft,
  fromUrl,
  isGroup,
  prune as pruneAst,
  toUrl,
  validate as validateAst,
  type DraftAST,
  type DraftCondition,
  type DraftGroup,
  type DraftNode,
  type DroppedNode,
  type FilterSchema,
  type IdFetcher,
  type ValidAST,
  type ValidNode,
  type ValidationError,
} from '@dql-kit/core'
import { computed, isRef, ref, toRaw, watch, type ComputedRef, type Ref } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { createAsyncOrchestrator, type SearchSlotState } from './asyncOrchestrator.ts'
import type {
  CommitMode,
  FetcherMap,
  FetcherMapFor,
  FilterActions,
  SearchSlot,
  SyncMode,
  UseFilterOptions,
  UseFilterReturn,
} from './types.ts'

const cloneDraft = <T>(value: T): T => structuredClone(value)

const navigate = (root: DraftGroup, path: number[]): DraftNode | null => {
  let cur: DraftNode = root
  for (const idx of path) {
    if (!isGroup(cur)) return null
    const group = cur as DraftGroup
    const next: DraftNode | undefined = group.children[idx]
    if (next === undefined) return null
    cur = next
  }
  return cur
}

const navigateParent = (
  root: DraftGroup,
  path: number[],
): { parent: DraftGroup, index: number } | null => {
  if (path.length === 0) return null
  const parent = navigate(root, path.slice(0, -1))
  if (!parent || !isGroup(parent)) return null
  return { parent: parent as DraftGroup, index: path[path.length - 1]! }
}

const queryValueAsString = (
  raw: string | (string | null)[] | null | undefined,
): string => {
  if (typeof raw === 'string') return raw
  return ''
}

// sessionStorage key prefix. queryKey is appended so two filters on one page
// (e.g. `?a=...&b=...`) get disjoint storage entries the same way they get
// disjoint URL keys. Prefix exists so the keys are debug-greppable in devtools.
const PERSIST_KEY_PREFIX = 'dql-kit:draft:'

const getSessionStorage = (): Storage | null => {
  try {
    const s = (globalThis as { sessionStorage?: Storage }).sessionStorage
    return s ?? null
  } catch {
    return null
  }
}

const isEmptyDraft = (d: DraftAST): boolean =>
  d.combinator === 'and' && d.children.length === 0

const isDraftLike = (v: unknown): v is DraftAST => {
  if (!v || typeof v !== 'object') return false
  const o = v as { combinator?: unknown, children?: unknown }
  return (
    (o.combinator === 'and' || o.combinator === 'or') && Array.isArray(o.children)
  )
}

export const useFilter = <S extends FilterSchema>(
  opts: UseFilterOptions<S>,
): UseFilterReturn<S> => {
  const sync: SyncMode = opts.sync ?? 'none'
  const commitMode: CommitMode = opts.commitMode ?? 'auto'
  const queryKey = opts.queryKey ?? 'filter'
  const persistMode = opts.persistDraft ?? 'none'
  const storageKey = PERSIST_KEY_PREFIX + queryKey

  // FetcherMap is captured at hook-call time. Treating it as immutable
  // for the lifetime of a useFilter instance keeps the orchestrator
  // simple — if callers want hot-swap fetchers they can re-mount.
  // The public `fetchers` option is the schema-strict `FetcherMapFor<S>`,
  // but internally we treat it as the loose `FetcherMap` (any IdFetcher)
  // since the orchestrator dispatches by string fieldKey at runtime.
  const fetcherMap: FetcherMap = (opts.fetchers ?? {}) as FetcherMap
  const fetcherFor = (fieldKey: string): IdFetcher | undefined => fetcherMap[fieldKey]

  const schemaRef: ComputedRef<S | undefined> = computed(() =>
    isRef(opts.schema)
      ? (opts.schema.value as S | undefined)
      : (opts.schema as S | undefined),
  )

  const router = sync === 'url' ? useRouter() : undefined
  const route = sync === 'url' ? useRoute() : undefined
  if (sync === 'url' && (!router || !route)) {
    throw new Error(
      `[dql-kit/vue] useFilter({ sync: 'url' }) requires a vue-router context (no useRouter()/useRoute() available). Install vue-router and provide it via app.use(router), or use sync: 'none'.`,
    )
  }

  const dropped: Ref<DroppedNode[]> = ref([])

  // Merge rule when persistDraft: 'session' is enabled — saved draft wins
  // entirely if it exists. Rationale: a saved draft was written *after* the
  // previous session reconciled URL → draft, so it already contains the
  // URL-derived Valid AST plus any in-progress (incomplete) nodes the user
  // hadn't finished. Reusing it preserves both. If the URL changed externally
  // between sessions, the saved draft still wins on first paint; the URL
  // watcher (when sync: 'url') will then run on the next user edit and the
  // valid → URL writer reconciles. No saved draft → fall back to URL → initial.
  const readPersistedDraft = (): DraftAST | null => {
    if (persistMode !== 'session') return null
    const storage = getSessionStorage()
    if (!storage) return null
    try {
      const raw = storage.getItem(storageKey)
      if (raw === null) return null
      const parsed = JSON.parse(raw) as unknown
      if (isDraftLike(parsed)) return parsed
    } catch {
      // Corrupt JSON or storage access denied — silently fall through.
    }
    return null
  }

  // Compute draft + committed AST seeds together so persistDraft + URL
  // can stay independent: the URL is the canonical "last committed"
  // state, while a persisted draft (if any) carries the user's
  // in-progress edits across reloads. In `commitMode: 'manual'` this
  // means the popover survives a refresh with the user's pending
  // changes intact, but URL still reflects what was actually applied.
  const computeInitialState = (): { draft: DraftAST, committedAst: ValidAST } => {
    const s = schemaRef.value
    let urlAst: ValidAST | undefined
    if (route && s) {
      const raw = queryValueAsString(route.query[queryKey])
      if (raw.length > 0) {
        const { ast, dropped: d } = fromUrl(raw, s)
        if (d.length > 0) dropped.value = d
        urlAst = ast
      }
    }

    const persisted = readPersistedDraft()
    if (persisted) {
      return {
        draft: persisted,
        committedAst: urlAst ?? (opts.initial ? cloneDraft(opts.initial) : emptyAst()),
      }
    }

    if (urlAst) {
      return {
        draft: cloneDraft(urlAst) as DraftAST,
        committedAst: urlAst,
      }
    }

    if (opts.initial) {
      return {
        draft: cloneDraft(opts.initial) as DraftAST,
        committedAst: opts.initial,
      }
    }

    return { draft: emptyDraft(), committedAst: emptyAst() }
  }

  const initialState = computeInitialState()
  const draft = ref<DraftAST>(initialState.draft) as Ref<DraftAST>
  // The committed snapshot — what URL / persistDraft / external watchers
  // observe. In `'auto'` mode an effect below mirrors `valid` into this
  // ref live; in `'manual'` mode it only updates on explicit commit().
  const committedValidRef = ref<ValidAST>(initialState.committedAst) as Ref<ValidAST>

  const debounceMs = opts.debounceMs ?? 250
  const orchestrator = createAsyncOrchestrator()

  const setSearchQuery = (fieldKey: string, query: string): void => {
    const s = schemaRef.value
    if (!s) return
    const fieldDef = s.fields[fieldKey]
    if (!fieldDef || fieldDef.typeId !== 'id') return
    const fetcher = fetcherFor(fieldKey)
    if (!fetcher) return
    orchestrator.setQuery(
      fieldKey,
      query,
      fetcher.search,
      debounceMs,
      (patch) => {
        // Spread preserves the slot's `setQuery` member across updates.
        search.value = { ...search.value, ...patch } as SearchSlot
      },
    )
  }

  const search = ref<SearchSlot>({
    fieldKey: null,
    query: '',
    loading: false,
    error: null,
    results: [],
    setQuery: setSearchQuery,
  } as SearchSlotState & { setQuery: (k: string, q: string) => void })

  const valid: ComputedRef<ValidAST> = computed(() => {
    const s = schemaRef.value
    if (!s) return emptyAst()
    const plainDraft = cloneDraft(toRaw(draft.value))
    return pruneAst(plainDraft, s)
  })

  const errors: ComputedRef<ValidationError[]> = computed(() => {
    const s = schemaRef.value
    if (!s) return []
    const plainDraft = cloneDraft(toRaw(draft.value))
    const result = validateAst(plainDraft, s)
    return result.ok ? [] : result.errors
  })

  const committedValid: ComputedRef<ValidAST> = computed(() => committedValidRef.value)

  // AST equality via JSON serialisation. ValidAST is plain data with a
  // stable field order from prune (combinator, children) / pruneCondition
  // (field, op, value), so JSON.stringify is deterministic.
  const astEqual = (a: ValidAST, b: ValidAST): boolean =>
    JSON.stringify(a) === JSON.stringify(b)

  const isDirty: ComputedRef<boolean> = computed(() => {
    if (commitMode === 'auto') return false
    return !astEqual(valid.value, committedValidRef.value)
  })

  const commit = (): void => {
    if (commitMode === 'auto') return
    // Snapshot current valid; clone so downstream mutations of either
    // side don't bleed into the other.
    committedValidRef.value = cloneDraft(toRaw(valid.value)) as ValidAST
  }

  const discard = (): void => {
    if (commitMode === 'auto') return
    draft.value = cloneDraft(toRaw(committedValidRef.value)) as DraftAST
  }

  // In 'auto' mode commit happens automatically on every draft change.
  // The watcher below keeps committedValidRef in lock-step with valid,
  // so URL / persistDraft writers (which observe committedValid) see
  // edits flow through immediately.
  if (commitMode === 'auto') {
    watch(valid, (v) => {
      committedValidRef.value = cloneDraft(toRaw(v)) as ValidAST
    })
  }

  const mutate = (fn: (d: DraftAST) => void): void => {
    const next = cloneDraft(toRaw(draft.value))
    fn(next)
    draft.value = next
  }

  const actions: FilterActions = {
    addCondition(parentPath, condition) {
      mutate((d) => {
        const target =
          parentPath.length === 0 ? d : (navigate(d, parentPath) as DraftGroup | null)
        if (!target || !isGroup(target)) return
        const s = schemaRef.value

        let field: string | null = condition?.field ?? null
        let op: string | null = condition?.op ?? null
        // If caller gave a field but no op, auto-pick the field's first
        // op — matches the field-swap auto-fill in updateNode so callers
        // who go either way (addCondition with field, or addCondition()
        // followed by updateNode field) land on the same state.
        if (field && op === null && s) {
          const fieldDef = s.fields[field]
          op = fieldDef?.ops[0]?.name ?? null
        }

        const next: DraftCondition = { field, op }
        if (condition && 'value' in condition) {
          next.value = condition.value
        }
        ;(target as DraftGroup).children.push(next)
      })
    },
    removeNode(path) {
      if (path.length === 0) return
      mutate((d) => {
        const located = navigateParent(d, path)
        if (!located) return
        located.parent.children.splice(located.index, 1)
      })
    },
    updateNode(path, partial) {
      mutate((d) => {
        const node = navigate(d, path)
        if (!node || isGroup(node)) return
        const cond = node as DraftCondition
        const s = schemaRef.value

        // Field swap: reset op + value, then auto-pick the first op from
        // the new field's op list so the user lands in a valid state with
        // one click. Falls back to null if the schema isn't available or
        // the field is unknown — the existing prune / validate guards
        // still catch incomplete drafts.
        if ('field' in partial && partial.field !== undefined && partial.field !== cond.field) {
          cond.field = partial.field
          const fieldDef = s?.fields[partial.field]
          cond.op = fieldDef?.ops[0]?.name ?? null
          delete cond.value
        }
        // Op swap: drop value when the new op's valueShape differs from
        // the previous one (e.g. `between` → `eq` invalidates the old
        // [a, b] tuple). Preserve value when shape stays the same
        // (eq ↔ neq, contains ↔ notContains, ...) so single-op tweaks
        // don't lose the user's input.
        if ('op' in partial && partial.op !== undefined && partial.op !== cond.op) {
          const fieldDef = cond.field && s ? s.fields[cond.field] : undefined
          const oldOp = fieldDef?.ops.find((o) => o.name === cond.op)
          const newOp = fieldDef?.ops.find((o) => o.name === partial.op)
          cond.op = partial.op
          if (oldOp && newOp && oldOp.valueShape !== newOp.valueShape) {
            delete cond.value
          }
        } else if ('op' in partial && partial.op !== undefined) {
          cond.op = partial.op
        }
        if ('value' in partial) {
          cond.value = partial.value
        }
      })
    },
    addGroup(parentPath, combinator = 'and') {
      mutate((d) => {
        const target =
          parentPath.length === 0 ? d : (navigate(d, parentPath) as DraftGroup | null)
        if (!target || !isGroup(target)) return
        ;(target as DraftGroup).children.push({ combinator, children: [] })
      })
    },
    setCombinator(path, combinator) {
      mutate((d) => {
        const node = path.length === 0 ? d : navigate(d, path)
        if (!node || !isGroup(node)) return
        ;(node as DraftGroup).combinator = combinator
      })
    },
    clear() {
      draft.value = emptyDraft()
    },
  }

  const applyAst = (ast: ValidAST): void => {
    draft.value = cloneDraft(ast) as DraftAST
    // applyAst is the "set the entire filter state" call (loading a
    // saved preset, replaying an external AST, ...). In 'manual' mode
    // we treat it as an implicit commit so URL / persistDraft reflect
    // the new state without waiting for an explicit commit().
    committedValidRef.value = cloneDraft(ast) as ValidAST
  }

  const toJSON = (): ValidAST => valid.value

  const collectIdsByField = (
    ast: ValidAST,
    schema: FilterSchema,
  ): Map<string, (string | number)[]> => {
    const out = new Map<string, (string | number)[]>()
    const visit = (node: ValidNode): void => {
      if ('combinator' in node) {
        node.children.forEach(visit)
        return
      }
      const fieldDef = schema.fields[node.field]
      if (!fieldDef || fieldDef.typeId !== 'id') return
      const bucket = out.get(node.field) ?? []
      if (Array.isArray(node.value)) {
        for (const v of node.value) {
          if (typeof v === 'string' || typeof v === 'number') bucket.push(v)
        }
      } else if (typeof node.value === 'string' || typeof node.value === 'number') {
        bucket.push(node.value)
      }
      out.set(node.field, bucket)
    }
    visit(ast)
    return out
  }

  const eagerResolve = (v: ValidAST): void => {
    const s = schemaRef.value
    if (!s) return
    const map = collectIdsByField(v, s)
    for (const [fieldKey, ids] of map) {
      const fieldDef = s.fields[fieldKey]
      if (!fieldDef || fieldDef.typeId !== 'id') continue
      const fetcher = fetcherFor(fieldKey)
      if (!fetcher) continue
      orchestrator.resolveBatch(fieldKey, ids, fetcher.resolve)
    }
  }

  watch(valid, eagerResolve, { immediate: true })

  const labelOf = orchestrator.labelOf

  const invalidateLabels = (fieldKey?: string): void => {
    orchestrator.invalidateLabels(fieldKey)
    // Re-trigger resolve for everything still referenced by the AST so the
    // cache refills rather than staying empty until the next AST change.
    eagerResolve(valid.value)
  }

  if (sync === 'url' && router && route) {
    // External URL change → reset both draft and committedValidRef.
    // We compare against committedValidRef (not `valid`) because that's
    // what we last *wrote* to the URL — guards against the watcher
    // firing on our own writeback. Any uncommitted draft edits are
    // discarded, matching how a user-initiated URL navigation would
    // behave (back/forward, paste, share link).
    watch(
      () => queryValueAsString(route.query[queryKey]),
      (raw) => {
        const s = schemaRef.value
        if (!s) return
        const currentEncoded = toUrl(committedValidRef.value)
        if (currentEncoded === raw) return
        if (raw.length === 0) {
          if (draft.value.children.length > 0 || draft.value.combinator !== 'and') {
            draft.value = emptyDraft()
          }
          committedValidRef.value = emptyAst()
          return
        }
        const { ast, dropped: d } = fromUrl(raw, s)
        if (d.length > 0) dropped.value = d
        draft.value = cloneDraft(ast) as DraftAST
        committedValidRef.value = ast
      },
    )

    // Outgoing writer observes committedValid. In 'auto' mode this
    // updates on every keystroke (live edits → URL), in 'manual' it
    // updates only when commit() runs (batch apply → URL).
    watch(committedValid, (newVal) => {
      const encoded = toUrl(newVal)
      const cur = queryValueAsString(route.query[queryKey])
      if (cur === encoded) return
      const nextQuery: LocationQueryRaw = { ...route.query }
      if (encoded.length === 0) {
        delete nextQuery[queryKey]
      } else {
        nextQuery[queryKey] = encoded
      }
      void router.replace({ query: nextQuery })
    })
  }

  if (persistMode === 'session') {
    const storage = getSessionStorage()
    if (storage) {
      // Mirror every draft mutation into sessionStorage. Empty AST removes the
      // key (so devtools shows a clean slate after `clear()` and the initial
      // load doesn't restore a stale empty entry). Storage errors (quota,
      // disabled, private mode) are silently swallowed — losing persistence
      // is preferable to crashing the composable.
      watch(draft, (next) => {
        try {
          if (isEmptyDraft(next)) {
            storage.removeItem(storageKey)
          } else {
            storage.setItem(storageKey, JSON.stringify(next))
          }
        } catch {
          /* quota / disabled — silent */
        }
      })
    }
  }

  const dismissDropped = (): void => {
    dropped.value = []
  }

  return {
    schema: schemaRef,
    // Re-expose the captured fetcher map. Cast to the schema-strict
    // `FetcherMapFor<S>` shape — the runtime container is always the
    // looser `FetcherMap` (any IdFetcher), but the surface type matches
    // what the caller passed in via `opts.fetchers`.
    fetchers: fetcherMap as FetcherMapFor<S>,
    draft,
    valid,
    committedValid,
    isDirty,
    commit,
    discard,
    errors,
    dropped,
    dismissDropped,
    search,
    labelOf,
    actions,
    applyAst,
    toJSON,
    invalidateLabels,
  }
}
