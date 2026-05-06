import type {
  DraftAST,
  FieldDef,
  FilterSchema,
  Item,
  ValidAST,
  ValidationError,
} from '@dql-kit/core'
import type { Component, ComputedRef, Ref } from 'vue'

export type SyncMode = 'url' | 'none'

export type UseFilterOptions<S extends FilterSchema = FilterSchema> = {
  schema: S | Ref<S | undefined>
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
