import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import type { UseFilterReturn, Variant } from './types.ts'

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
  setup(_props, { slots: _slots }) {
    void _props; void _slots
    return () =>
      h('div', { class: 'dql-filter-builder' }, [
        h('p', '[dql-kit/vue] FilterBuilder is scaffolded; implementation pending.'),
      ])
  },
})
