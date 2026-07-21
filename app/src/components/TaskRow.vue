<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import StatusBadge from './StatusBadge.vue'
import type { Task } from '../lib/types'

// One task as a linked list row: title, muted context line, due date, status.
// Used by the task lists (All Tasks, Team member, Client portal). Slots:
//  - meta:    extra muted text before the due date (e.g. assignee name)
//  - default: trailing content after the status badge (e.g. a review link)
defineProps<{ task: Task; context?: string }>()

const { d } = useI18n()
</script>

<template>
  <RouterLink
    :to="{ name: 'task', params: { taskId: task.id } }"
    class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-2)]"
    style="background: var(--surface);"
  >
    <div class="min-w-0">
      <p class="truncate text-sm font-medium" style="color: var(--text);">{{ task.title }}</p>
      <p v-if="context" class="truncate text-xs" style="color: var(--text-muted);">{{ context }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <slot name="meta" />
      <span v-if="task.dueAt" class="hidden text-xs sm:inline" style="color: var(--text-muted);">{{ d(task.dueAt, 'short') }}</span>
      <StatusBadge :status="task.status" />
      <slot />
    </div>
  </RouterLink>
</template>
