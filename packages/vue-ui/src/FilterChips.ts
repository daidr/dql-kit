import type { DescribedNode, ValidAST } from '@dql-kit/core'
import type { UseFilterReturn } from '@dql-kit/vue-headless'
import { computed, defineComponent, h, toRaw, type PropType, type SlotsType, type VNode } from 'vue'

export type FilterChipSlotProps = {
  /** The chip's described node: a root-level condition or nested group. */
  node: DescribedNode
  /** Remove this node from the committed filter. */
  remove: () => void
}

const isLoading = (node: DescribedNode): boolean =>
  node.kind === 'group'
    ? node.children.some(isLoading)
    : node.valueParts.some((p) => p.status === 'loading')

/**
 * Removable summary chips for the committed filter: one chip per
 * root-level condition, and one combined chip per nested group. Removing
 * a chip applies the committed filter without that node (`applyAst`),
 * which also resets the draft to it.
 *
 * The `chip` slot replaces a chip's content: `{ node, remove }`.
 */
export const FilterChips = defineComponent({
  name: 'FilterChips',
  props: {
    filter: {
      type: Object as PropType<UseFilterReturn>,
      required: true,
    },
    /** Accessible label of each chip's remove button. */
    removeLabel: { type: String, default: 'Remove' },
  },
  slots: Object as SlotsType<{ chip: FilterChipSlotProps }>,
  setup(props, { slots }) {
    const described = computed(() => props.filter.describe())

    const removeAt = (index: number) => {
      // Raw: the committed AST may be held in reactive state, and
      // applyAst clones its input.
      const committed = toRaw(props.filter.committedValid.value) as ValidAST
      props.filter.applyAst({
        combinator: committed.combinator,
        children: committed.children.filter((_, i) => i !== index),
      })
    }

    return () => {
      const root = described.value
      const separator = root.combinator === 'and' ? 'AND' : 'OR'
      const items: VNode[] = []
      root.children.forEach((node, i) => {
        if (i > 0) {
          items.push(h('span', { class: 'dql-chip-separator', 'aria-hidden': 'true' }, separator))
        }
        const remove = () => removeAt(i)
        items.push(
          h(
            'span',
            {
              class: ['dql-chip', node.kind === 'group' && 'dql-chip--group', isLoading(node) && 'dql-chip--loading'],
              'data-testid': 'filter-chip',
              title: node.text,
            },
            slots.chip
              ? slots.chip({ node, remove })
              : [
                  h('span', { class: 'dql-chip-text' }, node.text),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'dql-chip-remove',
                      'data-testid': 'filter-chip-remove',
                      'aria-label': `${props.removeLabel}: ${node.text}`,
                      onClick: remove,
                    },
                    '×',
                  ),
                ],
          ),
        )
      })
      return h('div', { class: 'dql-chips', 'data-testid': 'filter-chips' }, items)
    }
  },
})
