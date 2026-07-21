<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { parseCsv, type ParsedCsv } from '../lib/csv'
import { TASK_STATUSES } from '../lib/types'
import type { TaskStatus } from '../lib/types'
import BaseButton from './BaseButton.vue'
import Modal from './Modal.vue'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const data = useDataStore()
const toast = useToastStore()

type Entity = 'clients' | 'projects' | 'tasks'
const FIELDS: Record<Entity, { key: string; required: boolean }[]> = {
  clients: [{ key: 'name', required: true }],
  projects: [
    { key: 'name', required: true },
    { key: 'client', required: true },
    { key: 'view', required: false },
  ],
  tasks: [
    { key: 'title', required: true },
    { key: 'project', required: true },
    { key: 'subGroup', required: false },
    { key: 'assignee', required: false },
    { key: 'status', required: false },
    { key: 'due', required: false },
    { key: 'description', required: false },
  ],
}

const step = ref(1)
const entity = ref<Entity>('clients')
const csv = ref<ParsedCsv | null>(null)
const mapping = ref<Record<string, string>>({})
// useBusy guarantees the flag clears even if a load/create rejects outside
// the per-row try/catch (the store's guarded() has already toasted).
const { busy: importing, run } = useBusy()
const result = ref<{ ok: number; failed: { row: number; reason: string }[] } | null>(null)

const entityOptions = computed(() =>
  (['clients', 'projects', 'tasks'] as const).map((e) => ({ value: e, label: t(`import.e_${e}`) })),
)

function reset() {
  step.value = 1
  csv.value = null
  mapping.value = {}
  result.value = null
}
watch(() => props.open, (o) => { if (o) reset() })

async function loadRefs() {
  await Promise.all([data.loadUsers(), data.loadClients(), data.loadAllProjects()])
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const text = await file.text()
  csv.value = parseCsv(text)
  // Auto-guess mapping: header whose lowercase matches the field key/label.
  const m: Record<string, string> = {}
  for (const f of FIELDS[entity.value]) {
    const label = t(`import.f_${f.key}`).toLowerCase()
    const hit = csv.value.headers.find((h) => {
      const hl = h.toLowerCase()
      return hl === f.key.toLowerCase() || hl === label || hl.includes(f.key.toLowerCase())
    })
    if (hit) m[f.key] = hit
  }
  mapping.value = m
  await loadRefs()
  step.value = 3
}

// ── Row preparation / validation ──────────────────────────────
interface Prep { row: number; error?: string; payload?: Record<string, unknown> }

function mapped(r: Record<string, string>, key: string): string {
  const h = mapping.value[key]
  return h ? (r[h] ?? '').trim() : ''
}
function findClient(name: string) {
  return data.clients.find((c) => c.name.toLowerCase() === name.toLowerCase())
}
function findProject(name: string) {
  return data.projects.find((p) => p.name.toLowerCase() === name.toLowerCase())
}
function findUser(s: string) {
  const q = s.toLowerCase()
  return Object.values(data.usersById).find((u) => u.displayName.toLowerCase() === q || u.email.toLowerCase() === q)
}
function normStatus(s: string): TaskStatus {
  const v = s.toLowerCase().replace(/\s+/g, '_') as TaskStatus
  return (TASK_STATUSES as string[]).includes(v) ? v : 'backlog'
}

const prepared = computed<Prep[]>(() => {
  if (!csv.value) return []
  return csv.value.rows.map((r, i) => {
    const row = i + 2 // +1 header, +1 for 1-based
    if (entity.value === 'clients') {
      const name = mapped(r, 'name')
      if (!name) return { row, error: t('import.errName') }
      return { row, payload: { name } }
    }
    if (entity.value === 'projects') {
      const name = mapped(r, 'name')
      const clientName = mapped(r, 'client')
      if (!name) return { row, error: t('import.errName') }
      const client = findClient(clientName)
      if (!client) return { row, error: t('import.errClient', { name: clientName }) }
      const view = mapped(r, 'view').toLowerCase() === 'list' ? 'list' : 'kanban'
      return { row, payload: { name, clientId: client.id, view } }
    }
    // tasks
    const title = mapped(r, 'title')
    const projectName = mapped(r, 'project')
    if (!title) return { row, error: t('import.errTitle') }
    const project = findProject(projectName)
    if (!project) return { row, error: t('import.errProject', { name: projectName }) }
    const assigneeStr = mapped(r, 'assignee')
    const assignee = assigneeStr ? findUser(assigneeStr) : undefined
    const dueStr = mapped(r, 'due')
    const due = dueStr ? new Date(dueStr) : null
    return {
      row,
      payload: {
        title,
        projectId: project.id,
        clientId: project.clientId,
        subGroup: mapped(r, 'subGroup') || t('import.defaultSubGroup'),
        assigneeUid: assignee?.uid ?? '',
        status: normStatus(mapped(r, 'status')),
        dueAt: due && !isNaN(due.getTime()) ? due : null,
        description: mapped(r, 'description'),
      },
    }
  })
})

const validRows = computed(() => prepared.value.filter((p) => !p.error))
const invalidRows = computed(() => prepared.value.filter((p) => p.error))
const missingRequired = computed(() => FIELDS[entity.value].filter((f) => f.required && !mapping.value[f.key]))

