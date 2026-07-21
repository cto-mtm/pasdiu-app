<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProjectBrief, MetaField } from '../lib/types'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import MetaEditor from './MetaEditor.vue'
import InfoTip from './InfoTip.vue'
import BaseInput from './BaseInput.vue'

const props = defineProps<{ open: boolean; projectId: string | null; brief: ProjectBrief | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const auth = useAuthStore()
const data = useDataStore()

const editing = ref(false)
const brand = ref('')
const sop = ref('')
const linksText = ref('')
const fields = ref<MetaField[]>([])
const { busy, run } = useBusy()

function startEdit() {
  if (!props.brief) return
  brand.value = props.brief.brandGuidelinesUrl
  sop.value = props.brief.sopUrl
  linksText.value = props.brief.links.join('\n')
  fields.value = props.brief.fields.map((f) => ({ ...f }))
  editing.value = true
}

// Leaving edit mode whenever the drawer closes.
watch(() => props.open, (o) => { if (!o) editing.value = false })

async function save() {
  const projectId = props.projectId
  if (!projectId) return
  const brief: ProjectBrief = {
    brandGuidelinesUrl: brand.value.trim(),
    sopUrl: sop.value.trim(),
    links: linksText.value.split('\n').map((l) => l.trim()).filter(Boolean),
    fields: fields.value.filter((f) => f.label.trim() || f.value.trim()),
  }
  // run() clears busy even when the save rejects (the store already toasted),
  // and edit mode only exits on success so nothing typed is lost.
  await run(async () => {
    await data.updateProjectBrief(projectId, brief)
    editing.value = false
  })
}
</script>

<template>
  <!-- Toggleable side-panel holding immutable brief links / brand guidelines /
       SOPs plus arbitrary fields. Managers can edit in place.
       Recipe 8 in transitions.css: shared drawer fade + panel slide. -->
  <Transition name="drawer">
    <div v-if="open" class="fixed inset-0 z-30" @keydown.esc="emit('close')">
      <div class="absolute inset-0" style="background: rgba(0,0,0,0.5);" @click="emit('close')" />
      <aside
        class="drawer-panel safe-top safe-bottom absolute right-0 top-0 h-full w-full max-w-sm overflow-y-auto border-l p-5"
        style="background: var(--surface); border-color: var(--border);"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-center justify-between">
          <h2 class="flex items-center gap-1.5 mt-5 text-lg font-semibold" style="color: var(--text);">
            {{ t('brief.title') }}
            <InfoTip :text="t('brief.info')" />
          </h2>
          <div class="flex items-center gap-3">
            <button
              v-if="auth.isManager && !editing"
              class="text-sm"
              style="color: var(--accent-cyan);"
              @click="startEdit"
            >
              {{ t('actions.edit') }}
            </button>
            <button class="text-sm" style="color: var(--text-muted);" :aria-label="t('common.close')" @click="emit('close')">✕</button>
          </div>
        </div>

        <!-- VIEW MODE -->
        <template v-if="brief && !editing">
          <div class="mt-5 space-y-4 text-sm">
            <div v-if="brief.brandGuidelinesUrl">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.brand') }}</p>
              <a :href="brief.brandGuidelinesUrl" target="_blank" rel="noopener" class="break-all" style="color: var(--accent-cyan);">{{ brief.brandGuidelinesUrl }}</a>
            </div>
            <div v-if="brief.sopUrl">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.sop') }}</p>
              <a :href="brief.sopUrl" target="_blank" rel="noopener" class="break-all" style="color: var(--accent-cyan);">{{ brief.sopUrl }}</a>
            </div>
            <div v-if="brief.links.length">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.links') }}</p>
              <ul class="mt-1 space-y-1">
                <li v-for="(l, i) in brief.links" :key="i" style="color: var(--text);">• {{ l }}</li>
              </ul>
            </div>
            <div v-if="brief.fields.length">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.details') }}</p>
              <dl class="mt-1 space-y-1">
                <div v-for="(f, i) in brief.fields" :key="i" class="flex justify-between gap-3">
                  <dt style="color: var(--text-muted);">{{ f.label }}</dt>
                  <dd class="text-right" style="color: var(--text);">{{ f.value }}</dd>
                </div>
              </dl>
            </div>
            <p
              v-if="!brief.brandGuidelinesUrl && !brief.sopUrl && !brief.links.length && !brief.fields.length"
              style="color: var(--text-muted);"
            >
              {{ t('brief.empty') }}
            </p>
          </div>
        </template>

        <!-- EDIT MODE -->
        <form v-else-if="editing" class="mt-5 space-y-4 text-sm" @submit.prevent="save">
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.brand') }}</span>
            <BaseInput v-model="brand" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.sop') }}</span>
            <BaseInput v-model="sop" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.linksHint') }}</span>
            <textarea v-model="linksText" rows="3" class="w-full rounded-lg border px-3 py-2 outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);" />
          </label>
          <div>
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.details') }}</span>
            <MetaEditor
              v-model="fields"
              :suggestions="[t('meta.deadline'), t('meta.format'), t('meta.aspectRatio')]"
            />
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-lg px-3 py-2" style="color: var(--text-muted);" @click="editing = false">{{ t('actions.cancel') }}</button>
            <button type="submit" :disabled="busy" class="rounded-lg px-3 py-2 font-medium" style="background: var(--accent-cyan); color: var(--bg);">{{ t('actions.save') }}</button>
          </div>
        </form>
      </aside>
    </div>
  </Transition>
</template>

