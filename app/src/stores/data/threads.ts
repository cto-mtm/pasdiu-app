// ── Versions + threaded notes (Iteration Room) ────────────────
// Stateless: nothing here is cached in the store, so these are plain module
// functions rather than a context-bound slice. Callers hold the results in
// component state for as long as the surface is open.
import { addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapNote, mapVersion } from '../../lib/mappers'
import { guarded } from './shared'
import type { Note, Version } from '../../lib/types'

// ── Thread factory ──────────────────────────────────────────────
// Both tasks and deliverables have identical version+note subcollections.
// This factory produces a full set of thread operations for any parent
// collection, eliminating the 5 matched-pair duplication that existed before.
function createThread(parentCollection: string) {
  async function loadVersions(parentId: string): Promise<Version[]> {
    const snap = await getDocs(collection(db, parentCollection, parentId, 'versions'))
    return snap.docs
      .map((d) => mapVersion(d.id, d.data()))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
  }

  async function loadNotes(parentId: string): Promise<Note[]> {
    const snap = await getDocs(query(collection(db, parentCollection, parentId, 'notes'), orderBy('createdAt', 'asc')))
    return snap.docs.map((d) => mapNote(d.id, d.data()))
  }

  async function addNote(parentId: string, versionId: string, authorUid: string, body: string): Promise<void> {
    await guarded(() => addDoc(collection(db, parentCollection, parentId, 'notes'), {
      versionId, authorUid, body, resolved: false, createdAt: serverTimestamp(),
    }))
  }

  async function setNoteResolved(parentId: string, noteId: string, resolved: boolean): Promise<void> {
    await guarded(() => updateDoc(doc(db, parentCollection, parentId, 'notes', noteId), { resolved }))
  }

  async function addVersion(parentId: string, note: string, mediaUrl = ''): Promise<Version> {
    const existing = await loadVersions(parentId)
    const label = `v${existing.length + 1}`
    const ref = await guarded(() => addDoc(collection(db, parentCollection, parentId, 'versions'), {
      label, note, createdAt: serverTimestamp(), mediaUrl,
    }))
    return { id: ref.id, label, note, createdAt: new Date(), mediaUrl }
  }

  return { loadVersions, loadNotes, addNote, setNoteResolved, addVersion }
}

// ── Task-level thread ───────────────────────────────────────────
const taskThread = createThread('tasks')

export const loadVersions = (taskId: string) => taskThread.loadVersions(taskId)
export const loadNotes = (taskId: string) => taskThread.loadNotes(taskId)
export const addNote = (taskId: string, versionId: string, authorUid: string, body: string) =>
  taskThread.addNote(taskId, versionId, authorUid, body)
export const setNoteResolved = (taskId: string, noteId: string, resolved: boolean) =>
  taskThread.setNoteResolved(taskId, noteId, resolved)
export const addVersion = (taskId: string, note: string, mediaUrl = '') =>
  taskThread.addVersion(taskId, note, mediaUrl)

// ── Deliverable-level thread ────────────────────────────────────
// THE defining property of the deliverable (README: finding 1): versions and
// feedback live on the deliverable so they survive stage handoffs. Any task
// that belongs to a deliverable reads/writes THIS thread — a per-task silo
// would recreate exactly the recorder→editor lost-notes problem the entity
// exists to solve.
const deliverableThread = createThread('deliverables')

export const loadDeliverableVersions = (deliverableId: string) => deliverableThread.loadVersions(deliverableId)
export const loadDeliverableNotes = (deliverableId: string) => deliverableThread.loadNotes(deliverableId)
export const addDeliverableVersion = (deliverableId: string, note: string, mediaUrl = '') =>
  deliverableThread.addVersion(deliverableId, note, mediaUrl)
export const addDeliverableNote = (deliverableId: string, versionId: string, authorUid: string, body: string) =>
  deliverableThread.addNote(deliverableId, versionId, authorUid, body)
export const setDeliverableNoteResolved = (deliverableId: string, noteId: string, resolved: boolean) =>
  deliverableThread.setNoteResolved(deliverableId, noteId, resolved)
