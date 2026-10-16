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

type CommonOpts = { label?: Label, group?: string }

type EnumOpts<V extends string | number> = CommonOpts & {
  valueLabels?: Partial<Record<V, Label>>
}

type CustomOpts<T extends string, D extends BuiltinFieldTypeId | undefined> = CommonOpts & {
  typeId: T
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
    builtinOps.between, builtinOps.in,
  ],
  boolean:  [builtinOps.eq],
  enum:     [builtinOps.eq, builtinOps.neq, builtinOps.in, builtinOps.notIn],
  date:     [builtinOps.eq, builtinOps.before, builtinOps.after, builtinOps.between],
  datetime: [builtinOps.before, builtinOps.after, builtinOps.between, builtinOps.inLast],
  id:       [builtinOps.eq, builtinOps.neq, builtinOps.in, builtinOps.notIn],
  array:    [builtinOps.contains, builtinOps.notContains, builtinOps.containsAll, builtinOps.isEmpty, builtinOps.notEmpty],
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
    ...(opts.label !== undefined && { label: opts.label }),
    ...(opts.group !== undefined && { group: opts.group }),
  })
}

export const f = {
  string(opts: CommonOpts = {}): WithOps<StringField<DefaultOps<'string'>>> {
    return augment({ typeId: 'string', ops: opSets.string, ...opts } as StringField<DefaultOps<'string'>>)
  },
  number(opts: CommonOpts = {}): WithOps<NumberField<DefaultOps<'number'>>> {
    return augment({ typeId: 'number', ops: opSets.number, ...opts } as NumberField<DefaultOps<'number'>>)
  },
  boolean(opts: CommonOpts = {}): WithOps<BooleanField<DefaultOps<'boolean'>>> {
    return augment({ typeId: 'boolean', ops: opSets.boolean, ...opts } as BooleanField<DefaultOps<'boolean'>>)
  },
  enum<V extends string | number>(
    values: ReadonlyArray<V>,
    opts: EnumOpts<V> = {},
  ): WithOps<EnumField<V, DefaultOps<'enum'>>> {
    const enumValues = values.map((v) => {
      const label = opts.valueLabels?.[v]
      return label === undefined ? { value: v } : { value: v, label }
    })
    return augment({
      typeId: 'enum',
      ops: opSets.enum,
      enumValues,
      ...(opts.label !== undefined && { label: opts.label }),
      ...(opts.group !== undefined && { group: opts.group }),
    } as EnumField<V, DefaultOps<'enum'>>)
  },
  date(opts: CommonOpts = {}): WithOps<DateField<DefaultOps<'date'>>> {
    return augment({ typeId: 'date', ops: opSets.date, ...opts } as DateField<DefaultOps<'date'>>)
  },
  datetime(opts: CommonOpts = {}): WithOps<DateTimeField<DefaultOps<'datetime'>>> {
    return augment({ typeId: 'datetime', ops: opSets.datetime, ...opts } as DateTimeField<DefaultOps<'datetime'>>)
  },
  // ID phantom is preserved through the return type so consumers reading
  // `schema.fields.authorId` get back `IdField<number>` (or whatever ID
  // they declared). The brand uses a `unique symbol` key (see types.ts)
  // so cross-ID assignments fail at the type level even though no
  // brand value exists at runtime.
  id<ID extends string | number = string | number>(
    opts: CommonOpts = {},
  ): WithOps<IdField<ID, DefaultOps<'id'>>> {
    return augment({ typeId: 'id', ops: opSets.id, ...opts } as unknown as IdField<ID, DefaultOps<'id'>>)
  },
  array<Item extends FieldDef>(
    itemType: Item,
    opts: CommonOpts = {},
  ): WithOps<ArrayField<Item, DefaultOps<'array'>>> {
    return augment({
      typeId: 'array',
      ops: opSets.array,
      itemType,
      ...opts,
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
