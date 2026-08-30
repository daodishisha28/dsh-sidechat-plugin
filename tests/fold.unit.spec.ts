import { describe, expect, it } from 'vitest'
import {
  buildCiteParentMessage,
  buildFoldParentMessage,
  citeMarker,
  estimateTokens,
  foldMarker,
  extractDetailPointers,
  messagePointer,
  hasFoldStructure,
} from '../src/fold.ts'

const valid = `# SideChat 澄清结论：选择 A

- 背景：需要比较方案。
- 结论：采用 A。
- 依据：风险更低。
- 对父会话的影响：更新实施选择。
- 未决：无。`

describe('Fold contract', () => {
  it('accepts only the ordered fixed structure', () => {
    expect(hasFoldStructure(valid)).toBe(true)
    expect(hasFoldStructure(valid.replace('- 结论：采用 A。', ''))).toBe(false)
    expect(hasFoldStructure(valid.replace('- 背景：需要比较方案。', '- 背景：x\n- 未决：x'))).toBe(false)
  })

  it('uses stable operation markers in parent messages', () => {
    const fold = foldMarker('11111111-1111-4111-8111-111111111111', 3, 'child')
    const cite = citeMarker('22222222-2222-4222-8222-222222222222', 'child', 'm1')
    expect(buildFoldParentMessage(fold, 'title', valid)).toContain(fold)
    expect(buildCiteParentMessage(cite, 'title', 'reply')).toContain(cite)
    expect(fold).toContain('rev=3')
  })

  it('uses the documented conservative estimator', () => {
    expect(estimateTokens('1234')).toBe(1)
    expect(estimateTokens('12345')).toBe(2)
  })

  it('accepts only exact detail pointers owned by the SideChat child', () => {
    const pointer = messagePointer('child', 'm/1')
    const content = `${valid}\n\n- 详情：[原始回答](${pointer})`
    expect(extractDetailPointers(content, 'child', [{ messageId: 'm/1', role: 'assistant', text: 'answer', seq: 1 }])).toEqual([
      { label: '原始回答', uri: pointer, messageId: 'm/1' },
    ])
    expect(() => extractDetailPointers(content.replace('child', 'other'), 'child', [{ messageId: 'm/1', role: 'assistant', text: 'answer', seq: 1 }])).toThrow(/another SideChat/u)
    expect(() => extractDetailPointers(content, 'child', [])).toThrow(/unknown message/u)
    expect(() => extractDetailPointers(`${valid}\nsidechat://child/broken`, 'child', [])).toThrow(/malformed/u)
  })
})
