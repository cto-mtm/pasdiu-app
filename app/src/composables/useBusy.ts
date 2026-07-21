import { ref, type Ref } from 'vue'

/**
 * Busy-flag wrapper for async form submits. `run` flips `busy` around the
 * awaited work and swallows rejections — the data store's guarded() has
 * already toasted the failure — so callers can keep modals open without
 * their own try/catch. Resolves to the fn's value, or undefined on failure.
 */
export function useBusy(): {
  busy: Ref<boolean>
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
} {
  const busy = ref(false)

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    busy.value = true
    try {
      return await fn()
    } catch {
      return undefined
    } finally {
      busy.value = false
    }
  }

  return { busy, run }
}
