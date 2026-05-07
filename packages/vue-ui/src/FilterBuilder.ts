import {
  isGroup,
  type DraftCondition,
  type DraftGroup,
  type DraftNode,
  type FieldDef,
  type Label,
  type OpDef,
  type ValidNode,
  type ValueShape,
} from '@dql-kit/core'
import {
  filterInjectionKey,
  getFieldRenderer,
  type UseFilterReturn,
} from '@dql-kit/vue-headless'
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type PropType,
  type VNode,
} from 'vue'
import {
  StringInput,
  defaultListRenderers,
  defaultPairRenderers,
  defaultRelativeRenderers,
  defaultRenderers,
} from './renderers.ts'
import type { Variant } from './types.ts'

const resolveLabel = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
}

const resolveRenderer = (typeId: string, shape: ValueShape) => {
  const override = getFieldRenderer(typeId)
  if (override) return override
  if (shape === 'pair') return defaultPairRenderers[typeId]
  if (shape === 'list') return defaultListRenderers[typeId]
  if (shape === 'relative') return defaultRelativeRenderers[typeId]
  return defaultRenderers[typeId]
}

// In production builds (NODE_ENV === 'production') we suppress the
// warning to keep consumer logs quiet; everywhere else we surface it
// once per typeId so a missing renderer registration is loud during
// development.
const isProductionMode = (): boolean => {
  try {
    return (
      typeof process !== 'undefined'
      && (process as { env?: { NODE_ENV?: string } }).env?.NODE_ENV === 'production'
    )
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
        + `Falling back to StringInput. Register one via registerFieldRenderer("${typeId}", YourComponent).`,
    )
  }
  return StringInput
}

const countConditions = (node: ValidNode): number => {
  if ('combinator' in node) {
    return node.children.reduce((sum, c) => sum + countConditions(c), 0)
  }
  return 1
}

