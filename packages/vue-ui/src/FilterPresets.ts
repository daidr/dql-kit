import type { UsePresetsReturn } from '@dql-kit/vue-headless'
import { computed, defineComponent, h, ref, type PropType } from 'vue'

/**
 * Reference UI for saved presets: a dropdown that applies the chosen
 * preset, a name box with a save button for the committed filter, and
 * a delete button for the selected preset. Pass `usePresets(...)`.
 */
export const FilterPresets = defineComponent({
  name: 'FilterPresets',
  props: {
    presets: {
      type: Object as PropType<UsePresetsReturn>,
      required: true,
    },
    placeholder: { type: String, default: '— presets —' },
    namePlaceholder: { type: String, default: 'Preset name' },
    saveLabel: { type: String, default: 'Save' },
    deleteLabel: { type: String, default: 'Delete' },
  },
  setup(props) {
    const selected = ref('')
    const name = ref('')
    const list = computed(() => props.presets.presets.value)
    const busy = computed(() => props.presets.loading.value)

    const onSelect = async (id: string) => {
      selected.value = id
      if (id !== '') await props.presets.apply(id)
    }
    const onSave = async () => {
      const n = name.value.trim()
      if (n === '') return
      const preset = await props.presets.save(n)
      name.value = ''
      selected.value = preset.id
    }
    const onDelete = async () => {
      if (selected.value === '') return
      await props.presets.remove(selected.value)
      selected.value = ''
    }

    return () =>
      h('div', { class: 'dql-presets', 'data-testid': 'filter-presets' }, [
        h(
          'select',
          {
            class: 'dql-presets-select',
            'data-testid': 'preset-select',
            value: selected.value,
            disabled: busy.value,
            onChange: (e: Event) => void onSelect((e.target as HTMLSelectElement).value),
          },
          [
            h('option', { value: '' }, props.placeholder),
            ...list.value.map((p) => h('option', { value: p.id }, p.name)),
          ],
        ),
        h('button', {
          type: 'button',
          class: 'dql-presets-delete',
          'data-testid': 'preset-delete',
          disabled: busy.value || selected.value === '',
          onClick: () => void onDelete(),
        }, props.deleteLabel),
        h('input', {
          type: 'text',
          class: 'dql-presets-name',
          'data-testid': 'preset-name',
          placeholder: props.namePlaceholder,
          value: name.value,
          onInput: (e: Event) => { name.value = (e.target as HTMLInputElement).value },
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') void onSave() },
        }),
        h('button', {
          type: 'button',
          class: 'dql-presets-save',
          'data-testid': 'preset-save',
          disabled: busy.value || name.value.trim() === '',
          onClick: () => void onSave(),
        }, props.saveLabel),
      ])
  },
})
