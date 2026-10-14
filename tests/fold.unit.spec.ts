import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  buildCiteParentMessage,
  buildFoldParentMessage,
  buildWithdrawalParentMessage,
  citeMarker,
  estimateTokens,
  foldMarker,
  extractDetailPointers,
  messagePointer,
  hasFoldStructure,
  withdrawalMarker,
} from '../src/fold.ts'
import {
  deliveryPayloadIdentity,
  finalAssistantAtOrAfter,
  locateSideChatDelivery,
} from '../src/session-history.ts'

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

function rawEvent(seq: number, type: string, data: unknown, surfaceOp?: unknown): SessionEvent {
  return (surfaceOp === undefined
    ? { seq, time: seq, type, data }
    : { seq, time: seq, type, data, surfaceOp }) as unknown as SessionEvent
}

function assistantEvent(seq: number, id: string, text: string, surfaceOp?: unknown): SessionEvent {
  return rawEvent(seq, 'assistant/message', {
    turn: 1, step: 1,
    message: { id, source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text }] },
  }, surfaceOp)
}

function userDeliveryEvent(seq: number, id: string, source: Record<string, unknown>, text: string): SessionEvent {
  return rawEvent(seq, 'user/message', { id, role: 'user', source, content: [{ type: 'text', text }] })
}

describe('final assistant selection (generation window)', () => {
  const plan = '计划：先列出步骤，再给出结论'
  const answer = '# SideChat 澄清结论：t\n- 背景：b\n- 结论：c\n- 依据：d\n- 对父会话的影响：e\n- 未决：f'

  it('selects the FINAL direct answer over earlier planning narration in the window', () => {
    const events = [
      rawEvent(5, 'user/message', { id: 'u', role: 'user', content: [{ type: 'text', text: 'q' }] }),
      // Generation window starts after the exclusive baseline (seq >= 6):
      assistantEvent(6, 'plan-narration', plan),
      rawEvent(7, 'tool/call', { id: 'call' }),
      rawEvent(8, 'tool/result', { id: 'result' }),
      assistantEvent(9, 'final-answer', answer),
    ]
    const chosen = finalAssistantAtOrAfter(events, 6)
    expect(chosen?.messageId).toBe('final-answer')
    expect(chosen?.text).toBe(answer)
  })

  it('excludes surfaceOp replace copies inside the window', () => {
    const events = [
      assistantEvent(5, 'before-baseline', 'before'),
      assistantEvent(10, 'direct', answer),
      // Compaction rewrote the direct message into a replacement copy.
      assistantEvent(11, 'replace-copy', answer, { op: 'replace', startSeq: 10, endSeq: 10 }),
    ]
    const chosen = finalAssistantAtOrAfter(events, 6)
    expect(chosen?.messageId).toBe('direct')
    // A window containing ONLY the replacement copy has no directly authored answer.
    expect(finalAssistantAtOrAfter([assistantEvent(11, 'replace-copy', answer, { op: 'replace', startSeq: 10, endSeq: 10 })], 6)).toBeUndefined()
  })

  it('keeps the basic single-answer case and plain append markers eligible', () => {
    const events = [
      assistantEvent(3, 'old', 'old answer'),
      assistantEvent(10, 'new', 'new answer', 'append'),
    ]
    expect(finalAssistantAtOrAfter(events, 10)?.messageId).toBe('new')
    expect(finalAssistantAtOrAfter(events, 4)?.messageId).toBe('new')
    expect(finalAssistantAtOrAfter(events, 11)).toBeUndefined()
  })

  it('still errors at the call site when the window produced no assistant text', () => {
    const events = [rawEvent(1, 'user/message', { id: 'u', role: 'user', content: [{ type: 'text', text: 'q' }] })]
    const chosen = finalAssistantAtOrAfter(events, 0)
    expect(chosen).toBeUndefined()
    expect(() => {
      if (chosen === undefined) throw new Error('Fold turn produced no assistant text')
    }).toThrow('Fold turn produced no assistant text')
  })
})

