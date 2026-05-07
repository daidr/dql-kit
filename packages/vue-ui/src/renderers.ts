import {
  RELATIVE_UNITS,
  type FieldDef,
  type Label,
  type RelativeUnit,
  type ValueShape,
} from '@dql-kit/core'
import {
  filterInjectionKey,
  type LabelStatus,
  type RendererSet,
} from '@dql-kit/vue-headless'
import { computed, defineComponent, h, inject, ref, watch, type Component, type PropType } from 'vue'
import { resolveRelativeUnitLabel } from './i18n.ts'

// `value` accepts any JSON-shaped condition value — string, number,
// arrays, { amount, unit } objects for relative datetimes, etc. Using
// `default: undefined` here would let TS narrow `props.value` to
// `undefined`; we leave the prop validator without a default so the
// type stays `unknown | undefined`.
const baseProps = {
  fieldKey: { type: String, required: true as const },
  field: { type: Object as PropType<FieldDef>, required: true as const },
  op: { type: String, required: true as const },
  value: { type: null as unknown as PropType<unknown>, required: false as const },
  onUpdate: {
    type: Function as PropType<(v: unknown) => void>,
    required: true as const,
  },
}

const labelText = (label: Label | undefined, fallback: string): string => {
  if (label === undefined) return fallback
  return typeof label === 'function' ? label() : label
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

export const NumberInput = defineComponent({
  name: 'DqlNumberInput',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'number',
        class: 'dql-input dql-input--number',
        value: typeof props.value === 'number' ? props.value : '',
        onInput: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value
          if (raw === '') {
            props.onUpdate(undefined)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n)) props.onUpdate(n)
        },
      })
  },
})

// `between` is a pair shape: two independent number inputs, NOT a single
// range slider (per slice #5 acceptance and DESIGN.md Q7).
export const NumberPairInput = defineComponent({
  name: 'DqlNumberPairInput',
  props: baseProps,
  setup(props) {
    const pair = computed<[number | null, number | null]>(() => {
      if (Array.isArray(props.value) && props.value.length === 2) {
        const [a, b] = props.value
        return [
          typeof a === 'number' && Number.isFinite(a) ? a : null,
          typeof b === 'number' && Number.isFinite(b) ? b : null,
        ]
      }
      return [null, null]
    })

    const update = (idx: 0 | 1, raw: string) => {
      const next: [number | null, number | null] = [pair.value[0], pair.value[1]]
      if (raw === '') {
        next[idx] = null
      } else {
        const n = Number(raw)
        if (!Number.isFinite(n)) return
        next[idx] = n
      }
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--number-pair' },
        [
          h('input', {
            type: 'number',
            'data-testid': 'pair-min',
            class: 'dql-pair-min',
            value: pair.value[0] ?? '',
            onInput: (e: Event) => update(0, (e.target as HTMLInputElement).value),
          }),
          h('span', { class: 'dql-pair-separator' }, '–'),
          h('input', {
            type: 'number',
            'data-testid': 'pair-max',
            class: 'dql-pair-max',
            value: pair.value[1] ?? '',
            onInput: (e: Event) => update(1, (e.target as HTMLInputElement).value),
          }),
        ],
      )
  },
})

