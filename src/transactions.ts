import type { CiteRecord, FoldRecord, SideChatRecord } from './types.ts'

export function reserveFold(
  record: SideChatRecord,
  fold: Omit<FoldRecord, 'revision'>,
): SideChatRecord {
  if (record.folds.some(item => item.foldId === fold.foldId)) return record
  const revision = record.revision + 1
  return {
    ...record,
    revision,
    updatedAt: Math.max(record.updatedAt, fold.updatedAt),
    folds: [...record.folds, { ...fold, revision }],
  }
}

export function reserveCite(record: SideChatRecord, cite: CiteRecord): SideChatRecord {
  if (record.cites.some(item => item.citeId === cite.citeId)) return record
  return {
    ...record,
    updatedAt: Math.max(record.updatedAt, cite.updatedAt),
    cites: [...record.cites, cite],
  }
}

export function updateFold(
  record: SideChatRecord,
  foldId: string,
  mutate: (fold: FoldRecord) => FoldRecord,
): SideChatRecord {
  let found = false
  const folds = record.folds.map((fold) => {
    if (fold.foldId !== foldId) return fold
    found = true
    return mutate(fold)
  })
  if (!found) throw new Error(`unknown fold: ${foldId}`)
  const target = folds.find(fold => fold.foldId === foldId)!
  return { ...record, folds, updatedAt: Math.max(record.updatedAt, target.updatedAt) }
}

export function updateCite(
  record: SideChatRecord,
  citeId: string,
  mutate: (cite: CiteRecord) => CiteRecord,
): SideChatRecord {
  let found = false
  const cites = record.cites.map((cite) => {
    if (cite.citeId !== citeId) return cite
    found = true
    return mutate(cite)
  })
  if (!found) throw new Error(`unknown cite: ${citeId}`)
  const target = cites.find(cite => cite.citeId === citeId)!
  return { ...record, cites, updatedAt: Math.max(record.updatedAt, target.updatedAt) }
}

/** Promote one committed revision and preserve every older revision as immutable audit history. */
export function promoteFoldRevision(record: SideChatRecord, foldId: string, updatedAt: number): SideChatRecord {
  let found = false
  const folds = record.folds.map((fold) => {
    if (fold.foldId === foldId) {
      found = true
      return { ...fold, revisionState: 'current' as const, updatedAt }
    }
    if (fold.revisionState === 'current' || (fold.revisionState === undefined && fold.state === 'committed')) {
      return { ...fold, revisionState: 'superseded' as const, updatedAt: Math.max(fold.updatedAt, updatedAt) }
    }
    return fold
  })
  if (!found) throw new Error(`unknown fold: ${foldId}`)
  return { ...record, folds, updatedAt: Math.max(record.updatedAt, updatedAt) }
}

/** Soft-withdraw one revision and restore the newest surviving committed revision as current. */
export function withdrawFoldRevision(record: SideChatRecord, foldId: string, reason: string, updatedAt: number): SideChatRecord {
  const target = record.folds.find(fold => fold.foldId === foldId)
  if (target === undefined) throw new Error(`unknown fold: ${foldId}`)
  if (target.state !== 'committed') throw new Error('only a committed Fold may be withdrawn')
  let folds = record.folds.map(fold => fold.foldId === foldId
    ? {
        ...fold,
        revisionState: 'withdrawn' as const,
        withdrawalState: 'pending' as const,
        withdrawalReason: reason,
        withdrawnAt: updatedAt,
        updatedAt,
      }
    : fold)
  const hasCurrent = folds.some(fold => fold.revisionState === 'current')
  if (!hasCurrent) {
    const replacement = folds
      .filter(fold => fold.state === 'committed' && fold.revisionState !== 'withdrawn')
      .sort((left, right) => right.revision - left.revision)[0]
    if (replacement !== undefined) {
      folds = folds.map(fold => fold.foldId === replacement.foldId
        ? { ...fold, revisionState: 'current' as const, updatedAt: Math.max(fold.updatedAt, updatedAt) }
        : fold)
    }
  }
  return { ...record, folds, updatedAt: Math.max(record.updatedAt, updatedAt) }
}
