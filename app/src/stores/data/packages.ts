// ── Packages sold against a project (PackageQuota, board) ─────
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapPackage } from '../../lib/mappers'
import type { DataContext } from './context'
import type { Package } from '../../lib/types'

export function createPackagesSlice(ctx: DataContext) {
  const { requireOrgId } = ctx

  // One-shot pull returned to the caller rather than held in the store — a
  // cold path per board visit, and the only sanctioned way to read packages
  // (components never touch the SDK directly).
  async function loadPackagesForProject(projectId: string): Promise<Package[]> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'packages'),
      where('orgId', '==', orgId),
      where('projectId', '==', projectId),
    ))
    return snap.docs.map((d) => mapPackage(d.id, d.data()))
  }

  return { loadPackagesForProject }
}