export const NumberTokenInput = defineComponent({
  name: 'DqlNumberTokenInput',
  props: baseProps,
  setup(props) {
    const tokens = computed<number[]>(() =>
      Array.isArray(props.value)
        ? props.value.filter(
            (x): x is number => typeof x === 'number' && Number.isFinite(x),
          )
        : [],
    )
    const draft = ref('')

    const commit = (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') return
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return
      props.onUpdate([...tokens.value, n])
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
          class: 'dql-input dql-input--number-token-list',
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
                h('span', { class: 'dql-token-text' }, String(token)),
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
            type: 'number',
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

export const BooleanSwitch = defineComponent({
  name: 'DqlBooleanSwitch',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'checkbox',
        role: 'switch',
        class: 'dql-input dql-input--boolean',
        'data-testid': 'boolean-switch',
        checked: props.value === true,
        onChange: (e: Event) => {
          props.onUpdate((e.target as HTMLInputElement).checked)
        },
      })
  },
})

export const EnumSelect = defineComponent({
  name: 'DqlEnumSelect',
  props: baseProps,
  setup(props) {
    const options = computed(() => props.field.enumValues ?? [])
    return () =>
      h(
        'select',
        {
          class: 'dql-input dql-input--enum-single',
          'data-testid': 'enum-select',
          value:
            props.value === undefined || props.value === null
              ? ''
              : String(props.value),
          onChange: (e: Event) => {
            const raw = (e.target as HTMLSelectElement).value
            if (raw === '') {
              props.onUpdate(undefined)
              return
            }
            const match = options.value.find((o) => String(o.value) === raw)
            if (match) props.onUpdate(match.value)
          },
        },
        [
          h('option', { value: '' }, '— select —'),
          ...options.value.map((o) =>
            h(
              'option',
              {
                value: String(o.value),
                'data-testid': `enum-option-${String(o.value)}`,
              },
              labelText(o.label, String(o.value)),
            ),
          ),
        ],
      )
  },
})

export const EnumMultiSelect = defineComponent({
  name: 'DqlEnumMultiSelect',
  props: baseProps,
  setup(props) {
    const options = computed(() => props.field.enumValues ?? [])
    const selected = computed<unknown[]>(() =>
      Array.isArray(props.value) ? props.value.slice() : [],
    )
    const isSelected = (v: unknown) => selected.value.some((x) => x === v)
    const toggle = (val: unknown) => {
      const cur = selected.value
      const idx = cur.findIndex((x) => x === val)
      const next =
        idx >= 0 ? [...cur.slice(0, idx), ...cur.slice(idx + 1)] : [...cur, val]
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--enum-multi',
          'data-testid': 'enum-multi',
        },
        options.value.map((o) =>
          h(
            'label',
            {
              class: 'dql-enum-option',
              'data-testid': `enum-multi-option-${String(o.value)}`,
            },
            [
              h('input', {
                type: 'checkbox',
                class: 'dql-enum-checkbox',
                checked: isSelected(o.value),
                onChange: () => toggle(o.value),
              }),
              h('span', { class: 'dql-enum-label' }, labelText(o.label, String(o.value))),
            ],
          ),
        ),
      )
  },
})

export const DateInput = defineComponent({
  name: 'DqlDateInput',
  props: baseProps,
  setup(props) {
    return () =>
      h('input', {
        type: 'date',
        class: 'dql-input dql-input--date',
        'data-testid': 'date-input',
        value: typeof props.value === 'string' ? props.value : '',
        onInput: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value
          props.onUpdate(raw === '' ? undefined : raw)
        },
      })
  },
})

export const DateRangeInput = defineComponent({
  name: 'DqlDateRangeInput',
  props: baseProps,
  setup(props) {
    const pair = computed<[string | null, string | null]>(() => {
      if (Array.isArray(props.value) && props.value.length === 2) {
        const [a, b] = props.value
        return [
          typeof a === 'string' ? a : null,
          typeof b === 'string' ? b : null,
        ]
      }
      return [null, null]
    })

    const update = (idx: 0 | 1, raw: string) => {
      const next: [string | null, string | null] = [pair.value[0], pair.value[1]]
      next[idx] = raw === '' ? null : raw
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--date-range' },
        [
          h('input', {
            type: 'date',
            'data-testid': 'date-pair-min',
            class: 'dql-pair-min',
            value: pair.value[0] ?? '',
            onInput: (e: Event) => update(0, (e.target as HTMLInputElement).value),
          }),
          h('span', { class: 'dql-pair-separator' }, '–'),
          h('input', {
            type: 'date',
            'data-testid': 'date-pair-max',
            class: 'dql-pair-max',
            value: pair.value[1] ?? '',
            onInput: (e: Event) => update(1, (e.target as HTMLInputElement).value),
          }),
        ],
      )
  },
})

