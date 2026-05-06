import { defineComponent, h, type Component, type PropType } from 'vue'

const baseProps = {
  fieldKey: { type: String, required: true as const },
  op: { type: String, required: true as const },
  value: { type: null as unknown as PropType<unknown>, default: undefined },
  onUpdate: {
    type: Function as PropType<(v: unknown) => void>,
    required: true as const,
  },
}

export const StringInput = defineComponent({
  name: 'DqlStringInput',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'text',
        class: 'dql-input dql-input--string',
        value: typeof props.value === 'string' ? props.value : '',
        onInput: (e: Event) => {
          props.onUpdate((e.target as HTMLInputElement).value)
        },
      })
  },
})

export const defaultRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringInput,
})
