<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// Highly visible breadcrumb trail (Client > Project > Sub-Group > Task) to
// fight click-fatigue in the deep-nesting engine.
defineProps<{ items: { label: string; to?: RouteLocationRaw }[] }>()
</script>

<template>
  <nav class="flex flex-wrap items-center gap-1 text-sm" style="color: var(--text-muted);">
    <template v-for="(item, i) in items" :key="i">
      <RouterLink
        v-if="item.to"
        :to="item.to"
        class="transition-colors hover:underline"
        style="color: var(--text-muted);"
      >
        {{ item.label }}
      </RouterLink>
      <span v-else style="color: var(--text);">{{ item.label }}</span>
      <span v-if="i < items.length - 1" aria-hidden="true" class="opacity-50">/</span>
    </template>
  </nav>
</template>
