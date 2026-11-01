import { defineFilterSchema, f } from '@dql-kit/core'
import { createLocalPresetStorage, useFilter, usePresets } from '@dql-kit/vue-headless'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { FilterPresets } from '../src/index.ts'

const schema = defineFilterSchema({ fields: { title: f.string() } })

describe('FilterPresets', () => {
  it('saves, applies and deletes presets', async () => {
    const filter = useFilter({
      schema,
      sync: 'none',
      initial: { combinator: 'and', children: [{ field: 'title', op: 'eq', value: 'a' }] },
    })
    const presets = usePresets({ filter, storage: createLocalPresetStorage('k', null) })
    const wrapper = mount(FilterPresets, { props: { presets } })
    await flushPromises()

    expect(wrapper.find('[data-testid="preset-save"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="preset-name"]').setValue('Only a')
    await wrapper.find('[data-testid="preset-save"]').trigger('click')
    await flushPromises()
    const options = wrapper.findAll('[data-testid="preset-select"] option')
    expect(options.map((o) => o.text())).toEqual(['— presets —', 'Only a'])

    filter.applyAst({ combinator: 'and', children: [] })
    await wrapper.find('[data-testid="preset-select"]').setValue(options[1]!.attributes('value'))
    await flushPromises()
    expect(filter.committedValid.value.children).toEqual([{ field: 'title', op: 'eq', value: 'a' }])

    await wrapper.find('[data-testid="preset-delete"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="preset-select"] option')).toHaveLength(1)
    wrapper.unmount()
  })
})
