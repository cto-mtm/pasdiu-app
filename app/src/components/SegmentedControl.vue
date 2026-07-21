<script setup lang="ts" generic="T extends string">
// Fluid segmented toggle (e.g. the Kanban ↔ List switch on the board).
// v-model holds the active value; options render left to right.
// When an option carries an `icon`, the segment renders the icon and the
// label becomes its accessible name (aria-label + title tooltip).
defineProps<{ options: { value: T; label: string; icon?: 'kanban' | 'list' | 'grid' }[] }>()

const model = defineModel<T>({ required: true })

// 24×24 stroke icons, drawn to read at 16px.
const ICONS: Record<'kanban' | 'list' | 'grid', string[]> = {
  // Three columns of differing heights.
  kanban: ['M4 4h4v13H4z', 'M10 4h4v9h-4z', 'M16 4h4v16h-4z'],
  // Bullet + line, three rows.
  list: ['M4 6h.01M9 6h11', 'M4 12h.01M9 12h11', 'M4 18h.01M9 18h11'],
  // 2×2 squares.
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
}
</script>

<template>
  <div class="flex shrink-0 overflow-hidden rounded-lg border" style="border-color: var(--border);">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm transition-colors"
      :style="{
        background: model === opt.value ? 'var(--accent-cyan)' : 'transparent',
        color: model === opt.value ? 'var(--bg)' : 'var(--text-muted)',
      }"
      :aria-pressed="model === opt.value"
      :aria-label="opt.label"
      :title="opt.icon ? opt.label : undefined"
      @click="model = opt.value"
    >
      <svg
        v-if="opt.icon"
        viewBox="0 0 24 24"
        class="h-4 w-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path v-for="(p, i) in ICONS[opt.icon]" :key="i" :d="p" />
      </svg>
      <template v-else>{{ opt.label }}</template>
    </button>
  </div>
</template>
