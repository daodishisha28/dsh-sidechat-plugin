import { describe, expect, it } from 'vitest'
import type { TrajectoryChoice } from '../src/types.ts'
import { layoutTrajectory, nodeKey } from '../src/client/trajectory-layout.ts'

function choice(overrides: Partial<TrajectoryChoice> & Pick<TrajectoryChoice, 'seq' | 'eventId' | 'kind' | 'label'>): TrajectoryChoice {
  const preview = overrides.preview ?? overrides.label
  return {
    sourceSessionId: 'session',
    seq: overrides.seq,
    eventId: overrides.eventId,
    kind: overrides.kind,
    label: overrides.label,
    preview,
    chars: preview.length,
    estimatedTokens: Math.ceil(preview.length / 4),
    redacted: false,
    truncated: false,
    fullContentAvailable: false,
    selectable: true,
    digest: `${overrides.eventId}-digest`,
    status: 'success',
    ...(overrides.turn === undefined ? {} : { turn: overrides.turn }),
    ...(overrides.step === undefined ? {} : { step: overrides.step }),
    ...(overrides.callId === undefined ? {} : { callId: overrides.callId }),
    ...(overrides.toolName === undefined ? {} : { toolName: overrides.toolName }),
    ...(overrides.parallelGroup === undefined ? {} : { parallelGroup: overrides.parallelGroup }),
    ...(overrides.model === undefined ? {} : { model: overrides.model }),
    ...(overrides.childTurns === undefined ? {} : { childTurns: overrides.childTurns }),
    ...(overrides.durationMs === undefined ? {} : { durationMs: overrides.durationMs }),
    ...overrides,
    preview,
    chars: overrides.chars ?? preview.length,
    estimatedTokens: overrides.estimatedTokens ?? Math.ceil(preview.length / 4),
  }
}

function turn(turnNumber: number, seq = 1): TrajectoryChoice {
  return choice({ seq, eventId: `turn:${turnNumber}`, turn: turnNumber, kind: 'turn', label: `Turn ${turnNumber}` })
}

function nodeFor(layout: ReturnType<typeof layoutTrajectory>, item: TrajectoryChoice) {
  return layout.nodes.find(node => nodeKey(node.item) === nodeKey(item))
}

