<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

// Explicit re-read. Store data now ages out on a TTL rather than being cached
// for the whole session, but "it changed thirty seconds ago and I need to see
// it" still needs an answer that isn't a full page reload.
const props = defineProps<{ onRefresh: () => Promise<unknown> }>()
const { t } = useI18n()

const spinning = ref(false)
async function click() {
  if (spinning.value) return
  spinning.value = true
  try {
    await props.onRefresh()
  } finally {
    spinning.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border disabled:opacity-50"
    style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
    :disabled="spinning"
    :aria-label="t('common.refresh')"
    :title="t('common.refresh')"
    @click="click"
  >
    <svg
      viewBox="0 0 24 24"
      class="h-4 w-4"
      :class="{ 'refresh-spin': spinning }"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  </button>
</template>
