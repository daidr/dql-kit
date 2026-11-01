import { builtinOps } from './ops.ts'
import type {
  ArrayField,
  BooleanField,
  BuiltinFieldTypeId,
  CustomField,
  DateField,
  DateTimeField,
  EnumField,
  FieldDef,
  IdField,
  Label,
  NumberField,
  OpDef,
  StringField,
} from './types.ts'

type CommonOpts = {
  label?: Label
  group?: string
  /**
   * The column can be NULL: adds `isEmpty` / `notEmpty` to the field's
   * default ops (string and array fields already have them).
   */
  nullable?: boolean
}

type StringOpts = CommonOpts & {
  /**
   * Compare strings case-sensitively. Default `false`: every string op
   * (`eq`, `in`, `contains`, ...) ignores case, so `eq` agrees with
   * `contains`.
   */
  caseSensitive?: boolean
}

type NullOps = typeof builtinOps.isEmpty | typeof builtinOps.notEmpty
/** Extra ops `nullable: true` adds. */
type NullableOps<N> = N extends true ? NullOps : never

type EnumOpts<V extends string | number> = CommonOpts & {
  valueLabels?: Partial<Record<V, Label>>
}

type CustomOpts<T extends string, D extends BuiltinFieldTypeId | undefined> = Omit<CommonOpts, 'nullable'> & {
  typeId: T
  /** With `delegateTo: 'string'`: compare case-sensitively (see `f.string`). */
  caseSensitive?: boolean
  /**
   * Make this custom typeId behave like a built-in field for everything
   * the adapter / UI doesn't explicitly override:
   *
   * - **Value-type checks** treat the value as the delegated primitive
   *   (e.g. `delegateTo: 'string'` rejects non-string values).
   * - **Default UI renderer** falls back to the delegated builtin's
   *   renderer set if no `registerRenderer(typeId, ...)` was supplied.
   * - **SQL op handler** falls back to the delegated builtin's behaviour
   *   when the adapter hasn't overridden the op for this typeId.
   * - **Default ops** are inherited from the delegated builtin if `ops`
   *   is omitted — this is what makes `f.custom({ typeId: 'fulltext',
   *   delegateTo: 'string' })` work without restating string ops.
   *
   * The custom typeId is still preserved on the FieldDef, so adapter
   * code can branch on `ctx.field.typeId` to inject custom behaviour
   * (e.g. cross-column ILIKE) where it actually matters.
   */
  delegateTo?: D
}

const opSets = {
  string:   [
    builtinOps.eq, builtinOps.neq, builtinOps.contains, builtinOps.notContains,
    builtinOps.startsWith, builtinOps.endsWith, builtinOps.isEmpty, builtinOps.notEmpty,
    builtinOps.in, builtinOps.notIn,
  ],
  number:   [
    builtinOps.eq, builtinOps.neq, builtinOps.gt, builtinOps.gte, builtinOps.lt, builtinOps.lte,
    builtinOps.between, builtinOps.notBetween, builtinOps.in, builtinOps.notIn,
  ],
  boolean:  [builtinOps.eq],
  enum:     [builtinOps.eq, builtinOps.neq, builtinOps.in, builtinOps.notIn],
  date:     [
    builtinOps.eq, builtinOps.before, builtinOps.after, builtinOps.onOrBefore, builtinOps.onOrAfter,
    builtinOps.between, builtinOps.inLast, builtinOps.inNext, builtinOps.notInLast,
  ],
  datetime: [
    builtinOps.before, builtinOps.after, builtinOps.onOrBefore, builtinOps.onOrAfter,
    builtinOps.between, builtinOps.inLast, builtinOps.inNext, builtinOps.notInLast,
  ],
  id:       [builtinOps.eq, builtinOps.neq, builtinOps.in, builtinOps.notIn],
  array:    [
    builtinOps.contains, builtinOps.notContains, builtinOps.containsAll, builtinOps.containsAny,
    builtinOps.isEmpty, builtinOps.notEmpty,
  ],
} as const satisfies Record<BuiltinFieldTypeId, OpDef[]>

/** Op union a builtin field type gets by default from its builder. */
export type DefaultOps<T extends BuiltinFieldTypeId> = (typeof opSets)[T][number]

type ReplaceOps<T extends FieldDef, O extends OpDef> =
  Omit<T, 'ops' | 'withOps'> & { ops: O[] }

