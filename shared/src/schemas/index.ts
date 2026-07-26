import { z } from 'zod'

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

export const WorkflowStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  optional: z.boolean(),
  clientFacing: z.boolean(),
})

export const WorkflowPipelineSchema = z.object({
  stages: z.array(WorkflowStageSchema).min(1).max(20),
})

export const DeliverableTypeInputSchema = z.object({
  name: z.string().min(1).max(60),
  weight: z.number().int().min(1),
  order: z.number().int().min(0),
})

export const BatchCreateDeliverableSchema = z.object({
  projectId: z.string().min(1),
  subGroupId: z.string().min(1),
  typeId: z.string().min(1),
  names: z.array(z.string().min(1).max(120)).min(1).max(200),
  assigneeUid: z.string().optional(),
  clientVisible: z.boolean().optional(),
  skipStageIds: z.array(z.string()).optional(),
})

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>
export type InviteUserInput = z.infer<typeof InviteUserSchema>
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>
export type WorkflowStageInput = z.infer<typeof WorkflowStageSchema>
export type WorkflowPipelineInput = z.infer<typeof WorkflowPipelineSchema>
export type DeliverableTypeInput = z.infer<typeof DeliverableTypeInputSchema>
export type BatchCreateDeliverableInput = z.infer<typeof BatchCreateDeliverableSchema>
