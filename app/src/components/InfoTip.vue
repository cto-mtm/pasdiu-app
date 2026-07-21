<script setup lang="ts">
// Small ⓘ icon with a hover/focus tooltip. Keyboard-accessible (tabbable,
// tooltip shows on focus) and announced via aria-label.
defineProps<{ text: string }>()
</script>

<template>
  <span class="info-tip" tabindex="0" role="note" :aria-label="text">
    <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
    <span class="info-bubble" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.info-tip {
  position: relative;
  display: inline-flex;
  cursor: help;
  color: var(--text-muted);
  vertical-align: middle;
}
.info-bubble {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  z-index: 50;
  width: max-content;
  max-width: 15rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  padding: 6px 10px;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.3;
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.info-tip:hover .info-bubble,
.info-tip:focus-visible .info-bubble {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  .info-bubble {
    transition: none;
  }
}
</style>