// `<input type="datetime-local">` round-trip: the browser exposes / accepts a
// `YYYY-MM-DDTHH:mm` string interpreted in the user's local timezone, while
// the AST stores an ISO-8601 instant (UTC). We convert between the two on
// read / write so users always see local times but the wire format stays a
// timezone-stable instant.
const isoToLocal = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const localToIso = (local: string): string | undefined => {
  if (local === '') return undefined
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

export const DateTimeInput = defineComponent({
  name: 'DqlDateTimeInput',
  props: baseProps,
  setup(props) {
    const localValue = computed(() =>
      typeof props.value === 'string' ? isoToLocal(props.value) : '',
    )
    return () =>
      h('input', {
        type: 'datetime-local',
        class: 'dql-input dql-input--datetime',
        'data-testid': 'datetime-input',
        value: localValue.value,
        onInput: (e: Event) => {
          props.onUpdate(localToIso((e.target as HTMLInputElement).value))
        },
      })
  },
})

export const DateTimeRangeInput = defineComponent({
  name: 'DqlDateTimeRangeInput',
  props: baseProps,
  setup(props) {
    const pair = computed<[string | null, string | null]>(() => {
      if (Array.isArray(props.value) && props.value.length === 2) {
        const [a, b] = props.value
        return [
          typeof a === 'string' ? a : null,
          typeof b === 'string' ? b : null,
        ]
      }
      return [null, null]
    })

    const update = (idx: 0 | 1, raw: string) => {
      const next: [string | null, string | null] = [pair.value[0], pair.value[1]]
      next[idx] = raw === '' ? null : (localToIso(raw) ?? null)
      props.onUpdate(next)
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--datetime-range' },
        [
          h('input', {
            type: 'datetime-local',
            'data-testid': 'datetime-pair-min',
            class: 'dql-pair-min',
            value: pair.value[0] ? isoToLocal(pair.value[0]) : '',
            onInput: (e: Event) => update(0, (e.target as HTMLInputElement).value),
          }),
          h('span', { class: 'dql-pair-separator' }, '–'),
          h('input', {
            type: 'datetime-local',
            'data-testid': 'datetime-pair-max',
            class: 'dql-pair-max',
            value: pair.value[1] ? isoToLocal(pair.value[1]) : '',
            onInput: (e: Event) => update(1, (e.target as HTMLInputElement).value),
          }),
        ],
      )
  },
})

export const DateTimeInLastInput = defineComponent({
  name: 'DqlDateTimeInLastInput',
  props: baseProps,
  setup(props) {
    // Local unit selection — independent of props.value so the user's
    // unit pick survives even before they've typed an amount. Without
    // this, picking "week" before entering a number was silently lost
    // (updateUnit could not emit because amount was null), and the
    // first amount keystroke fell back to the default 'day'.
    const localUnit = ref<RelativeUnit>('day')

    // Sync localUnit from props.value whenever the bound condition is a
    // valid relative-time object — covers initial mount, AST replay,
    // op-swap-preserving-shape, etc.
    watch(
      () => props.value,
      (v) => {
        if (
          v != null
          && typeof v === 'object'
          && typeof (v as Record<string, unknown>).unit === 'string'
        ) {
          const u = (v as { unit: string }).unit
          if ((RELATIVE_UNITS as readonly string[]).includes(u)) {
            localUnit.value = u as RelativeUnit
          }
        }
      },
      { immediate: true },
    )

    const amount = computed<number | null>(() => {
      const v = props.value
      if (v != null && typeof v === 'object') {
        const a = (v as Record<string, unknown>).amount
        return typeof a === 'number' && Number.isFinite(a) ? a : null
      }
      return null
    })

    const updateAmount = (raw: string) => {
      if (raw === '') {
        props.onUpdate(undefined)
        return
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) return
      props.onUpdate({ amount: n, unit: localUnit.value })
    }

    const updateUnit = (unit: string) => {
      if (!(RELATIVE_UNITS as readonly string[]).includes(unit)) return
      localUnit.value = unit as RelativeUnit
      const a = amount.value
      // Only emit when amount is also valid; otherwise the partial
      // {amount: null, unit} would fail prune's relative-shape check.
      // The local ref keeps the unit selection so the first valid
      // amount keystroke uses it.
      if (a !== null) props.onUpdate({ amount: a, unit })
    }

    return () =>
      h(
        'div',
        { class: 'dql-input dql-input--in-last' },
        [
          h('input', {
            type: 'number',
            min: '1',
            class: 'dql-inlast-amount',
            'data-testid': 'inlast-amount',
            value: amount.value === null ? '' : amount.value,
            onInput: (e: Event) => updateAmount((e.target as HTMLInputElement).value),
          }),
          h(
            'select',
            {
              class: 'dql-inlast-unit',
              'data-testid': 'inlast-unit',
              value: localUnit.value,
              onChange: (e: Event) => updateUnit((e.target as HTMLSelectElement).value),
            },
            RELATIVE_UNITS.map((u) =>
              h('option', { value: u, 'data-testid': `inlast-unit-${u}` }, resolveRelativeUnitLabel(u)),
            ),
          ),
        ],
      )
  },
})

// Render the user-facing label text for an id, falling back through the
// LabelStatus state machine: pending → '…', resolved → label, error → '#<id>'.
const idDisplayText = (status: LabelStatus): string => {
  if (status.status === 'resolved') return status.label
  if (status.status === 'pending') return '…'
  return `#${(status as { id: string | number }).id}`
}

export const IdAutocompleteInput = defineComponent({
  name: 'DqlIdAutocompleteInput',
  props: baseProps,
  setup(props) {
    const filter = inject(filterInjectionKey, null)
    if (!filter) {
      // Graceful degradation outside FilterBuilder context: a plain text
      // box that accepts ids verbatim. Useful for test harnesses that
      // mount renderers directly.
      return () =>
        h('input', {
          type: 'text',
          class: 'dql-input dql-input--id-fallback',
          value: props.value === undefined || props.value === null ? '' : String(props.value),
          onInput: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value
            props.onUpdate(raw === '' ? undefined : raw)
          },
        })
    }

    const open = ref(false)

    const selectedLabel = computed(() => {
      const id = props.value
      if (typeof id !== 'string' && typeof id !== 'number') return null
      return idDisplayText(filter.labelOf(props.fieldKey, id))
    })

    const isOwnSlot = computed(
      () => filter.search.value.fieldKey === props.fieldKey,
    )

    const driveQuery = (q: string) => {
      filter.search.value.setQuery(props.fieldKey, q)
    }

    const select = (id: string | number) => {
      props.onUpdate(id)
      open.value = false
      driveQuery('')
    }

    const clear = () => {
      props.onUpdate(undefined)
      driveQuery('')
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--id',
          'data-testid': 'id-autocomplete',
          // Close the suggestion list when focus leaves the wrapper. mousedown
          // on results already preventDefaults so option clicks don't blur
          // the search input — focusout only fires when the user truly tabs
          // / clicks away.
          onFocusout: (e: FocusEvent) => {
            const next = e.relatedTarget as Node | null
            const wrapper = e.currentTarget as Element | null
            if (next && wrapper && wrapper.contains(next)) return
            open.value = false
          },
        },
        [
          props.value !== undefined
            ? h(
                'span',
                { class: 'dql-id-chip', 'data-testid': 'id-chip' },
                [
                  h('span', { class: 'dql-id-chip-label' }, selectedLabel.value ?? ''),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'dql-id-chip-clear',
                      'data-testid': 'id-clear',
                      onClick: clear,
                    },
                    '×',
                  ),
                ],
              )
            : h('input', {
                type: 'text',
                class: 'dql-id-search',
                'data-testid': 'id-search-input',
                value: isOwnSlot.value ? filter.search.value.query : '',
                onInput: (e: Event) => {
                  driveQuery((e.target as HTMLInputElement).value)
                  open.value = true
                },
                onFocus: () => {
                  open.value = true
                },
              }),
          open.value && isOwnSlot.value && filter.search.value.results.length > 0
            ? h(
                'ul',
                { class: 'dql-id-results', 'data-testid': 'id-results' },
                filter.search.value.results.map((item) =>
                  h(
                    'li',
                    {
                      key: String(item.id),
                      class: 'dql-id-result',
                      'data-testid': `id-result-${String(item.id)}`,
                      // mousedown fires before the input's blur, so the
                      // select handler runs even if we wire blur → close.
                      onMousedown: (e: Event) => {
                        e.preventDefault()
                        select(item.id)
                      },
                    },
                    item.label,
                  ),
                ),
              )
            : null,
        ],
      )
  },
})

