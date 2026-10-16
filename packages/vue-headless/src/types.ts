import type {
  DraftAST,
  DraftNode,
  DroppedNode,
  FieldDef,
  FilterSchema,
  IdFetcher,
  IdField,
  Item,
  ValidAST,
  ValidationError,
} from '@dql-kit/core'
import type { Component } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { UrlAdapter } from './urlAdapter.ts'

/**
 * URL synchroniser. `'none'` (default) skips URL sync entirely; pass a
 * `UrlAdapter` (e.g. `vueRouterUrlAdapter()` from
 * `@dql-kit/vue-headless/vue-router`) to wire it up.
 *
 * URL sync is opt-in to keep the core hook router-agnostic — apps using
 * Nuxt, Next-style file routing, hand-rolled history, or no router at
 * all need their own adapter, and we don't want to make assumptions
 * about which one is in play.
 */
export type SyncMode = 'none' | UrlAdapter

/**
 * Controls when changes flow from the user-visible `valid` AST to the
 * "outside world" — URL query params, sessionStorage, and any
 * external watcher the consumer hooks up.
 *
 * - `'auto'` (default): every keystroke flows through immediately.
 *   Matches inline-filter UX (filter sits on the page, edits apply live).
 * - `'manual'`: edits accumulate in `valid` only; the outside world
 *   sees `committedValid`, which only updates when the consumer calls
 *   `commit()`. Matches popover / dialog "edit then apply" UX.
 */
export type CommitMode = 'auto' | 'manual'

// Open structural form — accepts any string→IdFetcher map. Used as the
// loose default when the schema's field types aren't recoverable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetcherMap = Record<string, IdFetcher<any>>

/**
 * Strict, schema-derived fetcher map. For each field whose declared
 * type is `IdField<ID>`, the corresponding entry is an
 * `IdFetcher<ID>`. Non-id fields are excluded. All entries are
 * optional: a field with no fetcher just skips async search/resolve
 * and falls back to `'#<id>'` for labels.
 */
export type FetcherMapFor<S extends FilterSchema> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof S['fields'] as S['fields'][K] extends IdField<any> ? K : never]?:
    S['fields'][K] extends IdField<infer ID> ? IdFetcher<ID> : never
}

export type UseFilterOptions<S extends FilterSchema = FilterSchema> = {
  schema: S | Ref<S | undefined>
  fetchers?: FetcherMapFor<S>
  initial?: ValidAST<S>
  /**
   * URL sync. Default `'none'` — call sites must explicitly opt in to
   * URL persistence by passing a `UrlAdapter`. Use the helper
   * `vueRouterUrlAdapter()` from `@dql-kit/vue-headless/vue-router` for
   * vue-router apps, or implement the `UrlAdapter` interface for any
   * other router.
   */
  sync?: SyncMode
  /**
   * When edits should reach URL / persistDraft / external watchers.
   * Defaults to `'auto'` (live edits flow immediately).
   */
  commitMode?: CommitMode
  queryKey?: string
  debounceMs?: number
  /**
   * Mirror the draft into sessionStorage so in-progress edits survive a
   * reload. With URL sync, a saved draft is only restored when it was
   * edited on top of the filter the URL currently carries.
   */
  persistDraft?: 'session' | 'none'
  /**
   * Collapse redundant nesting after every action: a group whose only
   * child is another group is replaced by that child (root included).
   * Off by default.
   */
  flattenDraft?: boolean
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
  setQuery: (fieldKey: string, query: string) => void
}

export type FilterActions = {
  addCondition: (parentPath: number[], condition?: Partial<{ field: string, op: string, value: unknown }>) => void
  removeNode: (path: number[]) => void
  updateNode: (path: number[], partial: Partial<{ field: string, op: string, value: unknown }>) => void
  /**
   * Append a group under `parentPath`, optionally seeded with `children`
   * (copied). Seeding in the same action matters with `flattenDraft`: an
   * empty group added as a lone child would be collapsed before a second
   * action could fill it.
   */
  addGroup: (parentPath: number[], combinator?: 'and' | 'or', children?: DraftNode[]) => void
  setCombinator: (path: number[], combinator: 'and' | 'or') => void
  /**
   * Wrap the group at `path` into a fresh outer group, prepended with an
   * empty condition. Result at `path` becomes
   *   { combinator: outer, children: [emptyCondition, originalGroup] }
   * where the original group keeps its combinator and children intact.
   *
   * `outerCombinator` defaults to the inverse of the wrapped group's
   * combinator — that's the case where wrapping changes precedence
   * (e.g. `(A OR B OR C) AND newCondition`); using the same combinator
   * collapses to the flat shape the caller could already build with
   * `addCondition`, so the inverse is the meaningful default.
   *
   * Root path `[]` is supported: the root group itself is wrapped.
   */
  wrapGroup: (path: number[], options?: { outerCombinator?: 'and' | 'or' }) => void
  /**
   * Dissolve the group at `path`, splicing its children into the parent
   * at the same index (they take on the parent's combinator). At the
   * root `[]` this only applies when the root's sole child is a group,
   * which then becomes the root.
   */
  unwrapGroup: (path: number[]) => void
  /**
   * Replace the node at `path` with a copy of `node`. At the root `[]`
   * the node must be a group.
   */
  replaceNode: (path: number[], node: DraftNode) => void
  clear: () => void
}

export type UseFilterReturn<S extends FilterSchema = FilterSchema> = {
  schema: ComputedRef<S | undefined>
  fetchers: FetcherMapFor<S>
  draft: Ref<DraftAST>
  /**
   * Live valid AST derived from `draft`. Always reflects the latest edits.
   * Typed against the schema (`ValidAST<S>`): every condition in it passed
   * `analyze`, so narrowing on `field` / `op` narrows `value`.
   */
  valid: ComputedRef<ValidAST<S>>
  /**
   * Last-committed valid AST. In `commitMode: 'auto'` this is identical
   * to `valid`. In `'manual'` it lags behind until `commit()` is called.
   */
  committedValid: ComputedRef<ValidAST<S>>
  isDirty: ComputedRef<boolean>
  commit: () => void
  discard: () => void
  errors: ComputedRef<ValidationError[]>
  dropped: Ref<DroppedNode[]>
  dismissDropped: () => void
  search: Ref<SearchSlot>
  labelOf: (fieldKey: string, id: string | number) => LabelStatus
  actions: FilterActions
  // Method syntax on purpose: method parameters are bivariant, so a
  // schema-typed `UseFilterReturn<typeof schema>` can still be passed to
  // components that accept the loose `UseFilterReturn`.
  applyAst(ast: ValidAST<S>): void
  toJSON: () => ValidAST<S>
  invalidateLabels: (fieldKey?: string) => void
}

export type FieldRendererProps = {
  fieldKey: string
  field: FieldDef
  op: string
  value: unknown
  onUpdate: (value: unknown) => void
}

// Component is referenced via FieldRendererProps consumers — kept here
// so `@dql-kit/vue-headless` re-export of FieldRendererProps stays
// self-contained without forcing users to import vue's `Component`.
export type { Component }
