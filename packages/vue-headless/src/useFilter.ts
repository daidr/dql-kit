import {
  analyze,
  astEqual,
  emptyAst,
  emptyDraft,
  fromUrl,
  isGroup,
  toUrl,
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
import {
  computed,
  effectScope,
  getCurrentScope,
  isRef,
  onScopeDispose,
  ref,
  toRaw,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'
import { createAsyncOrchestrator, type SearchSlotState } from './asyncOrchestrator.ts'
import type {
  CommitMode,
  FetcherMap,
  FetcherMapFor,
  FilterActions,
  SearchSlot,
  UseFilterOptions,
  UseFilterReturn,
} from './types.ts'
import type { UrlAdapter } from './urlAdapter.ts'

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

// sessionStorage key prefix. queryKey is appended so two filters on one page
// get disjoint storage entries the same way they get disjoint URL keys.
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
  // Default sync = 'none'. URL sync is opt-in: pass an adapter (e.g.
  // `vueRouterUrlAdapter()` from `@dql-kit/vue-headless/vue-router`) or
  // any object matching `UrlAdapter`.
  const sync: 'none' | UrlAdapter = opts.sync ?? 'none'
  const commitMode: CommitMode = opts.commitMode ?? 'auto'
  const queryKey = opts.queryKey ?? 'filter'
  const persistMode = opts.persistDraft ?? 'none'
  const storageKey = PERSIST_KEY_PREFIX + queryKey
  const urlAdapter: UrlAdapter | null = sync === 'none' ? null : sync

  // FetcherMap is captured at hook-call time. Treating it as immutable
  // for the lifetime of a useFilter instance keeps the orchestrator simple.
  const fetcherMap: FetcherMap = (opts.fetchers ?? {}) as FetcherMap
  const fetcherFor = (fieldKey: string): IdFetcher | undefined => fetcherMap[fieldKey]

  const schemaRef: ComputedRef<S | undefined> = computed(() =>
    isRef(opts.schema)
      ? (opts.schema.value as S | undefined)
      : (opts.schema as S | undefined),
  )

  const dropped: Ref<DroppedNode[]> = ref([])

  // Merge rule when persistDraft: 'session' is enabled — saved draft wins
  // entirely if it exists. A saved draft was written *after* the previous
  // session reconciled URL → draft, so it already contains the URL-derived
  // Valid AST plus any in-progress (incomplete) nodes. Reusing it preserves
  // both. No saved draft → fall back to URL → initial.
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

  const computeInitialState = (): { draft: DraftAST, committedAst: ValidAST } => {
    const s = schemaRef.value
    let urlAst: ValidAST | undefined
    if (urlAdapter && s) {
      const raw = urlAdapter.read()
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

  // Wrap all reactive work in a detached effect scope. We bind the
  // scope-stop hook to the *parent* scope (the host component) only if
  // one is active — otherwise the consumer is on their own for
  // teardown (e.g. a test calling useFilter directly without mount).
  // This avoids the `onScopeDispose() called with no active scope`
  // warning Vue prints when registering hooks outside setup().
  const scope = effectScope(true)
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

  // Single analysis pass produces both the pruned ValidAST and the per-
  // node ValidationErrors — replaces the old `prune` + `validate` double
  // walk.
  const analysis = computed(() => {
    const s = schemaRef.value
    if (!s) return { ast: emptyAst(), errors: [] as ValidationError[] }
    const plainDraft = cloneDraft(toRaw(draft.value))
    return analyze(plainDraft, s)
  })

  const valid: ComputedRef<ValidAST> = computed(() => analysis.value.ast)
  const errors: ComputedRef<ValidationError[]> = computed(() => analysis.value.errors)
  const committedValid: ComputedRef<ValidAST> = computed(() => committedValidRef.value)

  const isDirty: ComputedRef<boolean> = computed(() => {
    if (commitMode === 'auto') return false
    return !astEqual(valid.value, committedValidRef.value)
  })

  const commit = (): void => {
    if (commitMode === 'auto') return
    committedValidRef.value = cloneDraft(toRaw(valid.value)) as ValidAST
  }

  const discard = (): void => {
    if (commitMode === 'auto') return
    draft.value = cloneDraft(toRaw(committedValidRef.value)) as DraftAST
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
        // op so callers landing here from either path (addCondition with
        // field, or addCondition() followed by updateNode field) end up
        // in the same state.
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
        // one click.
        if ('field' in partial && partial.field !== undefined && partial.field !== cond.field) {
          cond.field = partial.field
          const fieldDef = s?.fields[partial.field]
          cond.op = fieldDef?.ops[0]?.name ?? null
          delete cond.value
        }
        // Op swap: drop value when the new op's valueShape differs from
        // the previous one. Preserve value when shape stays the same so
        // single-op tweaks don't lose user input.
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
    // applyAst is the "set the entire filter state" call. In 'manual'
    // mode treat it as an implicit commit so URL / persistDraft reflect
    // the new state without waiting for explicit commit().
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

  const labelOf = orchestrator.labelOf

  const invalidateLabels = (fieldKey?: string): void => {
    orchestrator.invalidateLabels(fieldKey)
    eagerResolve(valid.value)
  }

  const dismissDropped = (): void => {
    dropped.value = []
  }

  // Bind the detached scope's teardown to whatever active scope the
  // caller is in (component setup, parent effectScope, ...). If
  // there's no active scope, skip — the consumer must call
  // `filter.dispose()` manually if they want cleanup.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      orchestrator.dispose()
      scope.stop()
    })
  }
  scope.run(() => {
    // 'auto' commit mirror — keeps committedValidRef in lock-step with
    // valid so URL / persistDraft writers (which observe committedValid)
    // see edits flow through immediately.
    if (commitMode === 'auto') {
      watch(valid, (v) => {
        committedValidRef.value = cloneDraft(toRaw(v)) as ValidAST
      })
    }

    // Eager resolve — fires once on mount and on every valid change so
    // labels for new id values fetch right away.
    watch(valid, eagerResolve, { immediate: true })

    if (urlAdapter) {
      // External URL change → reset both draft and committedValidRef.
      // We compare against committedValidRef (not `valid`) because that's
      // what we last *wrote* — guards the watcher firing on our own writeback.
      const stopExternal = urlAdapter.watch((raw) => {
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
      })
      onScopeDispose(stopExternal)

      // Outgoing writer observes committedValid. In 'auto' mode this
      // updates on every keystroke, in 'manual' only on commit().
      watch(committedValid, (newVal) => {
        const encoded = toUrl(newVal)
        urlAdapter.write(encoded)
      })
    }

    if (persistMode === 'session') {
      const storage = getSessionStorage()
      if (storage) {
        // Mirror every draft mutation into sessionStorage. Empty AST removes
        // the key so devtools shows a clean slate after `clear()`.
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
  })

  return {
    schema: schemaRef,
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
