<script setup lang="ts">
import FloatingPanel from './components/FloatingPanel.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import {
  createPlaygroundStore,
  providePlaygroundStore,
} from './store.ts'

const store = createPlaygroundStore()
providePlaygroundStore(store)
</script>

<template>
  <div class="app">
    <header class="app__head">
      <div class="app__brand">
        <span class="app__brand-mark">dql-kit</span>
        <span class="app__brand-tag">playground</span>
      </div>
      <div class="app__head-actions">
        <label class="toggle">
          <input
            type="checkbox"
            v-model="store.config.value.showFloatingPanel"
          />
          <span>显示配置面板</span>
        </label>
      </div>
    </header>

    <main class="app__body">
      <LeftPanel />
      <RightPanel />
    </main>

    <FloatingPanel />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
  color: var(--text-strong);
}
.app__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.app__brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.app__brand-mark {
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: 0.5px;
  font-size: 14px;
  color: var(--text-strong);
}
.app__brand-tag {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 1px;
  text-transform: uppercase;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.app__body {
  display: grid;
  grid-template-columns: minmax(480px, 3fr) minmax(360px, 2fr);
  flex: 1 1 auto;
  min-height: 0;
}
@media (min-width: 1280px) {
  .app__body {
    grid-template-columns: 720px 1fr;
  }
}
@media (min-width: 1600px) {
  .app__body {
    grid-template-columns: 820px 1fr;
  }
}
</style>
