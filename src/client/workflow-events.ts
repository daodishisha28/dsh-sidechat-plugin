import type { DiffLine } from '../revision.ts'
import type { FoldRecord, PermissionMode, SeedMode, UsageReport } from '../types.ts'

export interface FoldPreviewRequest {
  readonly sessionId: string
  readonly fold: FoldRecord
}

export interface RevisionComparisonRequest {
  readonly sessionId: string
  readonly left: number
  readonly right: number
  readonly lines: readonly DiffLine[]
}

export type CommandWorkflowRequest =
  | {
      readonly kind: 'permission-choice'
      readonly sessionId: string
      readonly seedMode: SeedMode
    }
  | {
      readonly kind: 'create'
      readonly sessionId: string
      readonly seedMode: SeedMode
      readonly permissionMode: PermissionMode
    }
  | {
      readonly kind: 'withdraw'
      readonly sessionId: string
      readonly foldId: string
      readonly revision: number
    }
  | {
      readonly kind: 'cite-message'
      readonly sessionId: string
      readonly childSessionId: string
      readonly crossParent: boolean
    }
  | {
      readonly kind: 'notice'
      readonly sessionId: string
      readonly title: string
      readonly message: string
      readonly tone?: 'success' | 'warning' | 'error'
    }

const foldPreviewListeners = new Map<string, Set<(fold: FoldRecord) => void>>()
const revisionComparisonListeners = new Map<string, Set<(request: RevisionComparisonRequest) => void>>()
const refreshListeners = new Map<string, Set<() => void>>()
const usageListeners = new Map<string, Set<(report: UsageReport) => void>>()
const commandWorkflowListeners = new Map<string, Set<(request: CommandWorkflowRequest) => void>>()

export function showFoldPreview(request: FoldPreviewRequest): boolean {
  const listeners = foldPreviewListeners.get(request.sessionId)
  if (listeners === undefined || listeners.size === 0) return false
  for (const listener of listeners) listener(request.fold)
  return true
}

export function showRevisionComparison(request: RevisionComparisonRequest): boolean {
  const listeners = revisionComparisonListeners.get(request.sessionId)
  if (listeners === undefined || listeners.size === 0) return false
  for (const listener of listeners) listener(request)
  return true
}

export function showUsageReport(sessionId: string, report: UsageReport): boolean {
  const listeners = usageListeners.get(sessionId)
  if (listeners === undefined || listeners.size === 0) return false
  for (const listener of listeners) listener(report)
  return true
}

/** Open one command-owned workflow inside the current DSH Session surface. */
export function showCommandWorkflow(request: CommandWorkflowRequest): boolean {
  const listeners = commandWorkflowListeners.get(request.sessionId)
  if (listeners === undefined || listeners.size === 0) return false
  for (const listener of listeners) listener(request)
  return true
}

export function onFoldPreview(sessionId: string, listener: (fold: FoldRecord) => void): () => void {
  const listeners = foldPreviewListeners.get(sessionId) ?? new Set()
  listeners.add(listener)
  foldPreviewListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) foldPreviewListeners.delete(sessionId)
  }
}

export function onRevisionComparison(sessionId: string, listener: (request: RevisionComparisonRequest) => void): () => void {
  const listeners = revisionComparisonListeners.get(sessionId) ?? new Set()
  listeners.add(listener)
  revisionComparisonListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) revisionComparisonListeners.delete(sessionId)
  }
}

export function refreshSideChatIdentity(sessionId: string): void {
  for (const listener of refreshListeners.get(sessionId) ?? []) listener()
}

export function onSideChatIdentityRefresh(sessionId: string, listener: () => void): () => void {
  const listeners = refreshListeners.get(sessionId) ?? new Set()
  listeners.add(listener)
  refreshListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) refreshListeners.delete(sessionId)
  }
}

export function onUsageReport(sessionId: string, listener: (report: UsageReport) => void): () => void {
  const listeners = usageListeners.get(sessionId) ?? new Set()
  listeners.add(listener)
  usageListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) usageListeners.delete(sessionId)
  }
}


export function onCommandWorkflow(
  sessionId: string,
  listener: (request: CommandWorkflowRequest) => void,
): () => void {
  const listeners = commandWorkflowListeners.get(sessionId) ?? new Set()
  listeners.add(listener)
  commandWorkflowListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) commandWorkflowListeners.delete(sessionId)
  }
}