describe('pure trajectory layout', () => {
  it('represents every real event in an expanded turn and orders authoritative steps', () => {
    const items: TrajectoryChoice[] = [
      turn(1),
      choice({ seq: 2, eventId: 'user', turn: 1, step: 1, kind: 'user', label: 'inspect' }),
      choice({ seq: 3, eventId: 'model-1', turn: 1, step: 1, kind: 'request', label: 'deepseek/chat', model: 'deepseek/chat' }),
      choice({ seq: 4, eventId: 'assistant-intermediate', turn: 1, step: 1, kind: 'assistant', label: 'assistant intermediate' }),
      choice({ seq: 5, eventId: 'model-2', turn: 1, step: 2, kind: 'request', label: 'deepseek/chat', model: 'deepseek/chat' }),
      choice({ seq: 6, eventId: 'call-a', turn: 1, step: 2, kind: 'tool-call', label: 'read', toolName: 'read', callId: 'call-a', parallelGroup: 'batch-2', fullContentAvailable: true }),
      choice({ seq: 6, eventId: 'call-b', turn: 1, step: 2, kind: 'tool-call', label: 'search', toolName: 'search', callId: 'call-b', parallelGroup: 'batch-2', fullContentAvailable: true }),
      choice({ seq: 7, eventId: 'result-a', turn: 1, step: 2, kind: 'tool-result', label: 'read', toolName: 'read', callId: 'call-a', fullContentAvailable: true }),
      choice({ seq: 8, eventId: 'result-b', turn: 1, step: 2, kind: 'tool-result', label: 'search', toolName: 'search', callId: 'call-b', fullContentAvailable: true }),
      choice({ seq: 9, eventId: 'assistant-final', turn: 1, step: 2, kind: 'assistant', label: 'assistant final' }),
    ]

    const layout = layoutTrajectory(items, new Set([1]), new Set())
    for (const item of items) expect(nodeFor(layout, item)).toBeDefined()
    expect(layout.groups.filter(group => group.kind === 'step').map(group => group.label)).toEqual(['Step 1', 'Step 2'])
    expect(new Set(layout.groups.map(group => group.id)).size).toBe(layout.groups.length)

    const request1 = nodeFor(layout, items[2]!)!
    const request2 = nodeFor(layout, items[4]!)!
    expect(request2.x).toBeGreaterThan(request1.x)
    expect(nodeFor(layout, items[5]!)!.y).toBeLessThan(nodeFor(layout, items[7]!)!.y)
    expect(layout.width).toBeGreaterThan(Math.max(...layout.nodes.map(node => node.x)))
    expect(layout.height).toBeGreaterThan(Math.max(...layout.nodes.map(node => node.y)))
    expect(layout.nodes.every(node => node.x >= 0 && node.y >= 0)).toBe(true)

    const callToResult = layout.edges.find(edge => edge.from === nodeKey(items[5]!) && edge.to === nodeKey(items[7]!))
    expect(callToResult).toMatchObject({ curved: true })
    expect(layout.edges.some(edge => edge.from === nodeKey(items[5]!) && edge.to === nodeKey(items[6]!))).toBe(false)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[6]!) && edge.to === nodeKey(items[5]!))).toBe(false)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[5]!) && edge.to === nodeKey(items[9]!))).toBe(false)
  })

  it('uses one chronological tail/head join between steps and never guesses no-step ownership', () => {
    const first = turn(1)
    const request = choice({ seq: 2, eventId: 'request', turn: 1, step: 1, kind: 'request', label: 'model', model: 'model' })
    const orphan = choice({ seq: 3, eventId: 'orphan-result', turn: 1, kind: 'tool-result', label: 'unknown result', callId: 'missing' })
    const second = choice({ seq: 4, eventId: 'assistant', turn: 1, step: 2, kind: 'assistant', label: 'assistant' })
    const layout = layoutTrajectory([first, request, orphan, second], new Set([1]), new Set())

    const orphanGroup = layout.groups.find(group => group.kind === 'step' && group.label === 'Unscoped events')
    expect(orphanGroup).toBeDefined()
    expect(orphanGroup?.step).toBeUndefined()
    const firstStep = layout.groups.find(group => group.kind === 'step' && group.label === 'Step 1')!
    const secondStep = layout.groups.find(group => group.kind === 'step' && group.label === 'Step 2')!
    expect(orphanGroup!.x).toBeGreaterThan(firstStep.x)
    expect(secondStep.x).toBeGreaterThan(orphanGroup!.x)

    const orphanNode = nodeFor(layout, orphan)!
    expect(orphanNode).toBeDefined()
    const incoming = layout.edges.find(edge => edge.to === nodeKey(orphan))
    const outgoing = layout.edges.find(edge => edge.from === nodeKey(orphan))
    expect(incoming?.dashed).toBe(true)
    expect(outgoing?.dashed).toBe(true)
    expect(layout.nodes.filter(node => nodeKey(node.item) === nodeKey(orphan))).toHaveLength(1)
  })

  it('marks an explicit-step event with no causal identity as chronological fallback', () => {
    const items: TrajectoryChoice[] = [
      turn(1),
      choice({ seq: 2, eventId: 'request', turn: 1, step: 1, kind: 'request', label: 'model', model: 'model' }),
      choice({ seq: 3, eventId: 'unknown-result', turn: 1, step: 1, kind: 'tool-result', label: 'result' }),
      choice({ seq: 4, eventId: 'assistant', turn: 1, step: 1, kind: 'assistant', label: 'assistant' }),
    ]
    const layout = layoutTrajectory(items, new Set([1]), new Set())
    expect(layout.edges.find(edge => edge.to === nodeKey(items[2]!))?.dashed).toBe(true)
  })

  it('joins each terminal result branch into the next step without making results siblings', () => {
    const items: TrajectoryChoice[] = [
      turn(1),
      choice({ seq: 2, eventId: 'request-1', turn: 1, step: 1, kind: 'request', label: 'model', model: 'model' }),
      choice({ seq: 3, eventId: 'call-a', turn: 1, step: 1, kind: 'tool-call', label: 'a', toolName: 'a', callId: 'a', parallelGroup: 'batch', fullContentAvailable: true }),
      choice({ seq: 4, eventId: 'call-b', turn: 1, step: 1, kind: 'tool-call', label: 'b', toolName: 'b', callId: 'b', parallelGroup: 'batch', fullContentAvailable: true }),
      // Reverse result order exercises the no-result-to-result sibling rule.
      choice({ seq: 5, eventId: 'result-b', turn: 1, step: 1, kind: 'tool-result', label: 'b', toolName: 'b', callId: 'b', fullContentAvailable: true }),
      choice({ seq: 6, eventId: 'result-a', turn: 1, step: 1, kind: 'tool-result', label: 'a', toolName: 'a', callId: 'a', fullContentAvailable: true }),
      choice({ seq: 7, eventId: 'request-2', turn: 1, step: 2, kind: 'request', label: 'model', model: 'model' }),
    ]
    const layout = layoutTrajectory(items, new Set([1]), new Set())
    const next = nodeKey(items[6]!)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[4]!) && edge.to === next)).toBe(true)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[5]!) && edge.to === next)).toBe(true)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[4]!) && edge.to === nodeKey(items[5]!))).toBe(false)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[5]!) && edge.to === nodeKey(items[4]!))).toBe(false)
  })

  it('joins through a later assistant instead of bypassing it at the next step', () => {
    const items: TrajectoryChoice[] = [
      turn(1),
      choice({ seq: 2, eventId: 'request-1', turn: 1, step: 1, kind: 'request', label: 'model', model: 'model' }),
      choice({ seq: 3, eventId: 'call', turn: 1, step: 1, kind: 'tool-call', label: 'read', toolName: 'read', callId: 'call', parallelGroup: 'batch', fullContentAvailable: true }),
      choice({ seq: 4, eventId: 'result', turn: 1, step: 1, kind: 'tool-result', label: 'read', toolName: 'read', callId: 'call', fullContentAvailable: true }),
      choice({ seq: 5, eventId: 'assistant-1', turn: 1, step: 1, kind: 'assistant', label: 'assistant intermediate' }),
      choice({ seq: 6, eventId: 'request-2', turn: 1, step: 2, kind: 'request', label: 'model', model: 'model' }),
    ]
    const layout = layoutTrajectory(items, new Set([1]), new Set())
    const nextStep = nodeKey(items[5]!)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[4]!) && edge.to === nextStep)).toBe(true)
    expect(layout.edges.some(edge => edge.from === nodeKey(items[3]!) && edge.to === nextStep)).toBe(false)
  })

  it('keeps repeated step numbers in separate uniquely identified bands', () => {
    const items: TrajectoryChoice[] = [
      turn(1),
      choice({ seq: 2, eventId: 'step1-a', turn: 1, step: 1, kind: 'assistant', label: 'step one A' }),
      choice({ seq: 3, eventId: 'unscoped', turn: 1, kind: 'fold-note', label: 'unscoped trace' }),
      choice({ seq: 4, eventId: 'step1-b', turn: 1, step: 1, kind: 'assistant', label: 'step one B' }),
    ]
    const layout = layoutTrajectory(items, new Set([1]), new Set())
    const stepBands = layout.groups.filter(group => group.kind === 'step' && group.step === 1)
    expect(stepBands).toHaveLength(2)
    expect(new Set(stepBands.map(group => group.id)).size).toBe(2)
  })

  it('routes an expanded turn through an intervening session note before the next turn', () => {
    const firstTurn = turn(1)
    const firstAssistant = choice({ seq: 2, eventId: 'assistant-1', turn: 1, step: 1, kind: 'assistant', label: 'first answer' })
    const note = choice({ seq: 3, eventId: 'session-note', kind: 'fold-note', label: '↩ SideChat Fold' })
    const secondTurn = turn(2, 4)
    const secondRequest = choice({ seq: 5, eventId: 'request-2', turn: 2, step: 1, kind: 'request', label: 'model', model: 'model' })
    const layout = layoutTrajectory([firstTurn, firstAssistant, note, secondTurn, secondRequest], new Set([1, 2]), new Set())
    expect(layout.edges.some(edge => edge.from === nodeKey(firstAssistant) && edge.to === nodeKey(note))).toBe(true)
    expect(layout.edges.some(edge => edge.from === nodeKey(note) && edge.to === nodeKey(secondTurn))).toBe(true)
    expect(layout.edges.some(edge => edge.from === nodeKey(firstAssistant) && edge.to === nodeKey(secondTurn))).toBe(false)
  })

  it('expands a subagent to the actual result alias, or an honest readonly placeholder', () => {
    const call = choice({ seq: 2, eventId: 'subagent-call', turn: 1, step: 1, kind: 'subagent', label: 'Task: inspect', toolName: 'subagent', callId: 'subagent-call', childTurns: 4, fullContentAvailable: true })
    const result = choice({ seq: 3, eventId: 'subagent-result', turn: 1, step: 1, kind: 'tool-result', label: 'subagent', toolName: 'subagent', callId: 'subagent-call', fullContentAvailable: true })
    const withResult = layoutTrajectory([turn(1), call, result], new Set([1]), new Set([nodeKey(call)]))
    const alias = withResult.nodes.find(node => node.role === 'subagent-result-alias')
    expect(alias).toBeDefined()
    expect(alias?.target).toBe(result)
    expect(alias?.item.eventId).toContain(':alias:subagent-call')
    expect(alias?.item.label).toBe('返回 ✓')
    expect(withResult.edges.find(edge => edge.from === nodeKey(call) && edge.to === nodeKey(alias!.item))).toMatchObject({ dashed: true, label: /view alias/iu })
    expect(withResult.nodes.some(node => /SA · t/iu.test(node.item.label))).toBe(false)
    expect(new Set(withResult.nodes.map(node => nodeKey(node.item))).size).toBe(withResult.nodes.length)

    const unpaired = choice({ seq: 2, eventId: 'unpaired-subagent', turn: 1, step: 1, kind: 'subagent', label: 'Task: inspect', toolName: 'subagent', callId: 'no-result', childTurns: 2, fullContentAvailable: true })
    const withoutResult = layoutTrajectory([turn(1), unpaired], new Set([1]), new Set([nodeKey(unpaired)]))
    const placeholder = withoutResult.nodes.find(node => node.role === 'subagent-result-placeholder')
    expect(placeholder).toBeDefined()
    expect(placeholder?.target).toBeUndefined()
    expect(placeholder?.item.fullContentAvailable).toBe(false)
    expect(placeholder?.item.selectable).toBe(false)
    expect(placeholder?.item.label).toMatch(/trace not loaded/iu)
    expect(placeholder?.item.preview).toMatch(/no tool result matched/iu)
    expect(withoutResult.edges.find(edge => edge.from === nodeKey(unpaired) && edge.to === nodeKey(placeholder!.item))).toMatchObject({ dashed: true, label: /trace not loaded/iu })
  })

  it('keeps returned aliases honest for cancelled and unknown result statuses', () => {
    const cancelledCall = choice({ seq: 2, eventId: 'cancel-call', turn: 1, step: 1, kind: 'subagent', label: 'Task: cancel', toolName: 'subagent', callId: 'cancel-call' })
    const cancelledResult = choice({ seq: 3, eventId: 'cancel-result', turn: 1, step: 1, kind: 'tool-result', label: 'subagent', toolName: 'subagent', callId: 'cancel-call', status: 'cancelled' })
    const cancelled = layoutTrajectory([turn(1), cancelledCall, cancelledResult], new Set([1]), new Set([nodeKey(cancelledCall)]))
    expect(cancelled.nodes.find(node => node.role === 'subagent-result-alias')?.item.label).toBe('返回（已取消）')

    const unknownCall = choice({ seq: 2, eventId: 'unknown-call', turn: 1, step: 1, kind: 'subagent', label: 'Task: unknown', toolName: 'subagent', callId: 'unknown-call' })
    const unknownResult = choice({ seq: 3, eventId: 'unknown-result', turn: 1, step: 1, kind: 'tool-result', label: 'subagent', toolName: 'subagent', callId: 'unknown-call' })
    delete unknownResult.status
    const unknown = layoutTrajectory([turn(1), unknownCall, unknownResult], new Set([1]), new Set([nodeKey(unknownCall)]))
    expect(unknown.nodes.find(node => node.role === 'subagent-result-alias')?.item.label).toBe('返回（状态未知）')
  })

  it('keeps collapsed turn children hidden while retaining session-level notes in sequence order', () => {
    const noteBefore = choice({ seq: 1, eventId: 'note-before', kind: 'fold-note', label: '↩ before' })
    const turnItem = turn(1, 2)
    const child = choice({ seq: 3, eventId: 'child', turn: 1, step: 1, kind: 'assistant', label: 'child assistant' })
    const noteMiddle = choice({ seq: 4, eventId: 'note-middle', kind: 'fold-note', label: '↩ middle' })
    const noteAfter = choice({ seq: 5, eventId: 'note-after', kind: 'fold-note', label: '↩ after' })
    const layout = layoutTrajectory([noteBefore, turnItem, child, noteMiddle, noteAfter], new Set(), new Set())
    expect(nodeFor(layout, turnItem)).toBeDefined()
    expect(layout.nodes.filter(node => nodeKey(node.item) === nodeKey(turnItem))).toHaveLength(1)
    expect(nodeFor(layout, child)).toBeUndefined()
    const notes = [noteBefore, noteMiddle, noteAfter].map(item => nodeFor(layout, item)!)
    expect(notes.every(node => node !== undefined)).toBe(true)
    expect(notes.map(node => node.x)).toEqual([...notes].sort((left, right) => left.x - right.x).map(node => node.x))
    expect(layout.nodes.filter(node => node.item.kind === 'fold-note')).toHaveLength(3)

    const emptyTurn = turn(2, 6)
    const withEmptyTurn = layoutTrajectory([noteBefore, turnItem, child, noteMiddle, noteAfter, emptyTurn], new Set(), new Set())
    expect(new Set(withEmptyTurn.groups.map(group => group.id)).size).toBe(withEmptyTurn.groups.length)
    expect(withEmptyTurn.groups.filter(group => group.kind === 'turn')).toHaveLength(2)
  })
})
