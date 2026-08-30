import { z } from 'zod'

export const sessionIdSchema = z.string().min(1)
export const messageIdSchema = z.string().min(1)
export const operationIdSchema = z.uuid()
export const nonNegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const seedModeSchema = z.union([
  z.literal('tail:1'),
  z.literal('task'),
  z.literal('none'),
  z.literal('tail:2'),
  z.literal('tail:4'),
  z.literal('pick:1'),
  z.literal('pick:many'),
  z.literal('turn'),
  z.literal('selection'),
  z.literal('summary'),
])
export type SeedMode = z.infer<typeof seedModeSchema>

export const permissionModeSchema = z.union([
  z.literal('inherit'),
  z.literal('readonly'),
])
export type PermissionMode = z.infer<typeof permissionModeSchema>

export const sandboxModeSchema = z.union([
  z.literal('read-only'),
  z.literal('workspace-write'),
  z.literal('danger-full-access'),
])

export const approvalPolicySchema = z.union([z.literal('ask'), z.literal('never')])

export const permissionSnapshotSchema = z.object({
  mode: permissionModeSchema,
  parentAgentPreset: z.string().min(1).optional(),
  childAgentPreset: z.string().min(1).optional(),
  parentSandboxMode: sandboxModeSchema,
  childSandboxMode: sandboxModeSchema,
  parentApprovalPolicy: approvalPolicySchema,
  childApprovalPolicy: approvalPolicySchema,
  parentTools: z.array(z.string().min(1)),
  allowedTools: z.array(z.string().min(1)),
  capturedAt: nonNegativeIntegerSchema,
})
export type PermissionSnapshot = z.infer<typeof permissionSnapshotSchema>

export const seedMessageSchema = z.object({
  messageId: messageIdSchema,
  role: z.union([z.literal('user'), z.literal('assistant')]),
  text: z.string().min(1),
  seq: nonNegativeIntegerSchema,
  turn: z.number().int().positive().optional(),
  selection: z.object({
    start: nonNegativeIntegerSchema,
    end: z.number().int().positive(),
  }).optional(),
})
export type SeedMessage = z.infer<typeof seedMessageSchema>

export const tokenUsageSchema = z.object({
  inputTokens: nonNegativeIntegerSchema,
  outputTokens: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema.optional(),
  cacheReadTokens: nonNegativeIntegerSchema.optional(),
  cacheWriteTokens: nonNegativeIntegerSchema.optional(),
  reasoningTokens: nonNegativeIntegerSchema.optional(),
})
export type TokenUsageRecord = z.infer<typeof tokenUsageSchema>

export const usageTotalsSchema = z.object({
  uncachedInputTokens: nonNegativeIntegerSchema,
  outputTokens: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema,
  cacheReadTokens: nonNegativeIntegerSchema.optional(),
  cacheWriteTokens: nonNegativeIntegerSchema.optional(),
  reasoningTokens: nonNegativeIntegerSchema.optional(),
  routes: z.array(z.object({ provider: z.string().min(1), model: z.string().min(1) })).optional(),
})
export type UsageTotals = z.infer<typeof usageTotalsSchema>

export const sessionUsageSchema = z.object({
  complete: z.boolean(),
  completedTurns: nonNegativeIntegerSchema,
  incompleteTurns: nonNegativeIntegerSchema,
  totals: usageTotalsSchema.optional(),
  latestTurn: usageTotalsSchema.optional(),
})
export type SessionUsage = z.infer<typeof sessionUsageSchema>

export const seedProvenanceSchema = z.object({
  mode: seedModeSchema,
  parentSessionId: sessionIdSchema,
  capturedThroughSeq: nonNegativeIntegerSchema,
  capturedAt: nonNegativeIntegerSchema,
  messages: z.array(seedMessageSchema),
  summary: z.object({
    text: z.string().min(1),
    sourceMessageIds: z.array(messageIdSchema).min(1),
    estimatedTokens: nonNegativeIntegerSchema,
    generatedAt: nonNegativeIntegerSchema,
    model: z.lazy(() => modelSelectionSchema).optional(),
    usage: tokenUsageSchema.optional(),
  }).optional(),
  generatedContext: z.object({
    kind: z.literal('task'),
    text: z.string().min(1),
    sourceMessageIds: z.array(messageIdSchema),
    model: z.lazy(() => modelSelectionSchema),
    usage: tokenUsageSchema.optional(),
    generatedAt: nonNegativeIntegerSchema,
    droppedOlderMessages: nonNegativeIntegerSchema,
  }).optional(),
})
export type SeedProvenance = z.infer<typeof seedProvenanceSchema>

export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})
export type ModelSelection = z.infer<typeof modelSelectionSchema>

export const modelStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default') }),
  z.object({ kind: z.literal('inherit') }),
  z.object({ kind: z.literal('custom'), selection: modelSelectionSchema }),
])
export type ModelStrategy = z.infer<typeof modelStrategySchema>

export const sessionIdentitySchema = z.object({
  createdAt: nonNegativeIntegerSchema,
  cwd: z.string().optional(),
})
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>

