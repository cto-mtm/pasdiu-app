import { z } from 'zod'
import { MAX_STAGE_DURATION_HOURS, MAX_STAGES, STAGE_NAME_MAX } from '../workflow.js'

export const RoleSchema = z.enum(['admin', 'pm', 'contractor', 'client'])

export const PlanSchema = z.enum(['free', 'studio', 'agency'])

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
})

export const InviteUserSchema = z.object({
  email: z.string().email(),
  role: RoleSchema,
  clientId: z.string().optional(),
})

export const AcceptInviteSchema = z.object({
  inviteId: z.string().min(1),
})

// ── Deliverables & Workflow schemas ──────────────────────────────────────────

// Bounds come from ./workflow.js so the editor's inputs, this schema and the
// batch endpoint's clamp can never disagree about the same number.
export const WorkflowStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(STAGE_NAME_MAX),
  optional: z.boolean(),
  clientFacing: z.boolean(),
  // Defaulted, not required: pipelines written before durations existed parse
  // as 0-hour stages, which reproduces the old same-date-for-every-task math.
  durationHours: z.number().int().min(0).max(MAX_STAGE_DURATION_HOURS).default(0),
})

export const WorkflowPipelineSchema = z.object({
  stages: z.array(WorkflowStageSchema).min(1).max(MAX_STAGES),
})

export const DeliverableTypeInputSchema = z.object({
  name: z.string().min(1).max(60),
  weight: z.number().int().min(1),
  order: z.number().int().min(0),
})

export const BatchCreateDeliverableSchema = z.object({
  projectId: z.string().min(1),
  subGroupId: z.string().min(1).optional(),
  subGroupName: z.string().min(1).max(60).optional(),
  typeId: z.string().optional(),
  names: z.array(z.string().min(1).max(120)).min(1).max(200),
  stageAssignees: z.record(z.string(), z.array(z.string().min(1))).optional(),
  clientVisible: z.boolean().optional(),
  skipStageIds: z.array(z.string()).optional(),
  dueStartAt: z.string().optional(),
  dueEndAt: z.string().optional(),
  // How each deliverable's anchor date is read once stage durations chain off
  // it: 'end' back-schedules so the LAST stage lands on the date (the meaning
  // "Due by" has always had, hence the default), 'start' runs forward so the
  // FIRST stage begins there. With every duration at 0 the two are identical.
  scheduleMode: z.enum(['start', 'end']).default('end'),
}).refine(
  (d) => d.subGroupId || d.subGroupName,
  { message: 'Either subGroupId or subGroupName is required' }
)

export const PackageLineSchema = z.object({
  typeId: z.string().min(1),
  quantity: z.number().int().min(1),
  period: z.enum(['month', 'quarter', 'once']),
})

export const PackageSchema = z.object({
  name: z.string().min(1).max(100),
  clientId: z.string().min(1),
  projectId: z.string().min(1),
  lines: z.array(PackageLineSchema).min(1).max(20),
  startsOn: z.string().optional(),
  active: z.boolean().optional(),
})

export const RecordingSessionSchema = z.object({
  name: z.string().min(1).max(100),
  clientId: z.string().min(1),
  projectId: z.string().min(1),
  location: z.string().max(200).optional(),
  date: z.string().min(1),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  taskIds: z.array(z.string().min(1)).optional(),
  notes: z.string().max(2000).optional(),
})

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>
export type InviteUserInput = z.infer<typeof InviteUserSchema>
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>
export type WorkflowStageInput = z.infer<typeof WorkflowStageSchema>
export type WorkflowPipelineInput = z.infer<typeof WorkflowPipelineSchema>
export type DeliverableTypeInput = z.infer<typeof DeliverableTypeInputSchema>
export type BatchCreateDeliverableInput = z.infer<typeof BatchCreateDeliverableSchema>
export type PackageLineInput = z.infer<typeof PackageLineSchema>
export type PackageInput = z.infer<typeof PackageSchema>
export type RecordingSessionInput = z.infer<typeof RecordingSessionSchema>
