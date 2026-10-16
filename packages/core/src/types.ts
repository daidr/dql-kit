import type { ConditionOf } from './typed-ast.ts'

export type Awaitable<T> = T | Promise<T>

export type Combinator = 'and' | 'or'

export type ValueShape = 'none' | 'single' | 'pair' | 'list' | 'relative'

export type Label = string | (() => string)

// `N` / `S` default to the open `string` / `ValueShape`, so an `OpDef`
// annotation still accepts any op. Built-in ops and `defineOp` keep the
// literal name and shape, which is what lets `ValidAST<S>` narrow `op`
// and `value` per field.
export type OpDef<N extends string = string, S extends ValueShape = ValueShape> = {
  name: N
  valueShape: S
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
//
// `O` is the union of op definitions the field accepts. It defaults to
// the open `OpDef`, so an unparameterised `FieldDef` still means "any
// field"; builders fill it with the concrete op set.
export interface FieldDef<O extends OpDef = OpDef> {
  typeId: FieldTypeId
  label?: Label
  group?: string
  ops: O[]
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
//
// The trailing `O` parameter on each is the field's op union. It
// defaults to the open `OpDef` so `StringField` alone still describes
// any string field; `f.string()` returns `StringField<StringOps>`.
export interface StringField<O extends OpDef = OpDef> extends FieldDef<O> { typeId: 'string' }
export interface NumberField<O extends OpDef = OpDef> extends FieldDef<O> { typeId: 'number' }
export interface BooleanField<O extends OpDef = OpDef> extends FieldDef<O> { typeId: 'boolean' }
export interface EnumField<
  V extends string | number = string | number,
  O extends OpDef = OpDef,
> extends FieldDef<O> {
  typeId: 'enum'
  enumValues: ReadonlyArray<{ value: V, label?: Label }>
}
export interface DateField<O extends OpDef = OpDef> extends FieldDef<O> { typeId: 'date' }
export interface DateTimeField<O extends OpDef = OpDef> extends FieldDef<O> { typeId: 'datetime' }

// Nominal brand for `IdField<ID>`. The key is a `unique symbol` in the
// type system but never set at runtime, so:
//   - `IdField<string>` cannot be assigned to `IdField<number>` (TS
//     compares the unique-symbol property's value type);
//   - `f.id<number>()`'s runtime object literal doesn't actually carry
//     the brand — the field is optional (`?`) in the interface so the
//     literal is still structurally compatible.
declare const idBrand: unique symbol
export interface IdField<
  ID extends string | number = string | number,
  O extends OpDef = OpDef,
> extends FieldDef<O> {
  typeId: 'id'
  readonly [idBrand]?: ID
}
export interface ArrayField<
  Item extends FieldDef = FieldDef,
  O extends OpDef = OpDef,
> extends FieldDef<O> {
  typeId: 'array'
  itemType: Item
}
// What `f.custom` returns. `T` is the custom typeId (keep it a literal
// with `as const` so adapters can narrow on it) and `D` the delegated
// builtin, if any. With `D` set, value types follow the delegated
// builtin; without it, values stay `unknown`, matching the runtime,
// which skips value-type checks for undelegated custom fields.
export type CustomField<
  T extends string = string,
  D extends BuiltinFieldTypeId | undefined = BuiltinFieldTypeId | undefined,
  O extends OpDef = OpDef,
> = FieldDef<O> & { typeId: T }
  & ([D] extends [BuiltinFieldTypeId] ? { delegateTo: D } : unknown)

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

// Valid* types are generic over the schema. Without an argument (or
// with the open `FilterSchema`) they are the loose structural shape
// every consumer used before: `field` / `op` are strings and `value` is
// unknown. With a concrete schema — `ValidAST<typeof schema>` — each
// condition is a discriminated union over the schema's fields and each
// field's ops, so `field`, `op` and `value` are checked together at
// compile time. See `typed-ast.ts` for the derivation.
//
// The tree itself is parameterised by the condition union (`ValidGroupOf`)
// rather than by the schema: `C` only appears in covariant position, so
// TypeScript relates `ValidAST<typeof schema>` to the loose `ValidAST`
// by comparing condition unions, which is what makes typed ASTs flow into
// APIs that take the loose form (adapters, `toUrl`, `astEqual`).
export type ValidCondition<S extends FilterSchema = FilterSchema> = ConditionOf<S>
export interface ValidGroupOf<C> {
  combinator: Combinator
  children: Array<ValidGroupOf<C> | C>
}
export type ValidGroup<S extends FilterSchema = FilterSchema> = ValidGroupOf<ValidCondition<S>>
export type ValidNode<S extends FilterSchema = FilterSchema> = ValidGroup<S> | ValidCondition<S>
export type ValidAST<S extends FilterSchema = FilterSchema> = ValidGroup<S>

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
export type CheckedAST<S extends FilterSchema = FilterSchema> =
  ValidAST<S> & { readonly [checkedBrand]: true }

export type ParseResult<S extends FilterSchema = FilterSchema> =
  | { ok: true, ast: CheckedAST<S> }
  | { ok: false, errors: ParseError[] }

// Result of `analyze(draft, schema)` — a single tree walk produces both
// the pruned ValidAST (for executing/serialising) and the per-node
// errors (for surfacing in UI). Consumers that previously called
// `prune` + `validate` separately should switch to `analyze` and
// destructure to avoid double-walking.
export type Analysis<S extends FilterSchema = FilterSchema> = {
  ast: ValidAST<S>
  errors: ValidationError[]
}

// Generic over the node type so a schema-typed `ValidNode<S>` narrows to
// `ValidGroup<S>` rather than to the loose `ValidGroup`.
export const isGroup = <N extends DraftNode | ValidNode>(
  n: N,
): n is Extract<N, { combinator: unknown }> =>
  n != null && typeof n === 'object' && 'combinator' in n
