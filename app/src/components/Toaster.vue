<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '../stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { items } = storeToRefs(toast)
</script>

<template>
  <!-- Recipe 7 in transitions.css: toast slide-up enter/leave. -->
  <Teleport to="body">
    <div class="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4">
      <TransitionGroup name="toast">
        <div
          v-for="item in items"
          :key="item.id"
          class="pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg"
          :style="{
            background: 'var(--surface-2)',
            borderColor: item.kind === 'error' ? 'var(--accent-amber)' : 'var(--accent-emerald)',
            color: 'var(--text)',
          }"
          role="status"
        >
          <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: item.kind === 'error' ? 'var(--accent-amber)' : 'var(--accent-emerald)' }" />
          <span>{{ item.message }}</span>
          <button class="ml-auto text-xs" style="color: var(--text-muted);" :aria-label="t('common.close')" @click="toast.dismiss(item.id)">✕</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