/**
 * A builder result: the field definition plus `withOps`, which returns
 * a copy with extra ops appended. The op union grows with it, so
 * `f.string().withOps([myOp])` still yields precise `ValidAST` types
 * when `myOp` comes from `defineOp`.
 */
export type WithOps<T extends FieldDef> = T & {
  withOps<E extends OpDef>(extra: readonly E[]): WithOps<ReplaceOps<T, T['ops'][number] | E>>
}

// `withOps` copies rather than mutating, so a shared base field can be
// extended per schema without affecting other users.
const augment = <T extends FieldDef>(field: T): WithOps<T> =>
  Object.assign(field, {
    withOps(extra: readonly OpDef[]) {
      return augment({ ...field, ops: [...field.ops, ...extra] })
    },
  }) as WithOps<T>

// `nullable: true` appends isEmpty / notEmpty unless the set already has
// them. `nullable` itself is not stored on the field: the op list is the
// whole contract.
const withNullOps = (ops: readonly OpDef[], nullable: boolean | undefined): OpDef[] => {
  if (!nullable) return [...ops]
  const names = new Set(ops.map((o) => o.name))
  return [
    ...ops,
    ...[builtinOps.isEmpty, builtinOps.notEmpty].filter((o) => !names.has(o.name)),
  ]
}

const commonFields = (opts: CommonOpts) => ({
  ...(opts.label !== undefined && { label: opts.label }),
  ...(opts.group !== undefined && { group: opts.group }),
})

// Two overloads so the op union is right whether or not `ops` is
// given: explicit ops win; otherwise the delegated builtin's default
// set (or none). Keep `typeId` a literal (`as const`) so adapters and
// `CustomField<T>` can narrow on it.
function custom<
  const T extends string,
  O extends OpDef,
  D extends BuiltinFieldTypeId | undefined = undefined,
>(opts: CustomOpts<T, D> & { ops: readonly O[] }): WithOps<CustomField<T, D, O>>
function custom<const T extends string, D extends BuiltinFieldTypeId | undefined = undefined>(
  opts: CustomOpts<T, D> & { ops?: undefined },
): WithOps<CustomField<T, D, D extends BuiltinFieldTypeId ? DefaultOps<D> : never>>
function custom(
  opts: CustomOpts<string, BuiltinFieldTypeId | undefined> & { ops?: readonly OpDef[] },
): WithOps<FieldDef> {
  // If `ops` is omitted but `delegateTo` is set, inherit the delegated
  // builtin's default op list — this is what lets `f.custom({
  // typeId: 'fulltext', delegateTo: 'string' })` work as a "string
  // with a tag" without re-listing builtinOps.
  const ops: readonly OpDef[] =
    opts.ops
    ?? (opts.delegateTo ? opSets[opts.delegateTo] : undefined)
    ?? []
  return augment<FieldDef>({
    typeId: opts.typeId,
    ops: [...ops],
    ...(opts.delegateTo !== undefined && { delegateTo: opts.delegateTo }),
    ...commonFields(opts),
    ...(opts.caseSensitive && { caseSensitive: true }),
  })
}

// `enum` and `id` take a value / ID type argument that callers often
// spell out (`f.id<number>()`). TypeScript can't infer one type argument
// while another is given, so `nullable` is resolved by overloads here
// instead of a second type parameter.
function enumField<V extends string | number>(
  values: ReadonlyArray<V>,
  opts: EnumOpts<V> & { nullable: true },
): WithOps<EnumField<V, DefaultOps<'enum'> | NullOps>>
function enumField<V extends string | number>(
  values: ReadonlyArray<V>,
  opts?: EnumOpts<V> & { nullable?: false },
): WithOps<EnumField<V, DefaultOps<'enum'>>>
function enumField<V extends string | number>(
  values: ReadonlyArray<V>,
  opts?: EnumOpts<V>,
): WithOps<EnumField<V, DefaultOps<'enum'> | NullOps>>
function enumField<V extends string | number>(
  values: ReadonlyArray<V>,
  opts: EnumOpts<V> = {},
): WithOps<EnumField<V, DefaultOps<'enum'> | NullOps>> {
  const enumValues = values.map((v) => {
    const label = opts.valueLabels?.[v]
    return label === undefined ? { value: v } : { value: v, label }
  })
  return augment({
    typeId: 'enum',
    ops: withNullOps(opSets.enum, opts.nullable),
    enumValues,
    ...commonFields(opts),
  } as EnumField<V, DefaultOps<'enum'> | NullOps>)
}

