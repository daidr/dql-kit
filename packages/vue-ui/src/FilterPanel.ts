// Render-only filter editing surface. Visual + DOM mirror story-verse's
// `DqlFilterGroup.vue`:
//
//   ┌──────┬─────────────────────────────────────────────────┬────┐
//   │ AND/ │ ┌────────────────────────────────────────────┐  │ ×  │
//   │ OR   │ │ field ▾  op ▾   value …   [!]   ×          │  │    │
//   │ pill │ ├────────────────────────────────────────────┤  │    │
//   │ + L  │ │ field ▾  op ▾   value …                    │  │    │
//   │ guid │ └────────────────────────────────────────────┘  │    │
//   ├──────┴─────────────────────────────────────────────────┤    │
//   │ + Add cond.   ⊕ Add group   ⊕ Group current ·  Clear   │    │
//   └────────────────────────────────────────────────────────┴────┘
//
// The combinator column collapses when a group has 0 or 1 children
// (AND/OR has no observable effect). Root group skips the gray frame
// + remove × column; nested groups get both. Add buttons render as a
// horizontal row (no popover) — `<DqlFilter>`-style hosting is the
// caller's concern, not vue-ui's.
//
// Icons are unicode characters with stable class hooks (`.dql-icon` /
// `.dql-icon-warn`) so a host app can override them via CSS (replace
// content with iconify, FontAwesome, etc.).

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

const useRendererResolver = () => {
  const state = inject(dqlKitInjectionKey, null) as DqlKitState | null
  return (typeId: string, shape: ValueShape, delegateTo?: string) =>
    resolveRendererFn(typeId, shape, {
      overrides: state?.renderers ?? null,
      delegateTo,
    })
}

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
      `[dql-kit/vue-ui] No renderer registered for typeId="${typeId}". `
        + `Falling back to StringInput. Register one via `
        + `createDqlKit({ renderers: { "${typeId}": YourComponent } }).`,
    )
  }
  return StringInput
}

// Unicode glyph + class hook. Hosts can override either via CSS (e.g.
// `.dql-icon--close { content: ''; background: url(my-svg) }`) or by
// providing a renderer override at the component level.
const iconNode = (
  glyph: string,
  variant: 'close' | 'add' | 'warn' | 'eraser' | 'folder' | 'group',
): VNode =>
  h(
    'span',
    {
      class: ['dql-icon', `dql-icon--${variant}`],
      'aria-hidden': 'true',
    },
    glyph,
  )

// ---------------------------------------------------------------------------
// Recursive group node
// ---------------------------------------------------------------------------

