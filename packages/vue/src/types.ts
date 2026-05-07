import type {
  DraftAST,
  DroppedNode,
  FieldDef,
  FilterSchema,
  IdFetcher,
  IdField,
  Item,
  ValidAST,
  ValidationError,
} from '@dql-kit/core'
import type { Component, ComputedRef, Ref } from 'vue'

export type SyncMode = 'url' | 'none'

// Open structural form — accepts any string→IdFetcher map. Used as the
// loose default when the schema's field types aren't recoverable
// (e.g. `useFilter({ schema: someRef })` with widened generic). Consumers
// who want strict per-field ID typing get it for free via `FetcherMapFor<S>`
// below — TS picks that branch automatically when `schema` is a concrete
// schema constant.
//
// Value type uses `IdFetcher<any>` deliberately: TS otherwise rejects
// narrower fetchers being assigned to a wider `IdFetcher<string | number>`
// (resolve's `ids: ID[]` is contravariant).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetcherMap = Record<string, IdFetcher<any>>

/**
 * Strict, schema-derived fetcher map. For each field whose declared
 * type is `IdField<ID>`, the corresponding entry is an
 * `IdFetcher<ID>` — so `f.id<number>()` requires (and only accepts)
 * an `IdFetcher<number>`. Non-id fields are excluded from the map.
 *
 * All entries are optional: a field with no fetcher just skips async
 * search/resolve and falls back to `'#<id>'` for labels.
 */
export type FetcherMapFor<S extends FilterSchema> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof S['fields'] as S['fields'][K] extends IdField<any> ? K : never]?:
    S['fields'][K] extends IdField<infer ID> ? IdFetcher<ID> : never
}

export type UseFilterOptions<S extends FilterSchema = FilterSchema> = {
  schema: S | Ref<S | undefined>
  /**
   * Map of `f.id` field keys → async fetchers for label search/resolve.
   * Strictly typed against the schema: keys are limited to `IdField`
   * field names, values must match each field's declared ID type.
   * Missing entries make those fields silently skip async work (id
   * values still flow through the AST, only labels resolve to '#<id>'
   * fallback in the UI).
   */
  fetchers?: FetcherMapFor<S>
  initial?: ValidAST
  sync?: SyncMode
  queryKey?: string
  debounceMs?: number
  persistDraft?: 'session' | 'none'
}

export type LabelStatus<ID = string | number> =
  | { status: 'pending' }
  | { status: 'resolved', label: string, meta?: unknown }
  | { status: 'error', id: ID }

export type SearchSlot<ID = string | number> = {
  fieldKey: string | null
  query: string
  loading: boolean
  error: Error | null
  results: Item<ID>[]
  // Stable closure attached to the slot — Vue auto-unwraps refs in templates,
  // so callers can write `filter.search.setQuery(...)` from a template or
  // `filter.search.value.setQuery(...)` from JS.
  setQuery: (fieldKey: string, query: string) => void
}

export type FilterActions = {
  addCondition: (parentPath: number[], condition?: Partial<{ field: string, op: string, value: unknown }>) => void
  removeNode: (path: number[]) => void
  updateNode: (path: number[], partial: Partial<{ field: string, op: string, value: unknown }>) => void
  addGroup: (parentPath: number[], combinator?: 'and' | 'or') => void
  setCombinator: (path: number[], combinator: 'and' | 'or') => void
  clear: () => void
}

export type UseFilterReturn<S extends FilterSchema = FilterSchema> = {
  schema: ComputedRef<S | undefined>
  draft: Ref<DraftAST>
  valid: ComputedRef<ValidAST>
  errors: ComputedRef<ValidationError[]>
  // Nodes dropped by the URL codec on schema mismatch. Populated when
  // useFilter loads from a route query that referenced fields/ops/types
  // the current schema no longer honours, or rebuilt on URL changes.
  // `dismissDropped()` clears it (UI-side acknowledgement).
  dropped: Ref<DroppedNode[]>
  dismissDropped: () => void
  search: Ref<SearchSlot>
  labelOf: (fieldKey: string, id: string | number) => LabelStatus
  actions: FilterActions
  applyAst: (ast: ValidAST) => void
  toJSON: () => ValidAST
  invalidateLabels: (fieldKey?: string) => void
}

export type FieldRendererProps = {
  fieldKey: string
  field: FieldDef
  op: string
  value: unknown
  onUpdate: (value: unknown) => void
}

export type FieldRendererRegistry = Map<string, Component>

export type Variant = 'vertical-stack' | 'popover-trigger'
