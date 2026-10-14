import { describe, expect, it } from 'vitest'
import {
  foldStaleReason,
  hasCurrentCoordinates,
  normalizeRecord,
  parseStoredRecord,
  promoteRecordToV2,
  sanitizePermissionSnapshot,
  RECORDED_SESSION_FORMAT_VERSION,
} from '../src/record-compat.ts'
import type { FoldRecord, PermissionSnapshot, SideChatRecord } from '../src/types.ts'

const FOLD_ID = '11111111-1111-4111-8111-111111111111'
const PROJECTION_VERSION = 'sidechat-trajectory-2026-10-12'

function permission(overrides: Partial<PermissionSnapshot> = {}): PermissionSnapshot {
  return {
    mode: 'readonly',
    parentSandboxMode: 'workspace-write',
    childSandboxMode: 'read-only',
    parentApprovalPolicy: 'ask',
    childApprovalPolicy: 'never',
    parentTools: ['read', 'glob', 'grep', 'run_code'],
    allowedTools: ['read', 'glob', 'grep'],
    capturedAt: 5,
    ...overrides,
  }
}

function v1Record(overrides: Partial<SideChatRecord> = {}): SideChatRecord {
  return {
    schema: 1,
    childSessionId: 'child',
    parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' },
    child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q',
    title: 't',
    status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 7, capturedAt: 2, messages: [] },
    modelStrategy: { kind: 'default' },
    createdAt: 2,
    updatedAt: 3,
    revision: 1,
    folds: [],
    cites: [],
    ...overrides,
  }
}

function v1Fold(overrides: Partial<FoldRecord> = {}): FoldRecord {
  return {
    foldId: FOLD_ID,
    revision: 1,
    state: 'prepared',
    generatedContent: 'legacy preview',
    baselineSeq: 3,
    previewThroughSeq: 9,
    estimatedTokens: 4,
    structureValid: true,
    createdAt: 3,
    updatedAt: 3,
    ...overrides,
  }
}

