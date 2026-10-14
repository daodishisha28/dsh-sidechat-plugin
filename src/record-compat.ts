/**
 * Central legacy v1 → v2 record handling (upgrade plan §10).
 *
 * Records persist under storageDomain version 1; the record `schema` field is
 * a separate axis. Readers accept both generations and normalize to one
 * working shape; new records are written as v2, and legacy records convert on
 * explicit operation paths. Unknown or corrupt records are never silently
 * treated as empty data — the storage domain's zod validation rejects the
 * open with `invalid-record`, preserving the original bytes for diagnosis.
 */
import { sideChatRecordSchema, type PermissionSnapshot, type SideChatRecord } from './types.ts'

/** DSH SESSION_FORMAT_VERSION the plugin records alongside v4-offset coordinates. */
export const RECORDED_SESSION_FORMAT_VERSION = 4

export type RecordParseFailure = {
  readonly ok: false
  readonly error: string
  readonly raw: unknown
}

export type RecordParseResult =
  | { readonly ok: true; readonly record: SideChatRecord; readonly legacy: boolean }
  | RecordParseFailure

/** Parse one stored record without ever losing the original payload. */
export function parseStoredRecord(raw: unknown): RecordParseResult {
  const parsed = sideChatRecordSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
      raw,
    }
  }
  return { ok: true, record: normalizeRecord(parsed.data), legacy: parsed.data.schema !== 2 }
}

/**
 * Normalize one schema-validated record to the uniform working shape. v1
 * records keep their frozen inclusive positions and schema generation as
 * historical evidence; nothing is numerically converted (the log generation
 * after a DSH migration is unknown).
 */
export function normalizeRecord(record: SideChatRecord): SideChatRecord {
  return {
    ...record,
    permission: record.permission === undefined ? undefined : sanitizePermissionSnapshot(record.permission),
  }
}

/**
 * Explicit operation-path conversion of a legacy record to schema 2: stamps
 * the log format and plugin projection version while preserving every frozen
 * coordinate as legacy evidence (fold/seed epochs are unchanged).
 */
export function promoteRecordToV2(record: SideChatRecord, projectionVersion: string): SideChatRecord {
  if (record.schema === 2) return record
  return {
    ...record,
    schema: 2,
    logFormat: RECORDED_SESSION_FORMAT_VERSION,
    projectionVersion,
  }
}

/**
 * Legacy permission snapshots may contain the reserved PTC `run_code`
 * transport (rejection cause for the new `tools.restrict()`). Remove the
 * transport while keeping every other parent capability — the terminal
 * ceiling never grows on restore.
 */
export function sanitizePermissionSnapshot(permission: PermissionSnapshot): PermissionSnapshot {
  if (!permission.parentTools.includes('run_code')) return permission
  return {
    ...permission,
    parentTools: permission.parentTools.filter(name => name !== 'run_code'),
    transportRunCodeRemoved: true,
  }
}

/** Whether a fold's numeric boundary comparison is safe (same log generation). */
export function hasCurrentCoordinates(fold: FoldRecordLike): boolean {
  return fold.coordinates.epoch === 'v4-offset'
    && fold.coordinates.baselineNextSeq !== undefined
    && fold.coordinates.previewNextSeq !== undefined
}

/** Stale judgment for a child log tail; legacy coordinates never compare. */
export function foldStaleReason(fold: FoldRecordLike, childNextSeq: number): 'stale' | 'legacy-coordinates' | undefined {
  if (fold.coordinates.epoch === 'v4-offset' && fold.coordinates.previewNextSeq !== undefined) {
    return childNextSeq > fold.coordinates.previewNextSeq ? 'stale' : undefined
  }
  return 'legacy-coordinates'
}

interface FoldRecordLike {
  readonly coordinates: {
    readonly epoch: 'v4-offset' | 'legacy-v1'
    readonly baselineNextSeq?: number | undefined
    readonly previewNextSeq?: number | undefined
  }
}
