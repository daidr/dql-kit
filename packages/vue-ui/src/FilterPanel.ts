import {
  isGroup,
  type DraftCondition,
  type DraftGroup,
  type DraftNode,
  type FieldDef,
  type Label,
  type OpDef,
  type ValueShape,
} from '@dql-kit/core'
import {
  dqlKitInjectionKey,
  filterInjectionKey,
  type DqlKitState,
  type UseFilterReturn,
} from '@dql-kit/vue-headless'
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  type PropType,
  type VNode,
} from 'vue'
import {
  StringInput,
  resolveRenderer as resolveRendererFn,
} from './renderers.ts'

const resolveLabel = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
}

// Bind the renderer resolver to the active DqlKit instance. Returns
// a `(typeId, shape, delegateTo)` closure so the per-condition render
// path doesn't re-inject on every row.
const useRendererResolver = () => {
  const state = inject(dqlKitInjectionKey, null) as DqlKitState | null
  return (typeId: string, shape: ValueShape, delegateTo?: string) =>
    resolveRendererFn(typeId, shape, {
      overrides: state?.renderers ?? null,
      delegateTo,
    })
}

// Resolve a (possibly app-overridden) op label. Plugin instance's
// `opLabels` wins over the schema-baked label, which wins over the op
// name.
const useOpLabelResolver = () => {
  const state = inject(dqlKitInjectionKey, null) as DqlKitState | null
  return (op: OpDef): string => {
    const override = state?.opLabels[op.name]
    if (override !== undefined) {
      return typeof override === 'function' ? override() : override
    }
    return resolveLabel(op.label, op.name)
  }
}

// In production builds (NODE_ENV === 'production') we suppress the
// warning to keep consumer logs quiet; everywhere else we surface it
// once per typeId so a missing renderer registration is loud during
// development.
const isProductionMode = (): boolean => {
  try {
    const g = globalThis as { process?: { env?: { NODE_ENV?: string } } }
    return g.process?.env?.NODE_ENV === 'production'
  } catch {
    return false
  }
}
const warnedTypeIds = new Set<string>()
const fallbackRenderer = (typeId: string) => {
  if (!isProductionMode() && !warnedTypeIds.has(typeId)) {
    warnedTypeIds.add(typeId)
    // eslint-disable-next-line no-console
    console.warn(
      `[dql-kit/vue] No renderer registered for typeId="${typeId}". `
        + `Falling back to StringInput. Register one via createDqlKit({ renderers: { "${typeId}": YourComponent } }).`,
    )
  }
  return StringInput
}

/**
 * The filter editing surface — group / condition tree with renderers,
 * combinator pickers, add/remove buttons, and the dropped-from-URL
 * notice.
 *
 * Pure rendering. No popover, no trigger, no internal show/hide state.
 * Compose with `<FilterButton>` (or any host-managed trigger) to build
 * a popover; render directly inline for an always-on filter UI.
 */