export const IdMultiAutocompleteInput = defineComponent({
  name: 'DqlIdMultiAutocompleteInput',
  props: baseProps,
  setup(props) {
    const filter = inject(filterInjectionKey, null)
    if (!filter) {
      return () =>
        h('div', { class: 'dql-input dql-input--id-multi-fallback' }, [
          h('em', 'IdMultiAutocompleteInput requires FilterBuilder context'),
        ])
    }

    const open = ref(false)

    const selected = computed<(string | number)[]>(() =>
      Array.isArray(props.value)
        ? (props.value.filter(
            (x) => typeof x === 'string' || typeof x === 'number',
          ) as (string | number)[])
        : [],
    )

    const isOwnSlot = computed(
      () => filter.search.value.fieldKey === props.fieldKey,
    )

    const driveQuery = (q: string) => {
      filter.search.value.setQuery(props.fieldKey, q)
    }

    const removeId = (id: string | number) => {
      props.onUpdate(selected.value.filter((x) => x !== id))
    }

    const addId = (id: string | number) => {
      if (selected.value.includes(id)) return
      props.onUpdate([...selected.value, id])
      driveQuery('')
    }

    return () =>
      h(
        'div',
        {
          class: 'dql-input dql-input--id-multi',
          'data-testid': 'id-multi-autocomplete',
          // Symmetric with IdAutocompleteInput: close the suggestion list
          // when focus genuinely leaves the wrapper. mousedown.preventDefault
          // on each <li> keeps the input focused while clicking options.
          onFocusout: (e: FocusEvent) => {
            const next = e.relatedTarget as Node | null
            const wrapper = e.currentTarget as Element | null
            if (next && wrapper && wrapper.contains(next)) return
            open.value = false
          },
        },
        [
          ...selected.value.map((id) =>
            h(
              'span',
              {
                key: String(id),
                class: 'dql-id-chip',
                'data-testid': `id-chip-${String(id)}`,
              },
              [
                h(
                  'span',
                  { class: 'dql-id-chip-label' },
                  idDisplayText(filter.labelOf(props.fieldKey, id)),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'dql-id-chip-clear',
                    'data-testid': `id-chip-remove-${String(id)}`,
                    onClick: () => removeId(id),
                  },
                  '×',
                ),
              ],
            ),
          ),
          h('input', {
            type: 'text',
            class: 'dql-id-search',
            'data-testid': 'id-search-input',
            value: isOwnSlot.value ? filter.search.value.query : '',
            onInput: (e: Event) => {
              driveQuery((e.target as HTMLInputElement).value)
              open.value = true
            },
            onFocus: () => {
              open.value = true
            },
          }),
          open.value && isOwnSlot.value && filter.search.value.results.length > 0
            ? h(
                'ul',
                { class: 'dql-id-results', 'data-testid': 'id-results' },
                filter.search.value.results
                  .filter((item) => !selected.value.includes(item.id))
                  .map((item) =>
                    h(
                      'li',
                      {
                        key: String(item.id),
                        class: 'dql-id-result',
                        'data-testid': `id-result-${String(item.id)}`,
                        onMousedown: (e: Event) => {
                          e.preventDefault()
                          addId(item.id)
                        },
                      },
                      item.label,
                    ),
                  ),
              )
            : null,
        ],
      )
  },
})