function idField<ID extends string | number = string | number>(
  opts: CommonOpts & { nullable: true },
): WithOps<IdField<ID, DefaultOps<'id'> | NullOps>>
function idField<ID extends string | number = string | number>(
  opts?: CommonOpts & { nullable?: false },
): WithOps<IdField<ID, DefaultOps<'id'>>>
function idField<ID extends string | number = string | number>(
  opts?: CommonOpts,
): WithOps<IdField<ID, DefaultOps<'id'> | NullOps>>
function idField<ID extends string | number = string | number>(
  opts: CommonOpts = {},
): WithOps<IdField<ID, DefaultOps<'id'> | NullOps>> {
  return augment({
    typeId: 'id', ops: withNullOps(opSets.id, opts.nullable), ...commonFields(opts),
  } as unknown as IdField<ID, DefaultOps<'id'> | NullOps>)
}

export const f = {
  string<const N extends boolean = false>(
    opts: StringOpts & { nullable?: N } = {},
  ): WithOps<StringField<DefaultOps<'string'> | NullableOps<N>>> {
    return augment({
      typeId: 'string',
      ops: withNullOps(opSets.string, opts.nullable),
      ...commonFields(opts),
      ...(opts.caseSensitive && { caseSensitive: true }),
    } as StringField<DefaultOps<'string'> | NullableOps<N>>)
  },
  number<const N extends boolean = false>(
    opts: CommonOpts & { nullable?: N } = {},
  ): WithOps<NumberField<DefaultOps<'number'> | NullableOps<N>>> {
    return augment({
      typeId: 'number', ops: withNullOps(opSets.number, opts.nullable), ...commonFields(opts),
    } as NumberField<DefaultOps<'number'> | NullableOps<N>>)
  },
  boolean<const N extends boolean = false>(
    opts: CommonOpts & { nullable?: N } = {},
  ): WithOps<BooleanField<DefaultOps<'boolean'> | NullableOps<N>>> {
    return augment({
      typeId: 'boolean', ops: withNullOps(opSets.boolean, opts.nullable), ...commonFields(opts),
    } as BooleanField<DefaultOps<'boolean'> | NullableOps<N>>)
  },
  enum: enumField,
  date<const N extends boolean = false>(
    opts: CommonOpts & { nullable?: N } = {},
  ): WithOps<DateField<DefaultOps<'date'> | NullableOps<N>>> {
    return augment({
      typeId: 'date', ops: withNullOps(opSets.date, opts.nullable), ...commonFields(opts),
    } as DateField<DefaultOps<'date'> | NullableOps<N>>)
  },
  datetime<const N extends boolean = false>(
    opts: CommonOpts & { nullable?: N } = {},
  ): WithOps<DateTimeField<DefaultOps<'datetime'> | NullableOps<N>>> {
    return augment({
      typeId: 'datetime', ops: withNullOps(opSets.datetime, opts.nullable), ...commonFields(opts),
    } as DateTimeField<DefaultOps<'datetime'> | NullableOps<N>>)
  },
  // ID phantom is preserved through the return type so consumers reading
  // `schema.fields.authorId` get back `IdField<number>` (or whatever ID
  // they declared). The brand uses a `unique symbol` key (see types.ts)
  // so cross-ID assignments fail at the type level even though no
  // brand value exists at runtime.
  id: idField,
  array<Item extends FieldDef>(
    itemType: Item,
    opts: Omit<CommonOpts, 'nullable'> = {},
  ): WithOps<ArrayField<Item, DefaultOps<'array'>>> {
    return augment({
      typeId: 'array',
      ops: opSets.array,
      itemType,
      ...commonFields(opts),
    } as ArrayField<Item, DefaultOps<'array'>>)
  },
  custom,
}

export type DefineFilterSchemaInput<F extends Record<string, FieldDef>> = {
  fields: F
  groups?: Record<string, { label?: Label, order?: number }>
}

export const defineFilterSchema = <F extends Record<string, FieldDef>>(
  spec: DefineFilterSchemaInput<F>,
) => ({
  fields: spec.fields,
  groups: spec.groups ?? {},
})
