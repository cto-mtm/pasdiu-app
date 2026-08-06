// ── The ACTIVE org's document (workflow pipeline) ──────────────
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { i18n } from '../../i18n'
import { useToastStore } from '../toast'
import { WorkflowPipelineSchema } from '../../lib/types'
import { guarded } from './shared'
import type { DataContext } from './context'
import type { WorkflowStage } from '../../lib/types'

export function createOrgSlice(ctx: DataContext) {
  const { requireOrgId } = ctx

  // Managers only; rules gate the org doc to name/pipeline/
  // defaultCapacityPointsPerDay. No local patch: the auth store
  // live-subscribes to the org doc, so `auth.org` refreshes itself.
  // Stage edits only affect FUTURE deliverables — in-flight ones carry their
  // own stage snapshot taken at creation.
  //
  // Validated against the shared schema before it goes anywhere: the rules
  // gate WHICH keys a manager may change on an org, never the pipeline's
  // contents, so this is the only thing standing between a UI bug and a
  // malformed pipeline that would break every future batch create. Writing
  // `parsed.data` also normalizes it (durationHours defaults to 0).
  async function updateOrgPipeline(stages: WorkflowStage[]): Promise<void> {
    const orgId = requireOrgId()
    const parsed = WorkflowPipelineSchema.safeParse({ stages })
    if (!parsed.success) {
      useToastStore().error(i18n.global.t('common.saveError'))
      throw new Error('invalid pipeline')
    }
    await guarded(() => updateDoc(doc(db, 'orgs', orgId), { pipeline: parsed.data }))
  }

  return { updateOrgPipeline }
}
