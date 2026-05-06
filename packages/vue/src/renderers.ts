import { computed, defineComponent, h, ref, type Component, type PropType } from 'vue'

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

export const StringTokenInput = defineComponent({
  name: 'DqlStringTokenInput',
  props: baseProps,
  setup(props) {
    const tokens = computed<string[]>(() =>
      Array.isArray(props.value)
        ? props.value.filter((x): x is string => typeof x === 'string')
        : [],
    )
    const draft = ref('')

    const commit = (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') return
      props.onUpdate([...tokens.value, trimmed])
      draft.value = ''
    }
    const removeAt = (i: number) => {
      const next = tokens.value.slice()
      next.splice(i, 1)
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--token-list',
          'data-testid': 'token-list',
        },
        [
          ...tokens.value.map((token, i) =>
            h(
              'span',
              {
                key: `${i}-${token}`,
                class: 'dql-token',
                'data-testid': 'token',
              },
              [
                h('span', { class: 'dql-token-text' }, token),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'dql-token-remove',
                    'data-testid': 'token-remove',
                    onClick: () => removeAt(i),
                  },
                  '×',
                ),
              ],
            ),
          ),
          h('input', {
            type: 'text',
            class: 'dql-token-input',
            'data-testid': 'token-input',
            value: draft.value,
            onInput: (e: Event) => {
              draft.value = (e.target as HTMLInputElement).value
            },
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commit(draft.value)
              } else if (
                e.key === 'Backspace'
                && draft.value === ''
                && tokens.value.length > 0
              ) {
                removeAt(tokens.value.length - 1)
              }
            },
            onBlur: () => {
              if (draft.value.trim() !== '') commit(draft.value)
            },
          }),
        ],
      )
  },
})

export const defaultRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringInput,
})

export const defaultListRenderers: Readonly<Record<string, Component>> = Object.freeze({
  string: StringTokenInput,
})
