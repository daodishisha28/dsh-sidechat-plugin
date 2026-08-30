import { describe, expect, it } from 'vitest'
import { diffFoldText } from '../src/revision.ts'

describe('Fold revision comparison', () => {
  it('produces a deterministic line diff without mutating either immutable revision', () => {
    expect(diffFoldText('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'B' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
    ])
  })
})