const DqlGroupNode = defineComponent({
  name: 'DqlGroupNode',
  props: {
    filter: { type: Object as PropType<UseFilterReturn>, required: true },
    group:  { type: Object as PropType<DraftGroup>,       required: true },
    path:   { type: Array  as PropType<number[]>,         required: true },
  },
  setup(props) {
    const resolveRenderer = useRendererResolver()
    const resolveOpLabel = useOpLabelResolver()

    const isRoot = computed(() => props.path.length === 0)
    const showCombinator = computed(() => props.group.children.length > 1)
    const schema = computed(() => props.filter.schema.value)
    const errors = computed(() => props.filter.errors.value)

    const fieldOptions = computed(() => {
      const s = schema.value
      if (!s) return [] as Array<{ key: string, def: FieldDef }>
      return Object.entries(s.fields).map(([key, def]) => ({ key, def }))
    })

    const pathsEqual = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i])
    const errorsAtPath = (path: number[]) =>
      errors.value.filter((e) => pathsEqual(e.path, path))
    const errorMessages = (errs: ReturnType<typeof errorsAtPath>): string[] =>
      errs.map((e) => {
        switch (e.code) {
          case 'incomplete':           return `Incomplete: missing ${e.missing}`
          case 'unknown_field':        return `Unknown field: ${e.field}`
          case 'op_not_allowed':       return `Field "${e.field}" doesn't support op "${e.op}"`
          case 'value_type_mismatch':  return `Value type mismatch: expected ${e.expected}, got ${e.got}`
          case 'value_shape_mismatch': return `Value shape mismatch: ${e.op} expects ${e.expected}`
          default:                     return JSON.stringify(e)
        }
      })

    const fieldDefOf = (cond: DraftCondition): FieldDef | undefined => {
      const s = schema.value
      if (!s || !cond.field) return undefined
      return s.fields[cond.field]
    }
    const opDefOf = (cond: DraftCondition): OpDef | undefined => {
      const fd = fieldDefOf(cond)
      if (!fd || !cond.op) return undefined
      return fd.ops.find((o) => o.name === cond.op)
    }
    // For array<U>, dispatch on the inner item type so a `contains` op
    // gets a single string input rather than an array renderer.
    const rendererFieldOf = (cond: DraftCondition): FieldDef | undefined => {
      const fd = fieldDefOf(cond)
      if (fd && fd.typeId === 'array' && fd.itemType) return fd.itemType
      return fd
    }

    // ---- actions ----------------------------------------------------
    const toggleCombinator = () => {
      props.filter.actions.setCombinator(
        props.path,
        props.group.combinator === 'and' ? 'or' : 'and',
      )
    }
    const addCondition = () => props.filter.actions.addCondition(props.path)
    const addGroup = () => {
      // Seed with an empty condition to match the addCondition affordance.
      const newIdx = props.group.children.length
      props.filter.actions.addGroup(props.path)
      props.filter.actions.addCondition([...props.path, newIdx])
    }
    const combineCurrent = () => props.filter.actions.wrapGroup(props.path)
    const removeGroup = () => props.filter.actions.removeNode(props.path)
    const clearAll = () => props.filter.actions.clear()
    const updateField = (path: number[], v: string) => {
      if (!v) return
      props.filter.actions.updateNode(path, { field: v })
    }
    const updateOp = (path: number[], v: string) => {
      if (!v) return
      props.filter.actions.updateNode(path, { op: v })
    }
    const updateValue = (path: number[], v: unknown) => {
      props.filter.actions.updateNode(path, { value: v })
    }
    const removeCondition = (path: number[]) =>
      props.filter.actions.removeNode(path)

    // Number of valid leaf conditions — disables the clear button when
    // there's nothing to clear.
    const editActiveCount = computed(() => {
      const count = (n: import('@dql-kit/core').ValidNode): number =>
        'combinator' in n ? n.children.reduce((s, c) => s + count(c), 0) : 1
      return count(props.filter.valid.value)
    })

    // ---- render parts -----------------------------------------------
    const renderCombinatorCol = (): VNode | null => {
      if (!showCombinator.value) return null
      return h('div', { class: 'dql-group__combinator-col' }, [
        h('div', { class: 'dql-group__line dql-group__line--top', 'aria-hidden': 'true' }),
        h('div', { class: 'dql-group__pill' }, [
          h(
            'button',
            {
              type: 'button',
              class: 'dql-combinator-btn',
              'data-combinator': props.group.combinator,
              'data-testid': 'combinator-toggle',
              // Two-state toggle: surface the *current* state via
              // `aria-pressed` so screen-reader users hear "AND,
              // toggle button, pressed" — not just the action label.
              role: 'switch',
              'aria-checked': props.group.combinator === 'and' ? 'true' : 'false',
              'aria-label': 'Combinator (AND / OR)',
              onClick: toggleCombinator,
            },
            props.group.combinator === 'and' ? 'AND' : 'OR',
          ),
        ]),
        h('div', { class: 'dql-group__line dql-group__line--bottom', 'aria-hidden': 'true' }),
      ])
    }

    const renderFieldSelect = (cond: DraftCondition, path: number[]) =>
      h('div', { class: 'dql-condition__field' }, [
        h(
          'select',
          {
            class: 'dql-select',
            'data-testid': 'field-select',
            value: cond.field ?? '',
            onChange: (e: Event) =>
              updateField(path, (e.target as HTMLSelectElement).value),
          },
          [
            h('option', { value: '', disabled: true }, 'field…'),
            ...fieldOptions.value.map(({ key, def }) =>
              h('option', { value: key }, resolveLabel(def.label, key)),
            ),
          ],
        ),
      ])

    const renderOpSelect = (
      cond: DraftCondition,
      path: number[],
      fd: FieldDef | undefined,
    ) =>
      h('div', { class: 'dql-condition__op' }, [
        h(
          'select',
          {
            class: 'dql-select',
            'data-testid': 'op-select',
            value: cond.op ?? '',
            disabled: !fd,
            onChange: (e: Event) =>
              updateOp(path, (e.target as HTMLSelectElement).value),
          },
          [
            h('option', { value: '', disabled: true }, 'op…'),
            ...(fd?.ops ?? []).map((o) =>
              h('option', { value: o.name }, resolveOpLabel(o)),
            ),
          ],
        ),
      ])

    const renderValueCell = (cond: DraftCondition, path: number[]) => {
      const op = opDefOf(cond)
      const renderField = rendererFieldOf(cond)
      const ready =
        renderField && op && op.valueShape !== 'none' && cond.field && cond.op

      let valueNode: VNode | null = null
      if (ready) {
        const renderer =
          resolveRenderer(renderField!.typeId, op!.valueShape, renderField!.delegateTo)
          ?? fallbackRenderer(renderField!.typeId)
        valueNode = h(renderer, {
          fieldKey: cond.field!,
          field: renderField!,
          op: cond.op!,
          value: cond.value,
          onUpdate: (v: unknown) => updateValue(path, v),
        })
      }

      return h(
        'div',
        { class: 'dql-condition__value' },
        valueNode
          ? [valueNode]
          : [
              // Disabled placeholder so the row keeps a stable
              // left-to-right shape until field+op are filled in.
              h('input', {
                type: 'text',
                class: 'dql-condition__value-placeholder',
                disabled: true,
                'aria-hidden': 'true',
                tabindex: -1,
              }),
            ],
      )
    }

    const renderErrIndicator = (errs: ReturnType<typeof errorsAtPath>) => {
      if (errs.length === 0) return null
      const messages = errorMessages(errs)
      return h(
        'span',
        {
          class: 'dql-condition__err',
          'data-testid': 'condition-error',
          'data-error-code': errs[0]!.code,
          role: 'status',
          'aria-label': messages.join('; '),
          // Native title attribute = dependency-free tooltip.
          title: messages.join('\n'),
        },
        [iconNode('!', 'warn')],
      )
    }

    const renderCondition = (cond: DraftCondition, path: number[]): VNode => {
      const errs = errorsAtPath(path)
      const fd = fieldDefOf(cond)
      return h(
        'div',
        {
          class: ['dql-condition', errs.length > 0 ? 'dql-condition--error' : null]
            .filter(Boolean) as string[],
          'data-testid': 'condition',
          'data-has-error': errs.length > 0 ? 'true' : 'false',
        },
        [
          renderFieldSelect(cond, path),
          renderOpSelect(cond, path, fd),
          renderValueCell(cond, path),
          renderErrIndicator(errs),
          h(
            'button',
            {
              type: 'button',
              class: 'dql-condition__remove',
              'data-testid': 'remove-condition',
              'aria-label': 'remove condition',
              title: 'Remove condition',
              onClick: () => removeCondition(path),
            },
            [iconNode('×', 'close')],
          ),
        ],
      )
    }

    const renderConditions = (): VNode =>
      h(
        'div',
        { class: 'dql-group__conditions' },
        props.group.children.map((child: DraftNode, i: number) => {
          const childPath = [...props.path, i]
          if (isGroup(child)) {
            return h(DqlGroupNode, {
              filter: props.filter,
              group: child as DraftGroup,
              path: childPath,
            })
          }
          return renderCondition(child as DraftCondition, childPath)
        }),
      )

    // ---- add row (horizontal buttons, no popover) --------------------
    const renderAddRow = (): VNode => {
      const buttons: VNode[] = [
        h(
          'button',
          {
            type: 'button',
            class: 'dql-add-btn dql-add-btn--primary',
            'data-testid': 'add-condition',
            onClick: addCondition,
          },
          [iconNode('+', 'add'), h('span', 'Add condition')],
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'dql-add-btn',
            'data-testid': 'add-group',
            onClick: addGroup,
          },
          [iconNode('⊕', 'folder'), h('span', 'Add group')],
        ),
      ]
      // "Group current" wraps the existing children behind a fresh
      // empty condition. Hidden when the group is empty (would be a
      // no-op).
      if (props.group.children.length > 0) {
        buttons.push(
          h(
            'button',
            {
              type: 'button',
              class: 'dql-add-btn',
              'data-testid': 'combine-current',
              onClick: combineCurrent,
            },
            [iconNode('⊞', 'group'), h('span', 'Group current')],
          ),
        )
      }

      // Root group hosts the clear button on the right.
      const clearBtn = isRoot.value
        ? h(
            'button',
            {
              type: 'button',
              class: 'dql-clear-btn',
              'data-testid': 'clear-filter',
              disabled: editActiveCount.value === 0,
              onClick: clearAll,
            },
            [iconNode('⌫', 'eraser'), h('span', 'Clear filter')],
          )
        : null

      return h(
        'div',
        {
          class: ['dql-group__add-row', isRoot.value ? 'has-clear' : null]
            .filter(Boolean) as string[],
        },
        [
          h('div', { class: 'dql-add-row__primary' }, buttons),
          clearBtn,
        ].filter(Boolean) as VNode[],
      )
    }

    const renderRemoveCol = (): VNode | null => {
      if (isRoot.value) return null
      return h('div', { class: 'dql-group__remove-col' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'dql-group__remove',
            'data-testid': 'remove-group',
            'aria-label': 'remove group',
            title: 'Remove group',
            onClick: removeGroup,
          },
          [iconNode('×', 'close')],
        ),
      ])
    }

    return () =>
      h(
        'div',
        {
          class: ['dql-group', isRoot.value ? 'is-root' : 'is-nested'],
          'data-testid': isRoot.value ? 'group' : 'group-nested',
          'data-depth': String(props.path.length),
        },
        [
          h(
            'div',
            {
              class: [
                'dql-group__frame',
                showCombinator.value ? 'has-combinator' : null,
              ].filter(Boolean) as string[],
            },
            [
              renderCombinatorCol(),
              renderConditions(),
              renderAddRow(),
            ].filter(Boolean) as VNode[],
          ),
          renderRemoveCol(),
        ].filter(Boolean) as VNode[],
      )
  },
})

