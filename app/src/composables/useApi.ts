import { ref, shallowRef } from 'vue'
import { apiFetch, type ApiError } from '../lib/api'

/**
 * Reactive wrapper around apiFetch: exposes loading/error/data refs plus an
 * `execute()` that runs the request. `error` is a structured `{ key, params }`
 * i18n error (or null) — render it with `t(error.key, error.params)`.
 * Used by SettingsPage to call GET /health.
 */
export function useApi<T>(path: string, init?: RequestInit) {
  const data = shallowRef<T | null>(null)
  const error = ref<ApiError | null>(null)
  const loading = ref(false)

  // Guards against the stale-response race: only the latest execute() may
  // write state, so an earlier slow response can't clobber a newer one.
  let requestId = 0

  async function execute(): Promise<void> {
    const id = ++requestId
    loading.value = true
    error.value = null
    const result = await apiFetch<T>(path, init)
    if (id !== requestId) return
    if (result.ok) {
      data.value = result.data
    } else {
      error.value = result.error
    }
    loading.value = false
  }

  return { data, error, loading, execute }
}
