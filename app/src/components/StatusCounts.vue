<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '../lib/types'
import { TASK_STATUSES } from '../lib/types'
import { statusColor, statusKey } from '../lib/status'

const props = defineProps<{ tasks: Task[] }>()
const { t } = useI18n()

const counts = computed(() =>
  TASK_STATUSES.map((s) => ({ status: s, n: props.tasks.filter((tk) => tk.status === s).length })).filter((r) => r.n > 0),
)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs" style="color: var(--text-muted);">{{ props.tasks.length }} {{ t('board.tasksLabel') }}</span>
    <span
      v-for="r in counts"
      :key="r.status"
      class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs"
      :style="{ color: statusColor(r.status), background: 'color-mix(in srgb, ' + statusColor(r.status) + ' 15%, transparent)' }"
      :title="t(statusKey(r.status))"
    >
      <span class="h-1.5 w-1.5 rounded-full" :style="{ background: statusColor(r.status) }" />
      {{ r.n }}
    </span>
  </div>
</template>