async function ensureSubGroup(projectId: string, name: string): Promise<string> {
  const existing = data.subGroups.find((s) => s.projectId === projectId && s.name.toLowerCase() === name.toLowerCase())
  if (existing) return existing.id
  const sg = await data.createSubGroup(projectId, name)
  return sg.id
}

async function runImport() {
  await run(async () => {
    const failed: { row: number; reason: string }[] = []
    let ok = 0
    if (entity.value === 'tasks') {
      const pids = [...new Set(validRows.value.map((p) => p.payload!.projectId as string))]
      await Promise.all(pids.map((pid) => data.loadProjectBoard(pid)))
    }
    for (const p of validRows.value) {
      const pl = p.payload!
      try {
        if (entity.value === 'clients') {
          await data.createClient(pl.name as string)
        } else if (entity.value === 'projects') {
          await data.createProject(pl.clientId as string, pl.name as string, pl.view as 'kanban' | 'list')
        } else {
          const subGroupId = await ensureSubGroup(pl.projectId as string, pl.subGroup as string)
          await data.createTask({
            projectId: pl.projectId as string,
            subGroupId,
            clientId: pl.clientId as string,
            title: pl.title as string,
            description: pl.description as string,
            assigneeUid: pl.assigneeUid as string,
            status: pl.status as TaskStatus,
            dueAt: pl.dueAt as Date | null,
            clientVisible: false, // imported tasks start hidden — share explicitly
          })
        }
        ok++
      } catch {
        failed.push({ row: p.row, reason: t('common.saveError') })
      }
    }
    result.value = { ok, failed }
    step.value = 4
    if (ok) toast.success(t('import.done', { n: ok }))
  })
}
</script>

<template>
  <!-- Modal provides the shared overlay recipe (Recipe 6, reduced-motion
       aware), focus trap, esc + backdrop dismissal, and the labeled close
       button. -->
  <Modal :open="open" :title="t('import.title')" size="lg" @close="emit('close')">
    <!-- Step 1: entity -->
    <div v-if="step === 1">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('import.pickEntity') }}</p>
      <div class="mt-4">
        <SegmentedControl v-model="entity" :options="entityOptions" />
      </div>
      <div class="mt-5 flex justify-end">
        <BaseButton @click="step = 2">{{ t('import.next') }}</BaseButton>
      </div>
    </div>

    <!-- Step 2: upload -->
    <div v-else-if="step === 2">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('import.upload', { entity: t('import.e_' + entity) }) }}</p>
      <input
        type="file"
        accept=".csv,text/csv"
        class="mt-4 block w-full text-sm"
        style="color: var(--text-muted);"
        @change="onFile"
      />
      <div class="mt-5 flex justify-between">
        <button class="text-sm" style="color: var(--text-muted);" @click="step = 1">← {{ t('import.back') }}</button>
      </div>
    </div>

    <!-- Step 3: map + preview -->
    <div v-else-if="step === 3 && csv">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('import.mapHint') }}</p>
      <div class="mt-4 space-y-2">
        <div v-for="f in FIELDS[entity]" :key="f.key" class="flex items-center gap-3">
          <span class="w-32 shrink-0 text-sm" style="color: var(--text);">
            {{ t('import.f_' + f.key) }}<span v-if="f.required" style="color: var(--accent-amber);"> *</span>
          </span>
          <select
            v-model="mapping[f.key]"
            class="flex-1 rounded-lg border px-2 py-1.5 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          >
            <option value="">{{ t('import.ignore') }}</option>
            <option v-for="h in csv.headers" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
      </div>

      <div class="mt-4 rounded-lg border p-3 text-sm" style="border-color: var(--border);">
        <p v-if="missingRequired.length" style="color: var(--accent-amber);">
          {{ t('import.needRequired', { fields: missingRequired.map((f) => t('import.f_' + f.key)).join(', ') }) }}
        </p>
        <template v-else>
          <p style="color: var(--text);">{{ t('import.previewValid', { n: validRows.length }) }}</p>
          <p v-if="invalidRows.length" class="mt-1" style="color: var(--accent-amber);">
            {{ t('import.previewInvalid', { n: invalidRows.length }) }}
          </p>
          <ul v-if="invalidRows.length" class="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-xs" style="color: var(--text-muted);">
            <li v-for="p in invalidRows.slice(0, 8)" :key="p.row">{{ t('import.rowN', { n: p.row }) }}: {{ p.error }}</li>
          </ul>
        </template>
      </div>

      <div class="mt-5 flex items-center justify-between">
        <button class="text-sm" style="color: var(--text-muted);" @click="step = 2">← {{ t('import.back') }}</button>
        <BaseButton :disabled="importing || !!missingRequired.length || !validRows.length" @click="runImport">
          {{ importing ? t('common.loading') : t('import.importN', { n: validRows.length }) }}
        </BaseButton>
      </div>
    </div>

    <!-- Step 4: result -->
    <div v-else-if="step === 4 && result">
      <p class="text-sm font-medium" style="color: var(--accent-emerald);">{{ t('import.done', { n: result.ok }) }}</p>
      <p v-if="result.failed.length" class="mt-1 text-sm" style="color: var(--accent-amber);">
        {{ t('import.failedN', { n: result.failed.length }) }}
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button class="rounded-lg px-3 py-2 text-sm" style="color: var(--text-muted);" @click="reset">{{ t('import.again') }}</button>
        <BaseButton @click="emit('close')">{{ t('import.close') }}</BaseButton>
      </div>
    </div>
  </Modal>
</template>
