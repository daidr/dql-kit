<script setup lang="ts">
import FilterArea from './FilterArea.vue'
import SchemaEditor from './SchemaEditor.vue'
</script>

<template>
  <aside class="left-panel">
    <div class="left-panel__top">
      <FilterArea />
    </div>
    <div class="left-panel__divider" />
    <div class="left-panel__bottom">
      <SchemaEditor />
    </div>
  </aside>
</template>

<style scoped>
.left-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}
.left-panel__top {
  flex: 1 1 50%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.left-panel__bottom {
  flex: 1 1 50%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.left-panel__divider {
  height: 1px;
  background: var(--border);
}
</style>