export const FilterBuilder = defineComponent({
  name: 'FilterBuilder',
  props: {
    filter: {
      type: Object as PropType<UseFilterReturn>,
      required: true,
    },
    variant: {
      type: String as PropType<Variant>,
      default: 'vertical-stack',
    },
  },
  setup(props, { slots }) {
    // Expose the active filter to descendant renderers (used by id
    // autocomplete to drive search.setQuery and read labelOf).
    provide(filterInjectionKey, props.filter)

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

    const renderDefaultField = (cond: DraftCondition, path: number[]): VNode =>
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

    const renderDefaultOperator = (
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
          ...ops.map((o) =>
            h('option', { value: o.name }, resolveLabel(o.label, o.name)),
          ),
        ],
      )
    }

    const renderDefaultValue = (
      cond: DraftCondition,
      path: number[],
      rendererField: FieldDef | undefined,
      op: OpDef | undefined,
    ): VNode | null => {
      if (!rendererField || !op) return null
      if (op.valueShape === 'none') return null
      if (!cond.field || !cond.op) return null
      const renderer =
        resolveRenderer(rendererField.typeId, op.valueShape)
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
      const rendererField =
        fieldDef && fieldDef.typeId === 'array' && fieldDef.itemType
          ? fieldDef.itemType
          : fieldDef

      // Slot scopes — exposed on each row so consumers can replace
      // sub-pieces (#operator, #value) or the whole row (#condition).
      // Each scope carries setX helpers so the slot doesn't need to
      // import the actions surface separately.
      const setField = (key: string) =>
        props.filter.actions.updateNode(path, { field: key })
      const setOp = (opName: string) =>
        props.filter.actions.updateNode(path, { op: opName })
      const setValue = (v: unknown) =>
        props.filter.actions.updateNode(path, { value: v })
      const remove = () => props.filter.actions.removeNode(path)

      const operatorNode = slots.operator
        ? slots.operator({
            path,
            condition: cond,
            field: fieldDef,
            ops,
            op,
            setOp,
            defaultRender: () => renderDefaultOperator(cond, path, fieldDef, ops),
          })
        : renderDefaultOperator(cond, path, fieldDef, ops)

      const valueNode = slots.value
        ? slots.value({
            path,
            condition: cond,
            field: rendererField,
            op,
            value: cond.value,
            setValue,
            defaultRender: () => renderDefaultValue(cond, path, rendererField, op),
          })
        : renderDefaultValue(cond, path, rendererField, op)

      const errs = errorsAtPath(path)

      // #condition slot: replace the entire row. defaultRender below
      // keeps the standard layout so consumers can render some custom
      // wrapper around the default content.
      if (slots.condition) {
        return h(
          'div',
          {
            class: ['dql-condition', errs.length > 0 ? 'dql-condition--error' : null].filter(
              Boolean,
            ) as string[],
            'data-testid': 'condition',
            'data-has-error': errs.length > 0 ? 'true' : 'false',
          },
          slots.condition({
            path,
            condition: cond,
            field: fieldDef,
            fieldOptions: fieldOptions.value,
            op,
            errors: errs,
            setField,
            setOp,
            setValue,
            remove,
            defaultField: () => renderDefaultField(cond, path),
            defaultOperator: () => renderDefaultOperator(cond, path, fieldDef, ops),
            defaultValue: () => renderDefaultValue(cond, path, rendererField, op),
          }),
        )
      }

      const fieldSelect = renderDefaultField(cond, path)

      const removeBtn = h(
        'button',
        {
          type: 'button',
          class: 'dql-remove',
          'data-testid': 'remove-condition',
          onClick: remove,
        },
        '×',
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
              },
              '!',
            )
          : null

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
        [fieldSelect, operatorNode, valueNode, errorIndicator, removeBtn].filter(
          Boolean,
        ) as VNode[],
      )
    }

    const renderGroup = (group: DraftGroup, path: number[]): VNode => {
      const isRoot = path.length === 0
      const depth = path.length

      const combinatorSelect = h(
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
      )

      const removeGroupBtn = isRoot
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'dql-remove dql-remove-group',
              'data-testid': 'remove-group',
              onClick: () => props.filter.actions.removeNode(path),
            },
            '×',
          )

      const header = h(
        'div',
        { class: 'dql-group-header' },
        [combinatorSelect, removeGroupBtn].filter(Boolean) as VNode[],
      )

      const children = group.children.map((child: DraftNode, i: number) => {
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
        [header, ...children, addCondBtn, addGroupBtn],
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

    // Popover-trigger variant state: open flag + DOM refs for outside-
    // click detection. Listeners are attached on mount and torn down
    // before unmount (SSR-safe — both hooks are client-only).
    const popoverOpen = ref(false)
    const triggerEl = ref<HTMLElement | null>(null)
    const panelEl = ref<HTMLElement | null>(null)

    const onDocMousedown = (e: MouseEvent) => {
      if (!popoverOpen.value) return
      const target = e.target as Node | null
      if (!target) return
      if (panelEl.value && panelEl.value.contains(target)) return
      if (triggerEl.value && triggerEl.value.contains(target)) return
      popoverOpen.value = false
    }
    const onDocKeydown = (e: KeyboardEvent) => {
      if (popoverOpen.value && e.key === 'Escape') {
        popoverOpen.value = false
      }
    }

    onMounted(() => {
      if (typeof document === 'undefined') return
      document.addEventListener('mousedown', onDocMousedown)
      document.addEventListener('keydown', onDocKeydown)
    })
    onBeforeUnmount(() => {
      if (typeof document === 'undefined') return
      document.removeEventListener('mousedown', onDocMousedown)
      document.removeEventListener('keydown', onDocKeydown)
    })

    const triggerLabel = computed(() => {
      const count = countConditions(props.filter.valid.value)
      if (count === 0) return 'Filter'
      return `${count} filter${count === 1 ? '' : 's'}`
    })

    return () => {
      const droppedNotice = renderDroppedNotice()
      const builder = renderGroup(draft.value, [])

      if (props.variant === 'popover-trigger') {
        const trigger = h(
          'button',
          {
            type: 'button',
            class: 'dql-popover-trigger',
            'data-testid': 'popover-trigger',
            'data-open': popoverOpen.value ? 'true' : 'false',
            'data-condition-count': String(countConditions(props.filter.valid.value)),
            'aria-expanded': popoverOpen.value ? 'true' : 'false',
            onClick: () => {
              popoverOpen.value = !popoverOpen.value
            },
            ref: (el) => {
              triggerEl.value = el as HTMLElement | null
            },
          },
          triggerLabel.value,
        )

        const panel = popoverOpen.value
          ? h(
              'div',
              {
                class: 'dql-popover-panel',
                'data-testid': 'popover-panel',
                role: 'dialog',
                ref: (el) => {
                  panelEl.value = el as HTMLElement | null
                },
              },
              [droppedNotice, builder].filter(Boolean) as VNode[],
            )
          : null

        return h(
          'div',
          {
            class: ['dql-filter-builder', 'dql-variant-popover-trigger'],
            'data-testid': 'filter-builder',
            'data-variant': 'popover-trigger',
          },
          [trigger, panel].filter(Boolean) as VNode[],
        )
      }

      // vertical-stack (default)
      return h(
        'div',
        {
          class: ['dql-filter-builder', 'dql-variant-vertical-stack'],
          'data-testid': 'filter-builder',
          'data-variant': 'vertical-stack',
        },
        [droppedNotice, builder].filter(Boolean) as VNode[],
      )
    }
  },
})

