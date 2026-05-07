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
  type FilterSchema,
  type ValidAST,
  type ValidNode,
  type ValidationError,
} from '@dql-kit/core'
import { computed, isRef, ref, toRaw, watch, type ComputedRef, type Ref } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { createAsyncOrchestrator, type SearchSlotState } from './asyncOrchestrator.ts'
import type {
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

export const useFilter = <S extends FilterSchema>(
  opts: UseFilterOptions<S>,
): UseFilterReturn<S> => {
  const sync: SyncMode = opts.sync ?? 'none'
  const queryKey = opts.queryKey ?? 'filter'

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

  const initialDraft = (): DraftAST => {
    if (route && schemaRef.value) {
      const raw = queryValueAsString(route.query[queryKey])
      if (raw.length > 0) {
        const { ast } = fromUrl(raw, schemaRef.value)
        return cloneDraft(ast) as DraftAST
      }
    }
    if (opts.initial) return cloneDraft(opts.initial) as DraftAST
    return emptyDraft()
  }

  const draft = ref<DraftAST>(initialDraft()) as Ref<DraftAST>

  const debounceMs = opts.debounceMs ?? 250
  const orchestrator = createAsyncOrchestrator()

  const setSearchQuery = (fieldKey: string, query: string): void => {
    const s = schemaRef.value
    if (!s) return
    const fieldDef = s.fields[fieldKey]
    if (!fieldDef || fieldDef.typeId !== 'id' || !fieldDef.fetcher) return
    orchestrator.setQuery(
      fieldKey,
      query,
      fieldDef.fetcher.search,
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
        const next: DraftCondition = {
          field: condition?.field ?? null,
          op: condition?.op ?? null,
        }
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
        if ('field' in partial && partial.field !== undefined && partial.field !== cond.field) {
          cond.field = partial.field
          cond.op = null
          delete cond.value
        }
        if ('op' in partial && partial.op !== undefined) {
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
      if (fieldDef && fieldDef.typeId === 'id' && fieldDef.fetcher) {
        orchestrator.resolveBatch(fieldKey, ids, fieldDef.fetcher.resolve)
      }
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
    watch(
      () => queryValueAsString(route.query[queryKey]),
      (raw) => {
        const s = schemaRef.value
        if (!s) return
        const currentEncoded = toUrl(valid.value)
        if (currentEncoded === raw) return
        if (raw.length === 0) {
          if (draft.value.children.length > 0 || draft.value.combinator !== 'and') {
            draft.value = emptyDraft()
          }
          return
        }
        const { ast } = fromUrl(raw, s)
        draft.value = cloneDraft(ast) as DraftAST
      },
    )

    watch(valid, (newVal) => {
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

  return {
    schema: schemaRef,
    draft,
    valid,
    errors,
    search,
    labelOf,
    actions,
    applyAst,
    toJSON,
    invalidateLabels,
  }
}
