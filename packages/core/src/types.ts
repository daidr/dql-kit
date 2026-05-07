export type Awaitable<T> = T | Promise<T>

export type Combinator = 'and' | 'or'

export type ValueShape = 'none' | 'single' | 'pair' | 'list' | 'relative'

export type Label = string | (() => string)

export type OpDef = {
  name: string
  valueShape: ValueShape
  label: Label
}

export type FieldTypeId =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'id'
  | 'array'
  | (string & {})

export type Item<ID = string | number> = {
  id: ID
  label: string
  meta?: unknown
}

export type IdFetcher<ID = string | number> = {
  search: (query: string, signal: AbortSignal) => Awaitable<Item<ID>[]>
  resolve: (ids: ID[], signal: AbortSignal) => Awaitable<Item<ID>[]>
}

export type FieldDef = {
  typeId: FieldTypeId
  label?: Label
  group?: string
  ops: OpDef[]
  enumValues?: ReadonlyArray<{ value: string | number, label?: Label }>
  itemType?: FieldDef
}

export type GroupMeta = { label?: Label, order?: number }

export type FilterSchema<F extends Record<string, FieldDef> = Record<string, FieldDef>> = {
  fields: F
  groups: Record<string, GroupMeta>
}

export type DraftCondition = {
  field: string | null
  op: string | null
  value?: unknown
}
export type DraftGroup = {
  combinator: Combinator
  children: DraftNode[]
}
export type DraftNode = DraftGroup | DraftCondition
export type DraftAST = DraftGroup

export type ValidCondition = {
  field: string
  op: string
  value: unknown
}
export type ValidGroup = {
  combinator: Combinator
  children: ValidNode[]
}
export type ValidNode = ValidGroup | ValidCondition
export type ValidAST = ValidGroup

export type NodePath = number[]

export type ValidationError =
  | { path: NodePath, code: 'unknown_field', field: string }
  | { path: NodePath, code: 'op_not_allowed', field: string, op: string }
  | { path: NodePath, code: 'value_type_mismatch', expected: string, got: string }
  | { path: NodePath, code: 'value_shape_mismatch', op: string, expected: ValueShape }
  | { path: NodePath, code: 'incomplete', missing: 'field' | 'op' | 'value' }

export type DroppedNode = {
  path: NodePath
  reason: ValidationError['code']
  detail?: unknown
}

export const isGroup = (n: DraftNode | ValidNode): n is DraftGroup | ValidGroup =>
  n != null && typeof n === 'object' && 'combinator' in n
