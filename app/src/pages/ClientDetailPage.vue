<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { resendInviteApi } from '../lib/api'
import { clientTitleTransitionName } from '../lib/viewTransitions'
import type { Invite } from '../lib/types'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import MetaEditor from '../components/MetaEditor.vue'
import StatusCounts from '../components/StatusCounts.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import InfoTip from '../components/InfoTip.vue'
import RefreshButton from '../components/RefreshButton.vue'
import type { MetaField, Project } from '../lib/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const auth = useAuthStore()
const toast = useToastStore()

const clientId = computed(() => String(route.params.clientId))
const client = computed(() => data.getClient(clientId.value))
const projects = computed(() => data.projects.filter((p) => p.clientId === clientId.value))

const { busy, run } = useBusy()

// Create project. No view picker here — choosing a default layout for a
// project that has no content yet is a decision with nothing to base it on.
// It starts on kanban and is changed later from the board's edit modal.
const showNew = ref(false)
const name = ref('')

async function create() {
  if (!name.value.trim()) return
  await run(async () => {
    await data.createProject(clientId.value, name.value.trim(), 'kanban')
    showNew.value = false
    name.value = ''
  })
}

// Edit client (name, metadata)
const showEdit = ref(false)
const editName = ref('')
const editMeta = ref<MetaField[]>([])

function openEdit() {
  if (!client.value) return
  editName.value = client.value.name
  editMeta.value = client.value.meta.map((f) => ({ ...f }))
  showEdit.value = true
}
async function saveEdit() {
  if (!editName.value.trim()) return
  await run(async () => {
    await data.updateClient(clientId.value, {
      name: editName.value.trim(),
      meta: editMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    })
    showEdit.value = false
  })
}

const showDelete = ref(false)
async function confirmDelete() {
  await data.deleteClient(clientId.value)
  showDelete.value = false
  router.push({ name: 'dashboard' })
}

// Per-project task counts
const projectTasks = (projectId: string) => data.tasks.filter((tk) => tk.projectId === projectId)

// ── Portal access (client-role members OF THIS CLIENT) ──────────
// Client contacts are invited HERE, not from the Team page — the role and
// the client binding are pinned by context, so a manager never picks a
// client from a dropdown. Contacts and pending invites come from the same
// live listeners the Team page uses, filtered to this client.
const contacts = computed(() =>
  Object.values(data.usersById).filter((u) => u.role === 'client' && u.clientId === clientId.value),
)
const portalInvites = computed(() =>
  data.invites.filter((inv) => inv.role === 'client' && inv.clientId === clientId.value),
)

const showInvite = ref(false)
const inviteEmail = ref('')
function openInvite() {
  inviteEmail.value = ''
  showInvite.value = true
}
// No seat gate: client-role members are unlimited on every plan.
async function saveInvite() {
  const email = inviteEmail.value.trim().toLowerCase()
  if (!email) return
  await run(async () => {
    await data.createInvite({ email, role: 'client', clientId: clientId.value })
    showInvite.value = false
    toast.success(t('team.inviteCreated'))
  })
}

// Expired invites can't be accepted (server-side 404) — same handling as the
// Team page. Legacy invites without expiresAt never expire.
function isExpired(inv: Invite): boolean {
  return inv.expiresAt !== null && inv.expiresAt.getTime() < Date.now()
}
async function copyLink(inv: Invite) {
  const url = `${location.origin}/invite/${auth.activeOrgId}/${inv.id}`
  try {
    await navigator.clipboard.writeText(url)
    toast.success(t('team.linkCopied', { email: inv.email }))
  } catch {
    toast.error(t('team.copyFailed'))
  }
}
async function resend(inv: Invite) {
  await run(async () => {
    const orgId = auth.activeOrgId
    if (!orgId) return
    const res = await resendInviteApi(orgId, inv.id)
    if (res.ok) toast.success(t('team.inviteResent', { email: inv.email }))
    else toast.error(t(res.error.key, res.error.params ?? {}))
  })
}
const revokeTarget = ref<Invite | null>(null)
async function confirmRevoke() {
  const inv = revokeTarget.value
  revokeTarget.value = null
  if (!inv) return
  await run(() => data.revokeInvite(inv.id))
}

