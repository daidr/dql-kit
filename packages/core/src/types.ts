export type Awaitable<T> = T | Promise<T>

export type Combinator = 'and' | 'or'

export type ValueShape = 'none' | 'single' | 'pair' | 'list' | 'relative'

export type Label = string | (() => string)

export type OpDef = {
  name: string
  valueShape: ValueShape
  label: Label
}

export type BuiltinFieldTypeId =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'id'
  | 'array'

export type FieldTypeId = BuiltinFieldTypeId | (string & {})

export type Item<ID = string | number> = {
  id: ID
  label: string
  meta?: unknown
}

export type IdFetcher<ID = string | number> = {
  search: (query: string, signal: AbortSignal) => Awaitable<Item<ID>[]>
  resolve: (ids: ID[], signal: AbortSignal) => Awaitable<Item<ID>[]>
}

// FieldDef is the open structural type seen by internal consumers (ast,
// url, drizzle ops). Builder functions return narrower per-typeId
// interfaces below so user code can carry richer information through
// the schema (concrete enum values, ID type for `f.id<number>()`, etc.).
export interface FieldDef {
  typeId: FieldTypeId
  label?: Label
  group?: string
  ops: OpDef[]
  enumValues?: ReadonlyArray<{ value: string | number, label?: Label }>
  itemType?: FieldDef
  // For `f.custom({ typeId: 'fulltext', delegateTo: 'string' })`: tells
  // value-type checks, default UI renderers, and SQL op fallbacks to
  // behave as if the field were the delegated builtin. Lets a custom
  // typeId be a *routing tag* (consumed by adapter overrides) without
  // forcing the consumer to re-implement every op handler from scratch.
  delegateTo?: BuiltinFieldTypeId
}

// Per-typeId narrowed shapes — these are what `f.string()`, `f.id<ID>()`
// etc. actually return. They extend FieldDef so any FieldDef-typed
// signature still accepts them; the typeId narrowing + phantom brands
// flow through `defineFilterSchema<F>` so consumers reading
// `schema.fields.authorId` get back `IdField<number>`.
export interface StringField extends FieldDef { typeId: 'string' }
export interface NumberField extends FieldDef { typeId: 'number' }
export interface BooleanField extends FieldDef { typeId: 'boolean' }
export interface EnumField<V extends string | number = string | number>
  extends FieldDef {
  typeId: 'enum'
  enumValues: ReadonlyArray<{ value: V, label?: Label }>
}
export interface DateField extends FieldDef { typeId: 'date' }
export interface DateTimeField extends FieldDef { typeId: 'datetime' }

// Nominal brand for `IdField<ID>`. The key is a `unique symbol` in the
// type system but never set at runtime, so:
//   - `IdField<string>` cannot be assigned to `IdField<number>` (TS
//     compares the unique-symbol property's value type);
//   - `f.id<number>()`'s runtime object literal doesn't actually carry
//     the brand — the field is optional (`?`) in the interface so the
//     literal is still structurally compatible.
declare const idBrand: unique symbol
export interface IdField<ID extends string | number = string | number>
  extends FieldDef {
  typeId: 'id'
  readonly [idBrand]?: ID
}
export interface ArrayField<Item extends FieldDef = FieldDef> extends FieldDef {
  typeId: 'array'
  itemType: Item
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

/**
 * Everything `parseAst` / `fromUrl` can report: the draft-level
 * `ValidationError`s plus problems that only untrusted input can have.
 *
 * - `invalid_node`: not a group or condition (wrong JSON type, bad
 *   combinator, non-array children, non-string field/op).
 * - `parse_error`: the URL string is not JSON.
 * - `unsupported_version`: the URL uses a newer envelope this build
 *   can't read.
 * - `limit_exceeded`: one of `AstLimits` was hit.
 */
export type ParseError =
  | ValidationError
  | { path: NodePath, code: 'invalid_node', message: string }
  | { path: NodePath, code: 'parse_error' }
  | { path: NodePath, code: 'unsupported_version', version: number }
  | { path: NodePath, code: 'limit_exceeded', limit: keyof AstLimits, max: number }

export type ParseErrorCode = ParseError['code']

/** A node `fromUrl` dropped, and why. Same shape as `ParseError`. */
export type DroppedNode = ParseError

/**
 * Bounds applied to untrusted ASTs. Depth counts group nesting (the
 * root group is depth 1); nodes counts groups and conditions;
 * list length bounds `list`-shaped values such as `in`.
 */
export type AstLimits = {
  maxDepth: number
  maxNodes: number
  maxListLength: number
}

// Nominal brand: only `parseAst` produces a `CheckedAST`. The symbol is
// type-level only; nothing is set at runtime.
declare const checkedBrand: unique symbol

/**
 * A `ValidAST` that went through `parseAst`: every field, op, value and
 * limit has been checked against the schema. SQL translators accept only
 * this type, so translating an unchecked AST doesn't compile.
 */
export type CheckedAST = ValidAST & { readonly [checkedBrand]: true }

export type ParseResult =
  | { ok: true, ast: CheckedAST }
  | { ok: false, errors: ParseError[] }

// Result of `analyze(draft, schema)` — a single tree walk produces both
// the pruned ValidAST (for executing/serialising) and the per-node
// errors (for surfacing in UI). Consumers that previously called
// `prune` + `validate` separately should switch to `analyze` and
// destructure to avoid double-walking.
export type Analysis = {
  ast: ValidAST
  errors: ValidationError[]
}

export const isGroup = (n: DraftNode | ValidNode): n is DraftGroup | ValidGroup =>
  n != null && typeof n === 'object' && 'combinator' in n
