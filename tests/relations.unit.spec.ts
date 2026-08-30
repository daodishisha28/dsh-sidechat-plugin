import { describe, expect, it } from 'vitest'
import { sameKnownWorkspace } from '../src/relations.ts'

describe('cross-parent workspace authorization', () => {
  it('requires equal positive canonical workspace evidence', () => {
    expect(sameKnownWorkspace('C:\\work', 'C:\\work')).toBe(true)
    expect(sameKnownWorkspace('C:\\work', 'D:\\other')).toBe(false)
    expect(sameKnownWorkspace(undefined, undefined)).toBe(false)
    expect(sameKnownWorkspace('C:\\work', undefined)).toBe(false)
  })
})