/**
 * Built-in renderer catalog. One `RendererSet` per builtin typeId,
 * keyed by `default` plus per-shape overrides where the shape needs
 * a different control (number/between is two inputs, datetime/inLast
 * is amount+unit, string/in is a token list, ...).
 *
 * `resolveRenderer(typeId, shape, instance)` consults user-registered
 * sets first (instance.renderers / fallback registry), and falls
 * through to this catalog. To override one shape of a builtin, register
 * a partial RendererSet — unspecified shapes still use this catalog.
 */
export const builtinRenderers: Readonly<Record<string, RendererSet>> = Object.freeze({
  string:   { default: StringInput, list: StringTokenInput },
  number:   { default: NumberInput, pair: NumberPairInput, list: NumberTokenInput },
  boolean:  { default: BooleanSwitch },
  enum:     { default: EnumSelect, list: EnumMultiSelect },
  date:     { default: DateInput, pair: DateRangeInput },
  datetime: { default: DateTimeInput, pair: DateTimeRangeInput, relative: DateTimeInLastInput },
  id:       { default: IdAutocompleteInput, list: IdMultiAutocompleteInput },
})

const isComponent = (v: RendererSet | undefined): v is Component =>
  v != null
  && typeof v === 'object'
  && (typeof (v as { setup?: unknown }).setup === 'function'
    || typeof (v as { render?: unknown }).render === 'function'
    // function-form components (() => VNode) — we don't expect these
    // but accept for completeness.
    || typeof v === 'function')

