import { describe, expect, it } from 'vitest'
import type { SideChatRecord } from '../src/types.ts'
import { promoteFoldRevision, reserveCite, reserveFold, updateFold, withdrawFoldRevision } from '../src/transactions.ts'

function record(): SideChatRecord {
  return {
    schema: 1,
    childSessionId: 'child', parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: 't', status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, messages: [] },
    modelStrategy: { kind: 'default' }, createdAt: 2, updatedAt: 2,
    revision: 0, folds: [], cites: [],
  }
}

describe('atomic aggregate reducers', () => {
  it('allocates monotonic immutable Fold revisions and deduplicates ids', () => {
    const fold = {
      foldId: '11111111-1111-4111-8111-111111111111', state: 'prepared' as const,
      generatedContent: 'x', baselineSeq: 1, previewThroughSeq: 3,
      estimatedTokens: 1, structureValid: false, createdAt: 3, updatedAt: 3,
    }
    const once = reserveFold(record(), fold)
    const twice = reserveFold(once, fold)
    expect(once.revision).toBe(1)
    expect(once.folds[0]?.revision).toBe(1)
    expect(twice).toBe(once)
  })

  it('keeps a committed revision immutable while SideChat remains open', () => {
    const prepared = reserveFold(record(), {
      foldId: '11111111-1111-4111-8111-111111111111', state: 'prepared', generatedContent: 'x',
      baselineSeq: 1, previewThroughSeq: 3, estimatedTokens: 1, structureValid: true,
      createdAt: 3, updatedAt: 3,
    })
    const committed = updateFold(prepared, prepared.folds[0]!.foldId, fold => ({
      ...fold, state: 'committed', committedContent: 'final', committedAt: 4, updatedAt: 4,
    }))
    expect(committed.status).toBe('open')
    expect(committed.revision).toBe(1)
    expect(committed.folds[0]).toMatchObject({ state: 'committed', committedContent: 'final', revision: 1 })
  })

  it('deduplicates client-minted cite ids', () => {
    const cite = {
      citeId: '22222222-2222-4222-8222-222222222222', messageId: 'm1', state: 'pending' as const,
      content: 'reply', estimatedTokens: 2, createdAt: 3, updatedAt: 3,
    }
    const once = reserveCite(record(), cite)
    expect(reserveCite(once, cite)).toBe(once)
    expect(once.cites).toHaveLength(1)
  })

  it('promotes, supersedes and softly withdraws immutable revisions', () => {
    const first = reserveFold(record(), {
      foldId: '11111111-1111-4111-8111-111111111111', state: 'committed', generatedContent: 'v1',
      committedContent: 'v1', baselineSeq: 1, previewThroughSeq: 1, estimatedTokens: 1,
      structureValid: true, createdAt: 3, updatedAt: 3,
    })
    const firstCurrent = promoteFoldRevision(first, first.folds[0]!.foldId, 4)
    const second = reserveFold(firstCurrent, {
      foldId: '22222222-2222-4222-8222-222222222222', state: 'committed', generatedContent: 'v2',
      committedContent: 'v2', baselineSeq: 2, previewThroughSeq: 2, estimatedTokens: 1,
      structureValid: true, supersedesRevision: 1, createdAt: 5, updatedAt: 5,
    })
    const promoted = promoteFoldRevision(second, second.folds[1]!.foldId, 6)
    expect(promoted.folds.map(fold => fold.revisionState)).toEqual(['superseded', 'current'])
    const withdrawn = withdrawFoldRevision(promoted, second.folds[1]!.foldId, 'obsolete', 7)
    expect(withdrawn.folds.map(fold => fold.revisionState)).toEqual(['current', 'withdrawn'])
    expect(withdrawn.folds[1]).toMatchObject({ withdrawalState: 'pending', withdrawalReason: 'obsolete' })
  })

  it('keeps a late out-of-order commit as superseded audit instead of regressing current', () => {
    const prepared = reserveFold(record(), {
      foldId: '11111111-1111-4111-8111-111111111111', state: 'prepared', generatedContent: 'v1',
      baselineSeq: 1, previewThroughSeq: 1, estimatedTokens: 1, structureValid: true, createdAt: 3, updatedAt: 3,
    })
    const second = reserveFold(prepared, {
      foldId: '22222222-2222-4222-8222-222222222222', state: 'committed', generatedContent: 'v2',
      committedContent: 'v2', baselineSeq: 2, previewThroughSeq: 2, estimatedTokens: 1,
      structureValid: true, createdAt: 4, updatedAt: 4,
    })
    const secondCurrent = promoteFoldRevision(second, '22222222-2222-4222-8222-222222222222', 5)
    expect(secondCurrent.folds.map(fold => fold.revisionState)).toEqual([undefined, 'current'])
    const lateCommitted = updateFold(secondCurrent, '11111111-1111-4111-8111-111111111111', fold => ({
      ...fold, state: 'committed' as const, committedContent: 'v1', committedAt: 6, updatedAt: 6,
    }))
    const fenced = promoteFoldRevision(lateCommitted, '11111111-1111-4111-8111-111111111111', 7)
    expect(fenced.folds.map(fold => fold.revisionState)).toEqual(['superseded', 'current'])
    expect(fenced.folds[0]).toMatchObject({ revision: 1, state: 'committed', committedContent: 'v1' })
    expect(fenced.folds[1]).toMatchObject({ revision: 2, committedContent: 'v2' })
  })

  it('still demotes an older current when a newer revision is promoted in order', () => {
    const first = reserveFold(record(), {
      foldId: '11111111-1111-4111-8111-111111111111', state: 'committed', generatedContent: 'v1',
      committedContent: 'v1', baselineSeq: 1, previewThroughSeq: 1, estimatedTokens: 1,
      structureValid: true, createdAt: 3, updatedAt: 3,
    })
    const firstCurrent = promoteFoldRevision(first, '11111111-1111-4111-8111-111111111111', 4)
    const second = reserveFold(firstCurrent, {
      foldId: '22222222-2222-4222-8222-222222222222', state: 'committed', generatedContent: 'v2',
      committedContent: 'v2', baselineSeq: 2, previewThroughSeq: 2, estimatedTokens: 1,
      structureValid: true, createdAt: 5, updatedAt: 5,
    })
    const promoted = promoteFoldRevision(second, '22222222-2222-4222-8222-222222222222', 6)
    expect(promoted.folds.map(fold => fold.revisionState)).toEqual(['superseded', 'current'])
  })
})