export const operationStateSchema = z.union([
  z.literal('generating'),
  z.literal('prepared'),
  z.literal('pending'),
  z.literal('committed'),
  z.literal('failed'),
])
export type OperationState = z.infer<typeof operationStateSchema>

export const foldModeSchema = z.union([z.literal('full'), z.literal('incremental')])
export type FoldMode = z.infer<typeof foldModeSchema>

export const foldRevisionStateSchema = z.union([
  z.literal('current'),
  z.literal('superseded'),
  z.literal('withdrawn'),
])
export type FoldRevisionState = z.infer<typeof foldRevisionStateSchema>

export const detailPointerSchema = z.object({
  label: z.string().trim().min(1).max(160),
  uri: z.string().min(1),
  messageId: messageIdSchema,
})
export type DetailPointer = z.infer<typeof detailPointerSchema>

export const foldRecordSchema = z.object({
  foldId: operationIdSchema,
  revision: z.number().int().positive(),
  state: operationStateSchema,
  generatedContent: z.string(),
  committedContent: z.string().optional(),
  baselineSeq: nonNegativeIntegerSchema,
  previewThroughSeq: nonNegativeIntegerSchema,
  estimatedTokens: nonNegativeIntegerSchema,
  structureValid: z.boolean(),
  createdAt: nonNegativeIntegerSchema,
  updatedAt: nonNegativeIntegerSchema,
  committedAt: nonNegativeIntegerSchema.optional(),
  failure: z.string().optional(),
  mode: foldModeSchema.optional(),
  baseRevision: z.number().int().positive().optional(),
  supersedesRevision: z.number().int().positive().optional(),
  revisionState: foldRevisionStateSchema.optional(),
  detailPointers: z.array(detailPointerSchema).max(5).optional(),
  withdrawalState: operationStateSchema.optional(),
  withdrawalReason: z.string().max(2_000).optional(),
  withdrawnAt: nonNegativeIntegerSchema.optional(),
})
export type FoldRecord = z.infer<typeof foldRecordSchema>

export const citeRecordSchema = z.object({
  citeId: operationIdSchema,
  messageId: messageIdSchema,
  state: operationStateSchema,
  content: z.string().min(1),
  estimatedTokens: nonNegativeIntegerSchema,
  createdAt: nonNegativeIntegerSchema,
  updatedAt: nonNegativeIntegerSchema,
  committedAt: nonNegativeIntegerSchema.optional(),
  failure: z.string().optional(),
  targetSessionId: sessionIdSchema.optional(),
  target: sessionIdentitySchema.optional(),
  crossParent: z.boolean().optional(),
})
export type CiteRecord = z.infer<typeof citeRecordSchema>

export const sideChatStatusSchema = z.union([
  z.literal('open'),
  z.literal('archived'),
  z.literal('abandoned'),
  z.literal('orphaned'),
])
export type SideChatStatus = z.infer<typeof sideChatStatusSchema>

export const sideChatRecordSchema = z.object({
  schema: z.literal(1),
  childSessionId: sessionIdSchema,
  parentSessionId: sessionIdSchema,
  parent: sessionIdentitySchema,
  child: sessionIdentitySchema,
  question: z.string().min(1),
  title: z.string().min(1),
  status: sideChatStatusSchema,
  statusBeforeOrphan: z.union([
    z.literal('open'), z.literal('archived'), z.literal('abandoned'),
  ]).optional(),
  seed: seedProvenanceSchema,
  permission: permissionSnapshotSchema.optional(),
  modelStrategy: modelStrategySchema,
  selectedModel: modelSelectionSchema.optional(),
  parentUsageBaseline: sessionUsageSchema.optional(),
  createdAt: nonNegativeIntegerSchema,
  updatedAt: nonNegativeIntegerSchema,
  revision: nonNegativeIntegerSchema,
  folds: z.array(foldRecordSchema),
  cites: z.array(citeRecordSchema),
})
export type SideChatRecord = z.infer<typeof sideChatRecordSchema>

export const createSideChatRequestSchema = z.object({
  parentSessionId: sessionIdSchema,
  question: z.string().trim().min(1).max(20_000),
  seedMode: seedModeSchema,
  permissionMode: permissionModeSchema.default('readonly'),
  pickMessageId: messageIdSchema.optional(),
  selectedMessageIds: z.array(messageIdSchema).min(1).max(8).optional(),
  turn: z.number().int().positive().optional(),
  selection: z.object({
    messageId: messageIdSchema,
    start: nonNegativeIntegerSchema,
    end: z.number().int().positive(),
  }).optional(),
  summarySourceMessageIds: z.array(messageIdSchema).min(1).max(8).optional(),
  modelStrategy: modelStrategySchema,
}).superRefine((value, ctx) => {
  if (value.seedMode === 'pick:1' && value.pickMessageId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['pickMessageId'], message: 'pick:1 requires pickMessageId' })
  }
  if (value.seedMode === 'pick:many' && value.selectedMessageIds === undefined) {
    ctx.addIssue({ code: 'custom', path: ['selectedMessageIds'], message: 'pick:many requires selectedMessageIds' })
  }
  if (value.seedMode === 'turn' && value.turn === undefined) {
    ctx.addIssue({ code: 'custom', path: ['turn'], message: 'turn seed requires turn' })
  }
  if (value.seedMode === 'selection' && value.selection === undefined) {
    ctx.addIssue({ code: 'custom', path: ['selection'], message: 'selection seed requires a text range' })
  }
  if (value.seedMode === 'summary' && value.summarySourceMessageIds === undefined) {
    ctx.addIssue({ code: 'custom', path: ['summarySourceMessageIds'], message: 'summary seed requires source messages' })
  }
})
export type CreateSideChatRequest = z.infer<typeof createSideChatRequestSchema>