describe('delivery location evidence (never a quotation)', () => {
  const marker = foldMarker('11111111-1111-4111-8111-111111111111', 3, 'child')
  const noticeSummary = 'Fold SideChat revision 3'
  const deliveryText = buildFoldParentMessage(marker, 't', '结论正文：采用 A')
  const evidence = { noticeSummary, payload: deliveryPayloadIdentity(deliveryText, marker) }

  it('derives the exact complete payload identity after a structurally leading marker (no whitespace normalization)', () => {
    // Full body after the marker — exact bytes, no truncation, no
    // normalization. The marker sits at position 0 (outer trim only, mirroring
    // the messageText read path).
    expect(deliveryText.startsWith(marker)).toBe(true)
    expect(deliveryText.trim().slice(marker.length)).toBe(evidence.payload)
    const long = buildFoldParentMessage(marker, 't', `${'很长的载荷'.repeat(200)}`)
    expect(deliveryPayloadIdentity(long, marker)).toBe(long.slice(marker.length))
    // Internal whitespace is preserved EXACTLY: indentation and line breaks
    // are part of the identity.
    expect(deliveryPayloadIdentity(`${marker}\n\n   多  段\n空白  `, marker)).toBe('\n\n   多  段\n空白')
    // A text whose marker is not at the structural start has no
    // body-after-marker identity (the full trimmed text is returned).
    expect(deliveryPayloadIdentity(`前置文字 ${marker} 正文`, marker)).toBe(`前置文字 ${marker} 正文`)
  })

  it('distinguishes a different tail behind the same marker and same first 160 normalized characters', () => {
    // Same marker + same summary + identical first 160 normalized payload
    // characters, but a different tail: a bounded excerpt would match; the
    // exact full-body identity must NOT.
    const head = deliveryPayloadIdentity(deliveryText, marker)
    const prefix = head.slice(0, 160)
    const collidingText = `${marker} ${prefix} 尾部完全不同的附加内容`
    const collidingHit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'collision', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, collidingText)],
      marker, evidence,
    )
    expect(collidingHit).toBeUndefined()
    // The exact body still matches.
    const exactHit = locateSideChatDelivery(
      [userDeliveryEvent(2, 'exact', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, deliveryText)],
      marker, evidence,
    )
    expect(exactHit).toMatchObject({ messageId: 'exact', producer: 'current' })
  })

  it('rejects different internal indentation or line breaks with otherwise identical words', () => {
    // NEW exact-identity rejection: same marker, same summary, every word
    // identical — but the internal whitespace differs. Under the old
    // whitespace-normalized identity this collided; the exact body identity
    // must reject it.
    const reindented = deliveryText
      .replace('\n\n> 来自 SideChat：t\n> mode=full\n\n', '\n> 来自 SideChat：t\n> mode=full\n')
      .replace('\n\n结论正文', '\n结论正文')
    expect(reindented).not.toBe(deliveryText)
    expect(reindented.replace(/\s+/gu, ' ')).toBe(deliveryText.replace(/\s+/gu, ' '))
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'reindented', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, reindented)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })

  it('rejects arbitrary leading text before the marker even with the exact payload tail', () => {
    // NEW structural-start rejection: a leading quotation line before the
    // marker (e.g. a user quoting a real delivery inside a SideChat notice)
    // must REJECT even though the rest of the body is byte-identical. Under
    // the old normalized.indexOf(marker) location this was a match.
    const leadingQuotation = `引用一条先前的交付：\n\n${deliveryText}`
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'quoted', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, leadingQuotation)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
    // The unquoted real delivery still matches through the same evidence.
    const realHit = locateSideChatDelivery(
      [userDeliveryEvent(2, 'real', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, deliveryText)],
      marker, evidence,
    )
    expect(realHit).toMatchObject({ messageId: 'real', producer: 'current' })
  })

  it('matches the exact frozen messages built by every real producer', () => {
    // The three real builders all place the marker at the structural start;
    // their exact outputs must locate through the frozen evidence.
    const citeMarkerText = citeMarker('22222222-2222-4222-8222-222222222222', 'child', 'm1')
    const citeText = buildCiteParentMessage(citeMarkerText, 't', '引用的回复正文')
    const citeEvidence = { noticeSummary: 'Cite SideChat assistant reply', payload: deliveryPayloadIdentity(citeText, citeMarkerText) }
    expect(locateSideChatDelivery(
      [userDeliveryEvent(1, 'cite', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: 'Cite SideChat assistant reply' }, citeText)],
      citeMarkerText, citeEvidence,
    )).toMatchObject({ messageId: 'cite', producer: 'current' })

    const withdrawalMarkerText = withdrawalMarker('11111111-1111-4111-8111-111111111111', 3, 'child')
    const withdrawalText = buildWithdrawalParentMessage(withdrawalMarkerText, 't', 3, '已过期')
    const withdrawalEvidence = { noticeSummary: 'Withdraw SideChat revision 3', payload: deliveryPayloadIdentity(withdrawalText, withdrawalMarkerText) }
    expect(locateSideChatDelivery(
      [userDeliveryEvent(2, 'withdrawal', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: 'Withdraw SideChat revision 3' }, withdrawalText)],
      withdrawalMarkerText, withdrawalEvidence,
    )).toMatchObject({ messageId: 'withdrawal', producer: 'current' })
  })

  it('accepts a genuine current notice delivery', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm1', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, deliveryText)],
      marker, evidence,
    )
    expect(hit).toMatchObject({ messageId: 'm1', producer: 'current' })
  })

  it('accepts a genuine legacy notice delivery (legacy producer + notice form)', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm2', { kind: 'plugin', plugin: 'dsh-sidechat', form: 'notice', summary: noticeSummary }, deliveryText)],
      marker, evidence,
    )
    expect(hit).toMatchObject({ messageId: 'm2', producer: 'legacy' })
  })

  it('rejects a snapshot message quoting the full marker and payload', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm3', { kind: 'plugin:dsh-sidechat', form: 'snapshot', sections: [] }, deliveryText)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })

  it('rejects a plain SideChat producer message quoting the delivery (no notice form)', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm4', { kind: 'plugin:dsh-sidechat' }, deliveryText)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })

  it('rejects a user-pasted marker', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm5', { kind: 'user' }, `粘贴：${deliveryText}`)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })

  it('rejects another SideChat operation reusing similar marker text with a different payload', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm6', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: noticeSummary }, `${marker}\n\n> 来自 SideChat：t\n\n完全不同的载荷`)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })

  it('rejects a notice with a different bound summary', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm7', { kind: 'plugin:dsh-sidechat', form: 'notice', summary: 'Cite SideChat assistant reply' }, deliveryText)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })

  it('rejects an arbitrary plugin producer even with notice form and matching text', () => {
    const hit = locateSideChatDelivery(
      [userDeliveryEvent(1, 'm8', { kind: 'plugin', plugin: 'other-plugin', form: 'notice', summary: noticeSummary }, deliveryText)],
      marker, evidence,
    )
    expect(hit).toBeUndefined()
  })
})