/**
 * Resolve `(typeId, shape) → Component`.
 *
 *   1. Look up user-registered set for `typeId` on the active
 *      `DqlKitState` (passed in by FilterBuilder / consumer).
 *   2. If found, pick shape-specific entry, else `default`.
 *   3. Otherwise fall through to `builtinRenderers[typeId]` with the
 *      same shape→default lookup.
 *   4. If the field has `delegateTo`, recurse on the delegated typeId —
 *      `f.custom({ typeId: 'fulltext', delegateTo: 'string' })`
 *      automatically gets string renderers without needing to
 *      register anything.
 */
export const resolveRenderer = (
  typeId: string,
  shape: ValueShape,
  options: {
    /**
     * Optional renderer overrides keyed by typeId. Pass
     * `dqlKit.renderers` (a Map) when calling from inside a
     * component that has the plugin installed.
     */
    overrides?: Map<string, RendererSet> | null
    delegateTo?: string
  } = {},
): Component | undefined => {
  const { overrides, delegateTo } = options
  type ShapeMap = { default?: Component, pair?: Component, list?: Component, relative?: Component }
  const pickFromSet = (set: RendererSet | undefined): Component | undefined => {
    if (!set) return undefined
    if (isComponent(set)) return set
    const map = set as ShapeMap
    return map[shape as keyof ShapeMap] ?? map.default
  }

  // 1) overrides → 2) builtin → 3) delegateTo recursion
  const overrideSet = overrides?.get(typeId)
  if (overrideSet) {
    const r = pickFromSet(overrideSet)
    if (r) return r
  }
  const builtin = pickFromSet(builtinRenderers[typeId])
  if (builtin) return builtin

  if (delegateTo && delegateTo !== typeId) {
    return resolveRenderer(delegateTo, shape, { overrides })
  }
  return undefined
}