// ---------------------------------------------------------------------------
// Public — FilterPanel = root group + dropped notice
// ---------------------------------------------------------------------------

export const FilterPanel = defineComponent({
  name: 'FilterPanel',
  props: {
    filter: { type: Object as PropType<UseFilterReturn>, required: true },
  },
  setup(props) {
    // Expose the active filter to descendant renderers (id autocomplete
    // needs it for search.setQuery / labelOf).
    provide(filterInjectionKey, props.filter)

    const draft = computed(() => props.filter.draft.value)
    const dropped = computed(() => props.filter.dropped.value)

    const renderDropped = (): VNode | null => {
      if (dropped.value.length === 0) return null
      return h(
        'div',
        {
          class: 'dql-dropped-notice',
          'data-testid': 'dropped-notice',
          'data-dropped-count': String(dropped.value.length),
          role: 'alert',
        },
        [
          h(
            'span',
            { class: 'dql-dropped-message' },
            `${dropped.value.length} condition(s) dropped due to schema changes`,
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
    }

    return () =>
      h(
        'div',
        { class: 'dql-filter-panel', 'data-testid': 'filter-panel' },
        [
          renderDropped(),
          h(DqlGroupNode, { filter: props.filter, group: draft.value, path: [] }),
        ].filter(Boolean) as VNode[],
      )
  },
})
