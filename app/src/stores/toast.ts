import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'error' | 'success'
export interface Toast { id: number; message: string; kind: ToastKind }

export const useToastStore = defineStore('toast', () => {
  const items = ref<Toast[]>([])
  let seq = 0

  function push(message: string, kind: ToastKind) {
    const id = ++seq
    items.value.push({ id, message, kind })
    setTimeout(() => dismiss(id), 4000)
  }
  function error(message: string) { push(message, 'error') }
  function success(message: string) { push(message, 'success') }
  function dismiss(id: number) { items.value = items.value.filter((t) => t.id !== id) }

  return { items, error, success, dismiss }
})