export const listSideChatsRequestSchema = z.object({ parentSessionId: sessionIdSchema })
export const getSideChatRequestSchema = z.object({ sessionId: sessionIdSchema })
export const usageReportSchema = z.object({
  childSessionId: sessionIdSchema,
  child: sessionUsageSchema,
  parentDeltaSinceCreate: z.object({
    available: z.boolean(),
    complete: z.boolean(),
    totals: usageTotalsSchema.optional(),
  }),
  seedGeneration: z.object({
    kind: z.union([z.literal('task'), z.literal('summary')]),
    model: modelSelectionSchema.optional(),
    usage: tokenUsageSchema.optional(),
  }).optional(),
  noReplyModelCalls: z.literal(0),
})
export type UsageReport = z.infer<typeof usageReportSchema>
export const prepareFoldRequestSchema = z.object({
  childSessionId: sessionIdSchema,
  foldId: operationIdSchema,
  mode: foldModeSchema.default('full'),
  baseRevision: z.number().int().positive().optional(),
})
export const commitFoldRequestSchema = z.object({
  childSessionId: sessionIdSchema,
  foldId: operationIdSchema,
  content: z.string().trim().min(1).max(20_000),
  allowStale: z.boolean().default(false),
})
export const citeRequestSchema = z.object({
  childSessionId: sessionIdSchema,
  messageId: messageIdSchema,
  citeId: operationIdSchema,
})
export const crossCiteRequestSchema = citeRequestSchema.extend({ targetSessionId: sessionIdSchema })
export const treeRequestSchema = z.object({ rootSessionId: sessionIdSchema })
export const workspaceSideChatsRequestSchema = z.object({ targetSessionId: sessionIdSchema })
export const withdrawFoldRequestSchema = z.object({
  childSessionId: sessionIdSchema,
  foldId: operationIdSchema,
  reason: z.string().trim().min(1).max(2_000),
})
export const setStatusRequestSchema = z.object({
  childSessionId: sessionIdSchema,
  action: z.union([z.literal('archive'), z.literal('restore'), z.literal('abandon')]),
})

export const assistantChoiceSchema = z.object({
  messageId: messageIdSchema,
  text: z.string().min(1),
  seq: nonNegativeIntegerSchema,
})
export type AssistantChoice = z.infer<typeof assistantChoiceSchema>

export const sideChatSummarySchema = z.object({
  childSessionId: sessionIdSchema,
  parentSessionId: sessionIdSchema,
  title: z.string(),
  status: sideChatStatusSchema,
  revision: nonNegativeIntegerSchema,
  model: z.string(),
  updatedAt: nonNegativeIntegerSchema,
  workspace: z.string().optional(),
})
export type SideChatSummary = z.infer<typeof sideChatSummarySchema>

export const sideChatTreeItemSchema = sideChatSummarySchema.extend({ depth: nonNegativeIntegerSchema })
export type SideChatTreeItem = z.infer<typeof sideChatTreeItemSchema>

export const revisionComparisonSchema = z.object({
  leftRevision: z.number().int().positive(),
  rightRevision: z.number().int().positive(),
  left: z.string(),
  right: z.string(),
})

export const sideChatReadEntrySchema = z.object({
  messageId: messageIdSchema,
  role: z.union([z.literal('user'), z.literal('assistant')]),
  text: z.string(),
  seq: nonNegativeIntegerSchema,
})
export type SideChatReadEntry = z.infer<typeof sideChatReadEntrySchema>

export const createSideChatValueSchema = z.object({
  childSessionId: sessionIdSchema,
  record: sideChatRecordSchema,
  modelSelectionChangesGlobalDefault: z.boolean(),
})
export const listSideChatsValueSchema = z.object({ items: z.array(sideChatSummarySchema) })
export const getSideChatValueSchema = z.object({ record: sideChatRecordSchema.nullable() })
export const prepareFoldValueSchema = z.object({ fold: foldRecordSchema })
export const commitOperationValueSchema = z.object({ state: operationStateSchema })
export const setStatusValueSchema = z.object({ record: sideChatRecordSchema })
export const listAssistantMessagesValueSchema = z.object({ items: z.array(assistantChoiceSchema) })

export interface SideChatResult<T> {
  readonly ok: true
  readonly value: T
}

export interface SideChatFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

export type SideChatOutcome<T> = SideChatResult<T> | SideChatFailure

export function success<T>(value: T): SideChatResult<T> {
  return { ok: true, value }
}

export function failure(code: string, message: string): SideChatFailure {
  return { ok: false, error: { code, message } }
}
