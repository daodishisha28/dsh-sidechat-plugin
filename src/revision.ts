export interface DiffLine {
  readonly kind: 'same' | 'added' | 'removed'
  readonly text: string
}

/** Deterministic line-level LCS diff for bounded Fold revisions. */
export function diffFoldText(left: string, right: string): DiffLine[] {
  const a = left.split(/\r?\n/u)
  const b = right.split(/\r?\n/u)
  const rows = a.length + 1
  const columns = b.length + 1
  const lcs = Array.from({ length: rows }, () => Array<number>(columns).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j]
        ? 1 + lcs[i + 1]![j + 1]!
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i]! }); i += 1; j += 1
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      result.push({ kind: 'added', text: b[j]! }); j += 1
    } else {
      result.push({ kind: 'removed', text: a[i]! }); i += 1
    }
  }
  return result
}
