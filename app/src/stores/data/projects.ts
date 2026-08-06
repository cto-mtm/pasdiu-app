// ── Projects ──────────────────────────────────────────────────
import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapProject } from '../../lib/mappers'
import { createPaginator, guarded, upsert } from './shared'
import type { DataContext } from './context'
import type { MetaField, Project } from '../../lib/types'

export function createProjectsSlice(ctx: DataContext) {
  const { projects, isFresh, markLoaded, listen, applyChanges, requireOrgId, onReset } = ctx

  const paginator = createPaginator(onReset)

  // Scoped pull with a TTL memo — revisiting a client detail page within the
  // freshness window costs nothing; its refresh control passes `force`.
  async function loadProjectsForClient(clientId: string, force = false): Promise<void> {
    if (!force && isFresh(`clientProjects:${clientId}`)) return
    const orgId = requireOrgId()
    const q = query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
    )
    const snap = await getDocs(q)
    snap.forEach((d) => upsert(projects.value, mapProject(d.id, d.data())))
    markLoaded(`clientProjects:${clientId}`)
  }

  // Live listener over the first PAGE_SIZE projects by document id;
  // loadMoreProjects appends past the window with one-shot reads.
  async function loadAllProjects(): Promise<void> {
    const orgId = requireOrgId()
    return listen('projects', query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      limit(paginator.mayHaveMore.value ? undefined! : 1000),
    ), (snap) => {
      applyChanges(projects, snap, mapProject)
      paginator.setCursor(snap.docs[snap.docs.length - 1] ?? null)
      paginator.mayHaveMore.value = snap.docs.length === 1000
    })
  }

  async function loadMoreProjects(): Promise<void> {
    if (!paginator.canLoadMore()) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      startAfter(paginator.getCursor()),
      limit(1000),
    ))
    snap.forEach((d) => upsert(projects.value, mapProject(d.id, d.data())))
    paginator.applyCursor(snap.docs)
  }

  async function loadProject(id: string): Promise<Project | undefined> {
    const snap = await getDoc(doc(db, 'projects', id))
    if (!snap.exists()) return undefined
    const p = mapProject(snap.id, snap.data())
    if (p.orgId !== requireOrgId()) return undefined
    upsert(projects.value, p)
    return p
  }

  function getProject(id: string): Project | undefined {
    return projects.value.find((p) => p.id === id)
  }

  async function createProject(clientId: string, name: string, defaultView: 'kanban' | 'list' | 'deliverables'): Promise<Project> {
    const orgId = requireOrgId()
    const brief = { brandGuidelinesUrl: '', sopUrl: '', links: [], fields: [] as MetaField[] }
    const meta: MetaField[] = []
    const ref = await guarded(() => addDoc(collection(db, 'projects'), { orgId, clientId, name, defaultView, brief, meta }))
    const p: Project = { id: ref.id, orgId, clientId, name, defaultView, brief, meta }
    upsert(projects.value, p)
    return p
  }

  async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'defaultView' | 'brief' | 'meta'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'projects', id), patch))
    const local = getProject(id)
    if (local) Object.assign(local, patch)
  }

  return {
    projectsMayHaveMore: paginator.mayHaveMore,
    loadProjectsForClient, loadAllProjects, loadMoreProjects, loadProject, getProject,
    createProject, updateProject,
  }
}
