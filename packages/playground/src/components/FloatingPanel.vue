<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { dqlKitInjectionKey, type DqlKitState } from '@dql-kit/vue-headless'
import { usePlaygroundStore } from '../store.ts'

const store = usePlaygroundStore()
const dqlKit = inject(dqlKitInjectionKey, null) as DqlKitState | null

const collapsed = ref(false)
const x = ref<number>(window.innerWidth - 320)
const y = ref<number>(80)

let dragOffsetX = 0
let dragOffsetY = 0

const onDragStart = (e: PointerEvent) => {
  if ((e.target as HTMLElement).closest('button, input, select')) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dragOffsetX = e.clientX - rect.left
  dragOffsetY = e.clientY - rect.top
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd, { once: true })
}

const onDragMove = (e: PointerEvent) => {
  x.value = Math.max(8, Math.min(window.innerWidth - 280, e.clientX - dragOffsetX))
  y.value = Math.max(8, Math.min(window.innerHeight - 60, e.clientY - dragOffsetY))
}

const onDragEnd = () => {
  window.removeEventListener('pointermove', onDragMove)
}

const commitOptions = [
  { value: 'auto',   label: 'auto' },
  { value: 'manual', label: 'manual' },
] as const

const localeOptions = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
] as const

const setOpLocale = (locale: 'en' | 'zh') => {
  store.config.value.opLocale = locale
  if (!dqlKit) return
  if (locale === 'zh') {
    dqlKit.setOpLabels({
      eq: '等于', neq: '不等于',
      gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于',
      contains: '包含', notContains: '不包含',
      startsWith: '开头是', endsWith: '结尾是',
      isEmpty: '为空', notEmpty: '非空',
      in: '属于', notIn: '不属于',
      between: '介于', before: '早于', after: '晚于',
      inLast: '最近', containsAll: '全部包含',
    })
    dqlKit.setRelativeUnitLabels({
      minute: '分钟', hour: '小时', day: '天', week: '周', month: '月',
    })
  } else {
    dqlKit.setOpLabels({})
    dqlKit.setRelativeUnitLabels({})
  }
}

const onLocaleChange = (e: Event) => {
  setOpLocale((e.target as HTMLSelectElement).value as 'en' | 'zh')
}

// Apply default locale at mount.
setOpLocale(store.config.value.opLocale)

const filterSummary = computed(() => {
  const f = store.filter.value
  return {
    fields: Object.keys(store.appliedSpec.value.fields).length,
    errors: f.errors.value.length,
    dropped: f.dropped.value.length,
    isDirty: f.isDirty.value,
  }
})
</script>

<template>
  <div
    v-show="store.config.value.showFloatingPanel"
    class="floating-panel"
    :style="{ left: x + 'px', top: y + 'px' }"
  >
    <header class="floating-panel__head" @pointerdown="onDragStart">
      <span class="floating-panel__grip">⋮⋮</span>
      <span class="floating-panel__title">配置</span>
      <button
        type="button"
        class="floating-panel__toggle"
        :title="collapsed ? '展开' : '折叠'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '+' : '−' }}
      </button>
    </header>

    <div v-if="!collapsed" class="floating-panel__body">
      <div class="row">
        <label class="row__label">提交模式</label>
        <select
          v-model="store.config.value.commitMode"
          class="row__control"
        >
          <option
            v-for="o in commitOptions"
            :key="o.value"
            :value="o.value"
          >{{ o.label }}</option>
        </select>
      </div>

      <div class="row">
        <label class="row__label">debounceMs</label>
        <input
          v-model.number="store.config.value.debounceMs"
          type="number"
          min="0"
          step="50"
          class="row__control"
        />
      </div>

      <div class="row">
        <label class="row__label">运算符语言</label>
        <select
          :value="store.config.value.opLocale"
          class="row__control"
          @change="onLocaleChange"
        >
          <option
            v-for="o in localeOptions"
            :key="o.value"
            :value="o.value"
          >{{ o.label }}</option>
        </select>
      </div>

      <div class="summary">
        <header class="summary__head">摘要</header>
        <dl class="summary__grid">
          <dt>字段</dt><dd>{{ filterSummary.fields }}</dd>
          <dt>错误</dt><dd>{{ filterSummary.errors }}</dd>
          <dt>丢弃</dt><dd>{{ filterSummary.dropped }}</dd>
          <dt>dirty</dt><dd>{{ filterSummary.isDirty ? 'yes' : 'no' }}</dd>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.floating-panel {
  position: fixed;
  width: 280px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
  z-index: 1000;
  user-select: none;
  font-size: 12px;
  color: var(--text-strong);
}
.floating-panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: grab;
  border-bottom: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  background: var(--surface-deep);
}
.floating-panel__head:active {
  cursor: grabbing;
}
.floating-panel__grip {
  font-family: var(--font-mono);
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: -1px;
}
.floating-panel__title {
  flex: 1;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-size: 11px;
  color: var(--text-muted);
}
.floating-panel__toggle {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
}
.floating-panel__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
}
.row {
  display: grid;
  grid-template-columns: 88px 1fr;
  align-items: center;
  gap: 8px;
}
.row__label {
  font-size: 11px;
  color: var(--text-muted);
}
.row__control {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text-strong);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.row__control:focus {
  border-color: var(--accent-strong);
}
.summary {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.summary__head {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 4px;
}
.summary__grid {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
}
.summary__grid dt {
  color: var(--text-muted);
  font-size: 11px;
}
.summary__grid dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-strong);
  text-align: right;
}
</style>
