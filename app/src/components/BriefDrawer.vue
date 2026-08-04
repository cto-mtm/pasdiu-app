<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetaField } from '../lib/types'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import MetaEditor from './MetaEditor.vue'
import InfoTip from './InfoTip.vue'

// The brief is the whole metadata chain for whatever you're looking at:
// client → project → sub-group → deliverable. Each level shows its own `meta`
// and is separately editable, because that is where every *display* surface in
// the app reads from. (The drawer used to edit `project.brief` instead, a
// field nothing renders — edits saved successfully and then vanished.)
//
// Callers pass ids, not entities: the drawer loads whatever isn't in the store
// yet, so a task page doesn't have to pre-fetch its sub-group to show a brief.
const props = defineProps<{
  open: boolean
  clientId?: string | null
  projectId?: string | null
  subGroupId?: string | null
  deliverableId?: string | null
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const auth = useAuthStore()
const data = useDataStore()
const { busy, run } = useBusy()

interface BriefSection {
  key: string
  title: string
  name: string
  meta: MetaField[]
  suggestions: string[]
  save: (meta: MetaField[]) => Promise<void>
}

const client = computed(() => (props.clientId ? data.getClient(props.clientId) : undefined))
const project = computed(() => (props.projectId ? data.getProject(props.projectId) : undefined))
const subGroup = computed(() => (props.subGroupId ? data.getSubGroup(props.subGroupId) : undefined))
const deliverable = computed(() => (props.deliverableId ? data.getDeliverable(props.deliverableId) : undefined))

// One section per level that actually resolved. Suggestions mirror the ones
// each entity's own edit modal offers, so the vocabulary stays consistent
// wherever a field is added.
const sections = computed<BriefSection[]>(() => {
  const out: BriefSection[] = []
  const c = client.value
  if (c) {
    out.push({
      key: 'client',
      title: t('brief.sectionClient'),
      name: c.name,
      meta: c.meta,
      suggestions: [t('meta.contact'), t('meta.email'), t('meta.phone'), t('meta.driveFolder'), t('meta.sopLink')],
      save: (meta) => data.updateClient(c.id, { meta }),
    })
  }
  const p = project.value
  if (p) {
    out.push({
      key: 'project',
      title: t('brief.sectionProject'),
      name: p.name,
      meta: p.meta,
      suggestions: [t('meta.budget'), t('meta.kickoff'), t('meta.deadline'), t('meta.driveFolder'), t('meta.links')],
      save: (meta) => data.updateProject(p.id, { meta }),
    })
  }
  const sg = subGroup.value
  if (sg) {
    out.push({
      key: 'subGroup',
      title: t('brief.sectionSubGroup'),
      name: sg.name,
      meta: sg.meta,
      suggestions: [t('meta.deadline'), t('meta.links'), t('meta.driveFolder')],
      save: (meta) => data.updateSubGroup(sg.id, { meta }),
    })
  }
  const del = deliverable.value
  if (del) {
    out.push({
      key: 'deliverable',
      title: t('brief.sectionDeliverable'),
      name: del.name,
      meta: del.meta,
      suggestions: [t('meta.aspectRatio'), t('meta.runtime'), t('meta.format'), t('meta.reference'), t('meta.links')],
      save: (meta) => data.updateDeliverable(del.id, { meta }),
    })
  }
  return out
})

const hasAnyMeta = computed(() => sections.value.some((s) => s.meta.length))

// Legacy project.brief content, read-only. Nothing writes here any more — the
// fields are project-level references that belong in project metadata — but
// existing projects still carry them and dropping them would lose data.
const legacy = computed(() => {
  const b = project.value?.brief
  if (!b) return null
  const has = b.brandGuidelinesUrl || b.sopUrl || b.links.length || b.fields.length
  return has ? b : null
})

// One section edits at a time; the draft is local until saved so a failed
// write leaves what was typed on screen.
const editingKey = ref<string | null>(null)
const draft = ref<MetaField[]>([])

function startEdit(section: BriefSection) {
  editingKey.value = section.key
  draft.value = section.meta.map((f) => ({ ...f }))
}
function cancelEdit() {
  editingKey.value = null
  draft.value = []
}
async function save(section: BriefSection) {
  // run() clears busy even when the save rejects (the store already toasted),
  // and edit mode only exits on success so nothing typed is lost.
  await run(async () => {
    await section.save(draft.value.filter((f) => f.label.trim() || f.value.trim()))
    cancelEdit()
  })
}

// Pull in whatever the caller didn't already have loaded. Failures are silent
// BY DESIGN: a level that won't load simply doesn't get a section. The client
// role can't read subGroups at all (firestore.rules), so for them that fetch
// rejects and the drawer renders client → project → deliverable — which is
// exactly what a client should see, without a role check here to maintain.
async function hydrate() {
  await Promise.all([
    props.clientId && !client.value ? data.loadClient(props.clientId) : null,
    props.projectId && !project.value ? data.loadProject(props.projectId) : null,
    props.subGroupId && !subGroup.value ? data.loadSubGroup(props.subGroupId) : null,
    props.deliverableId && !deliverable.value ? data.loadDeliverable(props.deliverableId) : null,
  ].map((p) => Promise.resolve(p).catch(() => undefined)))
}

watch(() => props.open, (isOpen) => {
  if (isOpen) hydrate()
  else cancelEdit() // leaving edit mode whenever the drawer closes
}, { immediate: true })
</script>

<template>
  <!-- Toggleable side-panel holding the metadata chain for the current context.
       Managers can edit any level in place.
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
          <h2 class="mt-5 flex items-center gap-1.5 text-lg font-semibold" style="color: var(--text);">
            {{ t('brief.title') }}
            <InfoTip :text="t('brief.info')" />
          </h2>
          <button class="text-sm" style="color: var(--text-muted);" :aria-label="t('common.close')" @click="emit('close')">✕</button>
        </div>

        <div class="mt-5 space-y-5 text-sm">
          <section v-for="s in sections" :key="s.key">
            <div class="flex items-baseline justify-between gap-2">
              <p class="text-xs uppercase tracking-wide" style="color: var(--accent-cyan);">
                {{ s.title }}
                <span class="normal-case" style="color: var(--text-muted);">— {{ s.name }}</span>
              </p>
              <button
                v-if="auth.isManager && editingKey !== s.key"
                class="shrink-0 text-xs"
                style="color: var(--accent-cyan);"
                @click="startEdit(s)"
              >
                {{ t('actions.edit') }}
              </button>
            </div>

            <!-- VIEW -->
            <template v-if="editingKey !== s.key">
              <dl v-if="s.meta.length" class="mt-1.5 space-y-1">
                <div v-for="(f, i) in s.meta" :key="i" class="flex justify-between gap-3">
                  <dt style="color: var(--text-muted);">{{ f.label }}</dt>
                  <dd class="text-right" style="color: var(--text);">{{ f.value }}</dd>
                </div>
              </dl>
              <p v-else class="mt-1.5 text-xs" style="color: var(--text-muted);">{{ t('brief.sectionEmpty') }}</p>
            </template>

            <!-- EDIT -->
            <form v-else class="mt-2 space-y-3" @submit.prevent="save(s)">
              <MetaEditor v-model="draft" :suggestions="s.suggestions" />
              <div class="flex justify-end gap-2">
                <button type="button" class="rounded-lg px-3 py-2" style="color: var(--text-muted);" @click="cancelEdit">
                  {{ t('actions.cancel') }}
                </button>
                <button
                  type="submit"
                  :disabled="busy"
                  class="rounded-lg px-3 py-2 font-medium disabled:opacity-50"
                  style="background: var(--accent-cyan); color: var(--bg);"
                >
                  {{ t('actions.save') }}
                </button>
              </div>
            </form>
          </section>

          <p v-if="!sections.length || (!hasAnyMeta && !legacy)" style="color: var(--text-muted);">
            {{ t('brief.empty') }}
          </p>

          <!-- Legacy project brief — read-only. -->
          <section v-if="legacy" class="border-t pt-4" style="border-color: var(--border);">
            <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.legacySection') }}</p>
            <div v-if="legacy.brandGuidelinesUrl" class="mt-2">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.brand') }}</p>
              <a :href="legacy.brandGuidelinesUrl" target="_blank" rel="noopener" class="break-all" style="color: var(--accent-cyan);">{{ legacy.brandGuidelinesUrl }}</a>
            </div>
            <div v-if="legacy.sopUrl" class="mt-2">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.sop') }}</p>
              <a :href="legacy.sopUrl" target="_blank" rel="noopener" class="break-all" style="color: var(--accent-cyan);">{{ legacy.sopUrl }}</a>
            </div>
            <div v-if="legacy.links.length" class="mt-2">
              <p class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('brief.links') }}</p>
              <ul class="mt-1 space-y-1">
                <li v-for="(l, i) in legacy.links" :key="i" class="break-all" style="color: var(--text);">• {{ l }}</li>
              </ul>
            </div>
            <dl v-if="legacy.fields.length" class="mt-2 space-y-1">
              <div v-for="(f, i) in legacy.fields" :key="i" class="flex justify-between gap-3">
                <dt style="color: var(--text-muted);">{{ f.label }}</dt>
                <dd class="text-right" style="color: var(--text);">{{ f.value }}</dd>
              </div>
            </dl>
            <p class="mt-2 text-xs" style="color: var(--text-muted);">{{ t('brief.legacyHint') }}</p>
          </section>
        </div>
      </aside>
    </div>
  </Transition>
</template>