// All three views get their own label — the old two-way ternary rendered a
// deliverables-first project as "List".
const VIEW_LABEL_KEYS: Record<Project['defaultView'], string> = {
  kanban: 'board.viewKanban',
  list: 'board.viewList',
  deliverables: 'board.viewDeliverables',
}
const viewLabelKey = (v: Project['defaultView']) => VIEW_LABEL_KEYS[v]

const loadError = ref(false)
const loaded = ref(false)
// The client's projects and tasks are TTL-memoized scoped pulls — revisits
// within the freshness window cost nothing, and the refresh control passes
// `force` for the "I know something changed" case.
async function load(force = false) {
  loadError.value = false
  try {
    await Promise.all([
      data.loadClients(),
      data.loadUsers(),
      data.loadInvites(),
      data.loadProjectsForClient(clientId.value, force),
      data.loadAllTasksForClient(clientId.value, force),
    ])
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section v-if="client">
    <Breadcrumbs
      class="mb-4"
      :items="[
        { label: t('dashboard.title'), to: { name: 'dashboard' } },
        { label: client.name },
      ]"
    />

    <div class="mt-1 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);" :style="{ viewTransitionName: clientTitleTransitionName(client.id) }">
        {{ client.name }}
      </h1>
      <div class="flex items-center gap-2">
        <RefreshButton :on-refresh="() => load(true)" />
        <button
          class="rounded-lg border px-3 py-2 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="openEdit"
        >
          {{ t('actions.edit') }}
        </button>
        <BaseButton @click="showNew = true">+ {{ t('actions.newProject') }}</BaseButton>
      </div>
    </div>

    <!-- Client metadata -->
    <dl v-if="client.meta.length" class="mt-4 flex flex-wrap gap-x-8 gap-y-2">
      <div v-for="(f, i) in client.meta" :key="i">
        <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
        <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
      </div>
    </dl>

    <p class="mt-6 text-sm" style="color: var(--text-muted);">{{ t('client.projects') }}</p>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <RouterLink
        v-for="p in projects"
        :key="p.id"
        :to="{ name: 'project', params: { projectId: p.id } }"
        class="block rounded-xl border p-4 transition-transform hover:-translate-y-0.5"
        style="background: var(--surface); border-color: var(--border);"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold" style="color: var(--text);">{{ p.name }}</h3>
          <span class="rounded px-2 py-0.5 text-xs" style="background: var(--surface-2); color: var(--text-muted);">
            {{ t(viewLabelKey(p.defaultView)) }}
          </span>
        </div>
        <div class="mt-3">
          <StatusCounts :tasks="projectTasks(p.id)" />
        </div>
      </RouterLink>
    </div>

    <!-- Portal access: this client's people -->
    <div class="mt-10">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('client.portalAccess') }}</h2>
          <p class="mt-1 text-xs" style="color: var(--text-muted);">{{ t('client.portalAccessHint') }}</p>
        </div>
        <BaseButton class="text-xs" @click="openInvite">+ {{ t('client.invitePortal') }}</BaseButton>
      </div>

      <p v-if="!contacts.length && !portalInvites.length" class="mt-3 text-sm" style="color: var(--text-muted);">
        {{ t('client.portalEmpty') }}
      </p>

      <div v-if="contacts.length" class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RouterLink
          v-for="m in contacts"
          :key="m.uid"
          :to="{ name: 'team-member', params: { uid: m.uid } }"
          class="flex items-center gap-3 rounded-xl border p-3 transition-transform hover:-translate-y-0.5"
          style="background: var(--surface); border-color: var(--border);"
        >
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style="background: var(--surface-2); color: var(--accent-cyan);">
            {{ m.displayName.slice(0, 1) }}
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium" style="color: var(--text);">{{ m.displayName }}</p>
            <p class="truncate text-xs" style="color: var(--text-muted);">{{ m.email }}</p>
          </div>
        </RouterLink>
      </div>

      <!-- Pending portal invites -->
      <div v-if="portalInvites.length" class="mt-3 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border); background: var(--surface);">
        <div
          v-for="inv in portalInvites"
          :key="inv.id"
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          style="border-color: var(--border);"
        >
          <p class="min-w-0 truncate text-sm" style="color: var(--text);">
            {{ inv.email }}
            <span
              v-if="inv.status === 'declined'"
              class="ml-1 rounded px-1.5 py-0.5 text-xs font-medium"
              style="background: color-mix(in srgb, var(--status-blocked) 15%, transparent); color: var(--status-blocked);"
            >{{ t('team.declined') }}</span>
            <span
              v-else-if="isExpired(inv)"
              class="ml-1 rounded px-1.5 py-0.5 text-xs font-medium"
              style="background: color-mix(in srgb, var(--accent-amber) 15%, transparent); color: var(--accent-amber);"
            >{{ t('team.expired') }}</span>
          </p>
          <div class="flex shrink-0 items-center gap-2">
            <button
              v-if="!isExpired(inv) && inv.status !== 'declined'"
              type="button"
              :disabled="busy"
              class="rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50"
              style="color: var(--accent-cyan);"
              @click="resend(inv)"
            >
              {{ t('team.resend') }}
            </button>
            <button
              v-if="!isExpired(inv) && inv.status !== 'declined'"
              type="button"
              class="rounded-lg px-3 py-2 text-sm transition-colors"
              style="color: var(--accent-cyan);"
              :title="t('team.copyLinkHint', { email: inv.email })"
              @click="copyLink(inv)"
            >
              {{ t('team.copyLink') }}
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-sm transition-colors"
              style="color: var(--accent-amber);"
              @click="revokeTarget = inv"
            >
              {{ t('team.revoke') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Invite client contact: role + client are pinned by context -->
    <Modal :open="showInvite" :title="t('client.invitePortal')" @close="showInvite = false">
      <form class="space-y-4" @submit.prevent="saveInvite">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('team.emailLabel') }}</span>
          <BaseInput v-model="inviteEmail" type="email" required :placeholder="t('team.emailLabel')" autofocus />
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showInvite = false" @submit="saveInvite" />
      </form>
    </Modal>

    <ConfirmDialog
      :open="revokeTarget !== null"
      :title="t('team.revokeInvite')"
      :message="t('team.revokeConfirm', { email: revokeTarget?.email ?? '' })"
      danger
      :confirm-label="t('team.revoke')"
      @confirm="confirmRevoke"
      @cancel="revokeTarget = null"
    />

    <Modal :open="showNew" :title="t('actions.newProject')" @close="showNew = false">
      <form class="space-y-4" @submit.prevent="create">
        <label class="block">
          <span class="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">
            {{ t('actions.nameLabel') }}
            <InfoTip :text="t('client.projectExplainer')" />
          </span>
          <BaseInput v-model="name" autofocus :placeholder="t('client.projectPlaceholder')" />
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showNew = false" @submit="create" />
      </form>
    </Modal>

    <Modal :open="showEdit" :title="t('actions.editClient')" @close="showEdit = false">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.nameLabel') }}</span>
          <BaseInput v-model="editName" />
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.metadata') }}</span>
          <MetaEditor
            v-model="editMeta"
            :suggestions="[t('meta.contact'), t('meta.email'), t('meta.phone'), t('meta.billing'), t('meta.driveFolder'), t('meta.sopLink')]"
          />
        </div>
        <div class="flex items-end justify-between gap-2">
          <button type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--accent-amber);" @click="showEdit = false; showDelete = true">
            {{ t('actions.deleteClient') }}
          </button>
          <ModalFooter :label="t('actions.save')" :busy="busy" @cancel="showEdit = false" @submit="saveEdit" />
        </div>
      </form>
    </Modal>

    <ConfirmDialog
      :open="showDelete"
      danger
      :title="t('actions.deleteClient')"
      :message="t('actions.deleteClientConfirm', { name: client.name })"
      :confirm-label="t('actions.delete')"
      @confirm="confirmDelete"
      @cancel="showDelete = false"
    />
  </section>

  <section v-else-if="loadError">
    <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
    <BaseButton class="mt-3" @click="load">{{ t('common.retry') }}</BaseButton>
  </section>

  <section v-else-if="loaded">
    <p style="color: var(--text-muted);">{{ t('common.notFound') }}</p>
  </section>

  <section v-else>
    <p style="color: var(--text-muted);">{{ t('common.loading') }}</p>
  </section>
</template>