export const FilterPanel = defineComponent({
  name: 'FilterPanel',
  props: {
    filter: {
      type: Object as PropType<UseFilterReturn>,
      required: true,
    },
  },
  setup(props) {
    // Expose the active filter to descendant renderers (used by id
    // autocomplete to drive search.setQuery and read labelOf).
    provide(filterInjectionKey, props.filter)

    const resolveRenderer = useRendererResolver()
    const resolveOpLabel = useOpLabelResolver()

    const schema = computed(() => props.filter.schema.value)
    const draft = computed(() => props.filter.draft.value)

    const fieldOptions = computed(() => {
      const s = schema.value
      if (!s) return [] as Array<{ key: string, def: FieldDef }>
      return Object.entries(s.fields).map(([key, def]) => ({ key, def }))
    })

    const errors = computed(() => props.filter.errors.value)

    const pathsEqual = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i])

    const errorsAtPath = (path: number[]) =>
      errors.value.filter((e) => pathsEqual(e.path, path))

    const renderField = (cond: DraftCondition, path: number[]): VNode =>
      h(
        'select',
        {
          class: 'dql-field-select',
          'data-testid': 'field-select',
          value: cond.field ?? '',
          onChange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value
            if (v === '') return
            props.filter.actions.updateNode(path, { field: v })
          },
        },
        [
          h('option', { value: '' }, '— field —'),
          ...fieldOptions.value.map(({ key, def }) =>
            h('option', { value: key }, resolveLabel(def.label, key)),
          ),
        ],
      )

    const renderOperator = (
      cond: DraftCondition,
      path: number[],
      fieldDef: FieldDef | undefined,
      ops: OpDef[],
    ): VNode | null => {
      if (!fieldDef) return null
      return h(
        'select',
        {
          class: 'dql-op-select',
          'data-testid': 'op-select',
          value: cond.op ?? '',
          onChange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value
            if (v === '') return
            props.filter.actions.updateNode(path, { op: v })
          },
        },
        [
          h('option', { value: '' }, '— op —'),
          ...ops.map((o) => h('option', { value: o.name }, resolveOpLabel(o))),
        ],
      )
    }

    const renderValue = (
      cond: DraftCondition,
      path: number[],
      rendererField: FieldDef | undefined,
      op: OpDef | undefined,
    ): VNode | null => {
      if (!rendererField || !op) return null
      if (op.valueShape === 'none') return null
      if (!cond.field || !cond.op) return null
      const renderer =
        resolveRenderer(rendererField.typeId, op.valueShape, rendererField.delegateTo)
        ?? fallbackRenderer(rendererField.typeId)
      return h(renderer, {
        fieldKey: cond.field,
        field: rendererField,
        op: cond.op,
        value: cond.value,
        onUpdate: (v: unknown) => props.filter.actions.updateNode(path, { value: v }),
      })
    }

    const renderCondition = (cond: DraftCondition, path: number[]): VNode => {
      const s = schema.value
      const fieldDef = s && cond.field ? s.fields[cond.field] : undefined
      const ops = fieldDef?.ops ?? []
      const op = fieldDef && cond.op ? fieldDef.ops.find((o) => o.name === cond.op) : undefined
      // For array<U>, the value renderer dispatches off the inner item
      // type so e.g. an array<string> with `contains` op still renders a
      // single string input.
      const rendererField =
        fieldDef && fieldDef.typeId === 'array' && fieldDef.itemType
          ? fieldDef.itemType
          : fieldDef

      const errs = errorsAtPath(path)

      const valueNode = renderValue(cond, path, rendererField, op)
      const valueCell = h(
        'div',
        { class: 'dql-condition__value' },
        valueNode ? [valueNode] : [],
      )

      const errorIndicator =
        errs.length > 0
          ? h(
              'span',
              {
                class: 'dql-error-indicator',
                'data-testid': 'condition-error',
                'data-error-code': errs[0]!.code,
                role: 'status',
                'aria-label': errs[0]!.code,
                title: errs[0]!.code,
              },
              '!',
            )
          : null

      const removeBtn = h(
        'button',
        {
          type: 'button',
          class: 'dql-remove',
          'data-testid': 'remove-condition',
          'aria-label': 'remove condition',
          onClick: () => props.filter.actions.removeNode(path),
        },
        '×',
      )

      return h(
        'div',
        {
          class: [
            'dql-condition',
            errs.length > 0 ? 'dql-condition--error' : null,
          ].filter(Boolean) as string[],
          'data-testid': 'condition',
          'data-has-error': errs.length > 0 ? 'true' : 'false',
        },
        [
          renderField(cond, path),
          renderOperator(cond, path, fieldDef, ops),
          valueCell,
          errorIndicator,
          removeBtn,
        ].filter(Boolean) as VNode[],
      )
    }

    const renderGroup = (group: DraftGroup, path: number[]): VNode => {
      const isRoot = path.length === 0
      const depth = path.length

      // Mirror the canonical-AST flatten rule visually: AND/OR has no
      // observable effect on a 0- or 1-child group, so the picker is
      // hidden. Reappears as soon as a second child shows up.
      const showCombinator = group.children.length > 1

      const combinatorCol = showCombinator
        ? h(
            'div',
            { class: 'dql-group__combinator' },
            [
              h(
                'select',
                {
                  class: 'dql-combinator-select',
                  'data-testid': 'combinator-select',
                  value: group.combinator,
                  onChange: (e: Event) => {
                    const v = (e.target as HTMLSelectElement).value as 'and' | 'or'
                    props.filter.actions.setCombinator(path, v)
                  },
                },
                [
                  h('option', { value: 'and' }, 'AND'),
                  h('option', { value: 'or' }, 'OR'),
                ],
              ),
            ],
          )
        : null

      const childNodes = group.children.map((child: DraftNode, i: number) => {
        const childPath = [...path, i]
        return isGroup(child)
          ? renderGroup(child as DraftGroup, childPath)
          : renderCondition(child as DraftCondition, childPath)
      })

      const addCondBtn = h(
        'button',
        {
          type: 'button',
          class: 'dql-add-condition',
          'data-testid': 'add-condition',
          onClick: () => props.filter.actions.addCondition(path),
        },
        '+ Condition',
      )

      const addGroupBtn = h(
        'button',
        {
          type: 'button',
          class: 'dql-add-group',
          'data-testid': 'add-group',
          onClick: () => props.filter.actions.addGroup(path),
        },
        '+ Group',
      )

      const addRow = h(
        'div',
        { class: 'dql-group__add-row' },
        [addCondBtn, addGroupBtn],
      )

      const body = h(
        'div',
        { class: 'dql-group__body' },
        [...childNodes, addRow],
      )

      const removeCol = isRoot
        ? null
        : h(
            'div',
            { class: 'dql-group__remove-col' },
            [
              h(
                'button',
                {
                  type: 'button',
                  class: 'dql-remove dql-remove-group',
                  'data-testid': 'remove-group',
                  'aria-label': 'remove group',
                  onClick: () => props.filter.actions.removeNode(path),
                },
                '×',
              ),
            ],
          )

      return h(
        'div',
        {
          class: [
            'dql-group',
            isRoot ? 'dql-group--root' : 'dql-group--nested',
            `dql-group--depth-${depth}`,
          ],
          'data-testid': isRoot ? 'group' : 'group-nested',
          'data-depth': String(depth),
        },
        [combinatorCol, body, removeCol].filter(Boolean) as VNode[],
      )
    }

    const renderDroppedNotice = (): VNode | null =>
      props.filter.dropped.value.length > 0
        ? h(
            'div',
            {
              class: 'dql-dropped-notice',
              'data-testid': 'dropped-notice',
              'data-dropped-count': String(props.filter.dropped.value.length),
              role: 'alert',
            },
            [
              h(
                'span',
                { class: 'dql-dropped-message' },
                `${props.filter.dropped.value.length} condition(s) dropped due to schema changes`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'dql-dropped-dismiss',
                  'data-testid': 'dropped-dismiss',
                  onClick: () => props.filter.dismissDropped(),
                },
                'Dismiss',
              ),
            ],
          )
        : null

    return () => {
      const droppedNotice = renderDroppedNotice()
      const builder = renderGroup(draft.value, [])

      return h(
        'div',
        {
          class: 'dql-filter-panel',
          'data-testid': 'filter-panel',
        },
        [droppedNotice, builder].filter(Boolean) as VNode[],
      )
    }
  },
})