describe('record-compat v1 legacy handling', () => {
  it('normalizes a v1 record twice with identical business results', () => {
    const raw = v1Record({
      folds: [v1Fold()],
      permission: permission(),
    })
    const once = normalizeRecord(parseStoredRecord(raw).ok ? (parseStoredRecord(raw) as { record: SideChatRecord }).record : raw)
    const twice = normalizeRecord(once)
    expect(twice).toEqual(once)
    expect(parseStoredRecord(raw)).toMatchObject({ ok: true, legacy: true })
    // Frozen evidence survives: schema generation, inclusive positions, seed
    // capture position and the permission snapshot are never rewritten.
    expect(twice.schema).toBe(1)
    expect(twice.folds[0]).toMatchObject({
      baselineSeq: 3,
      previewThroughSeq: 9,
      coordinates: { epoch: 'legacy-v1' },
    })
    expect(twice.seed).toMatchObject({ capturedThroughSeq: 7, coordinates: { epoch: 'legacy-v1' } })
    expect(twice.permission).toMatchObject({ transportRunCodeRemoved: true, parentTools: ['read', 'glob', 'grep'] })
  })

  it('builds legacy v1 fixtures with NO coordinates: the epoch comes from the schema default, never the fixture', () => {
    // Guard against future fixture whitewashing (item 9): a v1 record stored
    // by the pre-domain plugin era cannot carry fold/seed coordinates; the
    // legacy-v1 epoch must be derived by sideChatRecordSchema's defaults at
    // parse time (src/types.ts fold/seed transforms), not pre-filled here.
    const raw = v1Record({ folds: [v1Fold()] })
    expect('coordinates' in raw).toBe(false)
    expect('coordinates' in (raw.seed as Record<string, unknown>)).toBe(false)
    for (const fold of raw.folds) {
      expect('coordinates' in (fold as Record<string, unknown>)).toBe(false)
    }
    const parsed = parseStoredRecord(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.record.folds[0]?.coordinates).toEqual({ epoch: 'legacy-v1' })
      expect(parsed.record.seed.coordinates).toEqual({ epoch: 'legacy-v1' })
    }
  })

  it('removes the run_code transport from a legacy permission snapshot while keeping the ceiling', () => {
    const sanitized = sanitizePermissionSnapshot(permission())
    expect(sanitized.parentTools).not.toContain('run_code')
    expect(sanitized.parentTools).toEqual(['read', 'glob', 'grep'])
    expect(sanitized.transportRunCodeRemoved).toBe(true)
    expect(sanitizePermissionSnapshot(sanitized)).toEqual(sanitized)
    const clean = permission({ parentTools: ['read', 'glob'] })
    expect(sanitizePermissionSnapshot(clean)).toEqual(clean)
  })

  it('blocks commits and stale checks on legacy fold coordinates without numeric conversion', () => {
    const legacy: FoldRecord = { ...v1Fold(), coordinates: { epoch: 'legacy-v1' } }
    expect(hasCurrentCoordinates(legacy)).toBe(false)
    // No trust in `oldSeq + 1`: the tail comparison is refused, not guessed.
    expect(foldStaleReason(legacy, 10)).toBe('legacy-coordinates')
    expect(foldStaleReason(legacy, 4)).toBe('legacy-coordinates')
    const current: FoldRecord = {
      ...v1Fold(),
      baselineSeq: undefined,
      previewThroughSeq: undefined,
      coordinates: { epoch: 'v4-offset', logFormat: RECORDED_SESSION_FORMAT_VERSION, baselineNextSeq: 3, previewNextSeq: 10 },
    }
    expect(hasCurrentCoordinates(current)).toBe(true)
    expect(foldStaleReason(current, 10)).toBeUndefined()
    expect(foldStaleReason(current, 11)).toBe('stale')
  })

  it('keeps committed/withdrawn history and superseded revision states across normalization', () => {
    const raw = v1Record({
      folds: [
        v1Fold({ state: 'committed', committedContent: 'v1', revisionState: 'superseded', committedAt: 4, committedMessageId: 'm1' }),
        v1Fold({ foldId: '22222222-2222-4222-8222-222222222222', revision: 2, state: 'committed', committedContent: 'v2', revisionState: 'withdrawn', withdrawalState: 'committed', withdrawalReason: 'obsolete', withdrawnAt: 6 }),
      ],
    })
    const normalized = normalizeRecord((parseStoredRecord(raw) as { record: SideChatRecord }).record)
    expect(normalized.folds[0]).toMatchObject({ revisionState: 'superseded', committedContent: 'v1', committedMessageId: 'm1' })
    expect(normalized.folds[1]).toMatchObject({
      revisionState: 'withdrawn',
      withdrawalState: 'committed',
      withdrawalReason: 'obsolete',
    })
  })

  it('reports corrupt and unknown-schema records with their original payload instead of empty data', () => {
    const corrupt = { ...v1Record(), title: 42 }
    const parsed = parseStoredRecord(corrupt)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('title')
      expect(parsed.raw).toEqual(corrupt)
    }
    const unknownSchema = { ...v1Record(), schema: 99 }
    const unknown = parseStoredRecord(unknownSchema)
    expect(unknown.ok).toBe(false)
    // A v2 record missing its format stamp is rejected, not silently migrated.
    const stampless = { ...v1Record(), schema: 2 }
    expect(parseStoredRecord(stampless).ok).toBe(false)
  })

  it('promotes a legacy record to v2 only on the explicit operation path', () => {
    const raw = v1Record({ folds: [v1Fold()] })
    const stored = (parseStoredRecord(raw) as { record: SideChatRecord }).record
    const promoted = promoteRecordToV2(stored, PROJECTION_VERSION)
    expect(promoted).toMatchObject({
      schema: 2,
      logFormat: RECORDED_SESSION_FORMAT_VERSION,
      projectionVersion: PROJECTION_VERSION,
    })
    // Frozen evidence stays untouched by the promotion.
    expect(promoted.folds[0]).toMatchObject({ baselineSeq: 3, previewThroughSeq: 9, coordinates: { epoch: 'legacy-v1' } })
    expect(promoteRecordToV2(promoted, PROJECTION_VERSION)).toEqual(promoted)
  })
})
