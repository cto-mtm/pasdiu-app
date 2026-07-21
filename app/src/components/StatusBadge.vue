<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TaskStatus } from '../lib/types'
import { statusColor, statusKey } from '../lib/status'

const props = defineProps<{ status: TaskStatus }>()
const { t } = useI18n()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
    :style="{ color: statusColor(props.status), background: 'color-mix(in srgb, ' + statusColor(props.status) + ' 15%, transparent)' }"
  >
    <span class="h-1.5 w-1.5 rounded-full" :style="{ background: statusColor(props.status) }" />
    {{ t(statusKey(props.status)) }}
  </span>
</template>
