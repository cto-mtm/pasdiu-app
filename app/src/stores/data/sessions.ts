// ── Recording sessions (shoot bookings) ───────────────────────
import { Timestamp, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { guarded } from './shared'
import type { DataContext } from './context'
import type { RecordingSession } from '../../lib/types'

export function createSessionsSlice(ctx: DataContext) {
  const { requireOrgId } = ctx

  // Quick-create from the calendar: a bare shoot booking, not yet linked to a
  // client/project or capture tasks. Returned to the caller (not held in the
  // store) — Calendar/Schedule keep their own month/week windows and re-query
  // after a create. Doc shape mirrors mapRecordingSession (lib/mappers.ts).
  async function createRecordingSession(input: {
    name: string; location: string; date: Date; notes: string
  }): Promise<RecordingSession> {
    const orgId = requireOrgId()
    const ref = await guarded(() => addDoc(collection(db, 'sessions'), {
      orgId,
      clientId: '',
      projectId: '',
      name: input.name,
      location: input.location,
      date: Timestamp.fromDate(input.date),
      startsAt: null,
      endsAt: null,
      taskIds: [],
      notes: input.notes,
      createdAt: serverTimestamp(),
    }))
    return {
      id: ref.id, orgId, clientId: '', projectId: '',
      name: input.name, location: input.location, date: input.date,
      startsAt: null, endsAt: null, taskIds: [], notes: input.notes, createdAt: new Date(),
    }
  }

  return { createRecordingSession }
}
