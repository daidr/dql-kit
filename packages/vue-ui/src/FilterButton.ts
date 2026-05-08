import {
  isGroup,
  type DroppedNode,
  type ValidNode,
  type ValidationError,
} from '@dql-kit/core'
import type { UseFilterReturn } from '@dql-kit/vue-headless'
import { computed, defineComponent, h, type PropType, type VNode } from 'vue'

const countConditions = (node: ValidNode): number => {
  if (isGroup(node)) {
    return node.children.reduce(
      (sum: number, c: ValidNode) => sum + countConditions(c),
      0,
    )
  }
  return 1
}

/**
 * Slot scope passed to a custom `<FilterButton>` slot.
 *
 *   <FilterButton :filter="f" @click="open" v-slot="{ count, hasNotices }">
 *     <span class="my-trigger" :class="{ warn: hasNotices }">
 *       筛选 {{ count > 0 ? `· ${count}` : '' }}
 *     </span>
 *   </FilterButton>
 */
export type FilterButtonSlotProps = {
  /** Number of leaf conditions in `filter.valid` (excluding empty groups). */
  count: number
  /** Live validation errors from the analyser. */
  errors: ValidationError[]
  /**
   * Nodes dropped during URL → AST deserialise (pending dismissal).
   * Included so a slot can surface a one-shot warning chip.
   */
  dropped: DroppedNode[]
  /** True when either `errors` or `dropped` is non-empty. */
  hasNotices: boolean
}

/**
 * Stateless button that summarises a filter's current state.
 *
 * - **No popover, no click handling.** The host owns visibility — wire
 *   an `@click` (or whatever event you need) on the component to open a
 *   `<FilterPanel>` in your own popover, dialog, drawer, etc.
 * - **Default render** is a `<button>` showing condition count plus a
 *   warning indicator when there are validation errors or dropped
 *   nodes. All inherited attributes / listeners flow through to the
 *   button (component is single-rooted).
 * - **Slot** receives `{ count, errors, dropped, hasNotices }`. Use it to
 *   replace the markup entirely while still picking up the live counts.
 */
export const FilterButton = defineComponent({
  name: 'FilterButton',
  props: {
    filter: {
      type: Object as PropType<UseFilterReturn>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const count = computed(() => countConditions(props.filter.valid.value))
    const errors = computed(() => props.filter.errors.value)
    const dropped = computed(() => props.filter.dropped.value)
    const hasNotices = computed(
      () => errors.value.length > 0 || dropped.value.length > 0,
    )

    return () => {
      const scope: FilterButtonSlotProps = {
        count: count.value,
        errors: errors.value,
        dropped: dropped.value,
        hasNotices: hasNotices.value,
      }

      if (slots.default) {
        // Slot owns rendering. We still expose data-attrs on the wrapper
        // so test/inspection selectors keep working — but the slot's
        // contents are returned untouched as the rendered tree.
        const slotNodes = slots.default(scope)
        return slotNodes
      }

      const label =
        count.value === 0
          ? 'Filter'
          : `Filter · ${count.value}`

      const noticeNode = hasNotices.value
        ? h(
            'span',
            {
              class: 'dql-filter-button__notice',
              'aria-label': 'filter has notices',
              'data-testid': 'filter-button-notice',
            },
            '!',
          )
        : null

      const labelNode = h(
        'span',
        { class: 'dql-filter-button__label' },
        label,
      )

      return h(
        'button',
        {
          type: 'button',
          class: [
            'dql-filter-button',
            count.value > 0 ? 'dql-filter-button--active' : null,
            hasNotices.value ? 'dql-filter-button--has-notices' : null,
          ].filter(Boolean) as string[],
          'data-testid': 'filter-button',
          'data-condition-count': String(count.value),
          'data-has-notices': hasNotices.value ? 'true' : 'false',
        },
        [noticeNode, labelNode].filter(Boolean) as VNode[],
      )
    }
  },
})
