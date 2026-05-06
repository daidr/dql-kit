import { isGroup, type DraftCondition, type DraftGroup, type DraftNode, type FieldDef, type Label, type ValueShape } from '@dql-kit/core'
import { computed, defineComponent, h, type PropType, type VNode } from 'vue'
import { getFieldRenderer } from './registry.ts'
import { defaultListRenderers, defaultPairRenderers, defaultRenderers } from './renderers.ts'
import type { UseFilterReturn, Variant } from './types.ts'

const resolveLabel = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
}

const resolveRenderer = (typeId: string, shape: ValueShape) => {
  const override = getFieldRenderer(typeId)
  if (override) return override
  if (shape === 'pair') return defaultPairRenderers[typeId]
  if (shape === 'list') return defaultListRenderers[typeId]
  return defaultRenderers[typeId]
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
  setup(props) {
    const schema = computed(() => props.filter.schema.value)
    const draft = computed(() => props.filter.draft.value)

    const fieldOptions = computed(() => {
      const s = schema.value
      if (!s) return [] as Array<{ key: string, def: FieldDef }>
      return Object.entries(s.fields).map(([key, def]) => ({ key, def }))
    })

    const renderCondition = (cond: DraftCondition, path: number[]): VNode => {
      const s = schema.value
      const fieldDef = s && cond.field ? s.fields[cond.field] : undefined
      const ops = fieldDef?.ops ?? []
      const op = fieldDef && cond.op ? fieldDef.ops.find((o) => o.name === cond.op) : undefined
      const renderer = fieldDef && op ? resolveRenderer(fieldDef.typeId, op.valueShape) : undefined

      const fieldSelect = h(
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

      const opSelect = fieldDef
        ? h(
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
        : null

      const valueNode =
        renderer && op && fieldDef && op.valueShape !== 'none' && cond.field && cond.op
          ? h(renderer, {
              fieldKey: cond.field,
              field: fieldDef,
              op: cond.op,
              value: cond.value,
              onUpdate: (v: unknown) =>
                props.filter.actions.updateNode(path, { value: v }),
            })
          : null

      const removeBtn = h(
        'button',
        {
          type: 'button',
          class: 'dql-remove',
          'data-testid': 'remove-condition',
          onClick: () => props.filter.actions.removeNode(path),
        },
        '×',
      )

      return h(
        'div',
        { class: 'dql-condition', 'data-testid': 'condition' },
        [fieldSelect, opSelect, valueNode, removeBtn].filter(Boolean) as VNode[],
      )
    }

    const renderGroup = (group: DraftGroup, path: number[]): VNode => {
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
        { class: 'dql-group', 'data-testid': 'group' },
        [combinatorSelect, ...children, addCondBtn, addGroupBtn],
      )
    }

    return () =>
      h(
        'div',
        {
          class: ['dql-filter-builder', `dql-variant-${props.variant}`],
          'data-testid': 'filter-builder',
        },
        [renderGroup(draft.value, [])],
      )
  },
})
