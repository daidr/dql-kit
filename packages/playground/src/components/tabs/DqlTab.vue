<script setup lang="ts">
import { ref } from 'vue'

const text = ref<string>('')
</script>

<template>
  <div class="tab-pane">
    <div class="placeholder">
      <header class="placeholder__head">未来：DQL 语言双向转换</header>
      <p class="placeholder__body">
        预留入口。DQL（dql-kit query language）会与 ValidAST 形成可逆映射，
        便于在 URL / API 之外用文本表达过滤条件。
      </p>
      <textarea
        v-model="text"
        class="placeholder__editor"
        placeholder="status = 'published' and views > 100"
        spellcheck="false"
      />
      <p class="placeholder__hint">编辑器仅占位，暂未连接到 AST。</p>
    </div>
  </div>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.placeholder {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.placeholder__head {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.placeholder__body {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}
.placeholder__editor {
  flex: 1 1 auto;
  min-height: 120px;
  resize: none;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--surface-deep);
  color: var(--text-strong);
  outline: none;
}
.placeholder__hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
