<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DeliverablePriority } from '../lib/types'
import { priorityColor, priorityKey } from '../lib/priority'

// Small priority chip for deliverable rows. `always` forces it to render even
// for 'normal' (detail pages want the full picture); list views leave it off so
// only the exceptions draw the eye.
defineProps<{ priority: DeliverablePriority; always?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <span
    v-if="always || priority !== 'normal'"
    class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs"
    style="background: var(--surface-2);"
    :style="{ color: priorityColor(priority) }"
  >
    <span class="h-1.5 w-1.5 rounded-full" :style="{ background: priorityColor(priority) }" />
    {{ t(priorityKey(priority)) }}
  </span>
</template>
