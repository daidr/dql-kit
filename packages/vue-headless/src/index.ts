export { useFilter } from './useFilter.ts'
export { filterInjectionKey } from './inject.ts'
export {
  createDqlKit,
  dqlKitInjectionKey,
  type DqlKitInstance,
  type DqlKitOptions,
  type DqlKitState,
  type OpLabels,
  type RelativeUnitLabels,
  type RendererSet,
} from './plugin.ts'
export { createAsyncOrchestrator, type SearchSlotState } from './asyncOrchestrator.ts'
export {
  createMemoryUrlAdapter,
  type UrlAdapter,
} from './urlAdapter.ts'

// Common core types re-exported so consumers don't need to import from
// `@dql-kit/core` separately for everyday composables/components.
export type {
  Analysis,
  Combinator,
  DraftAST,
  DraftCondition,
  DraftGroup,
  DraftNode,
  DroppedNode,
  FieldDef,
  FilterSchema,
  IdField,
  IdFetcher,
  Item,
  Label,
  NodePath,
  OpDef,
  ValidAST,
  ValidCondition,
  ValidGroup,
  ValidNode,
  ValidationError,
  ValueShape,
} from '@dql-kit/core'

export type {
  CommitMode,
  FetcherMap,
  FetcherMapFor,
  FieldRendererProps,
  FilterActions,
  LabelStatus,
  SearchSlot,
  SyncMode,
  UseFilterOptions,
  UseFilterReturn,
} from './types.ts'
