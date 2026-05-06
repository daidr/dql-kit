import type { Component } from 'vue'
import type { FieldRendererRegistry } from './types.ts'

const registry: FieldRendererRegistry = new Map()

export const registerFieldRenderer = (typeId: string, component: Component): void => {
  registry.set(typeId, component)
}

export const getFieldRenderer = (typeId: string): Component | undefined =>
  registry.get(typeId)

export const fieldRendererRegistry = registry
