import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TRAJECTORY_PROJECTION_VERSION, projectTrajectory, selectTrajectorySnapshots, trajectoryDetail, trajectoryOverview } from '../src/trajectory.ts'

const events: SessionEvent[] = [
  { seq: 1, time: 1_000, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, time: 1_010, type: 'user/message', data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'check login' }] } },
  { seq: 3, time: 1_020, type: 'step/start', data: { turn: 1, step: 1 } },
  { seq: 4, time: 1_030, type: 'assistant/message', data: { turn: 1, message: { id: 'a1', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [
    { type: 'tool-call', id: 'c1', name: 'read', arguments: { path: 'C:\\Users\\zzc\\secret.txt', apiKey: 'secret-value', unknownField: { nested: true }, stdout: 'x'.repeat(4_500) } },
    { type: 'tool-call', id: 'c2', name: 'Task', arguments: { prompt: 'search' }, turns: 3 },
    { type: 'text', text: 'final answer' },
  ] } } },
  { seq: 5, time: 1_080, type: 'tool/result', data: { id: 'r1', name: 'read', content: [{ type: 'text', text: 'Authorization: Bearer abcdefghijklmnop' }] } },
  { seq: 6, time: 1_090, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  { seq: 7, time: 1_100, type: 'user/message', data: { id: 'fold', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat fold id=x rev=1 source=B]\nFold result' }] } },
  { seq: 8, time: 1_110, type: 'user/message', data: { id: 'cite', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat cite id=y source=B message=m1]\nCited reply' }] } },
  { seq: 9, time: 1_120, type: 'user/message', data: { id: 'withdrawal', source: { kind: 'plugin' }, content: [{ type: 'text', text: '[SideChat fold-withdrawal id=x rev=1 source=B]\nWithdrawn' }] } },
]

describe('trajectory Host projection', () => {
  it('projects raw tool content without redaction while keeping list previews bounded', () => {
    const items = projectTrajectory('parent', events)
    expect(items.map(item => item.kind)).toEqual(expect.arrayContaining(['turn', 'user', 'request', 'tool-call', 'assistant', 'tool-result', 'fold-note']))
    const read = items.find(item => item.eventId === 'c1')
    expect(read).toMatchObject({ redacted: false, truncated: true, fullContentAvailable: true })
    expect(read?.preview).toContain('secret-value')
    expect(read?.preview).toContain('C:\\\\Users\\\\zzc\\\\secret.txt')
    expect(read?.preview.length).toBeLessThan(4_100)
    const detail = trajectoryDetail(items, events, { seq: read!.seq, eventId: read!.eventId, kind: read!.kind, digest: read!.digest })
    expect(detail.text).toContain('unknownField')
    expect(detail.text).toContain('x'.repeat(4_500))
    expect(detail).toMatchObject({ redacted: false })
    const result = items.find(item => item.eventId === 'r1')
    expect(result?.preview).toContain('Authorization: Bearer abcdefghijklmnop')
    expect(result).toMatchObject({ redacted: false, fullContentAvailable: true })
    const notes = items.filter(item => item.kind === 'fold-note')
    expect(notes).toHaveLength(3)
    expect(notes.map(item => item.label)).toEqual(['↩ SideChat Fold', '↩ SideChat Cite', '↩ SideChat Fold 撤回'])
    expect(notes.map(item => ({ label: item.label, selectable: item.selectable }))).toEqual([
      { label: '↩ SideChat Fold', selectable: true },
      { label: '↩ SideChat Cite', selectable: true },
      { label: '↩ SideChat Fold 撤回', selectable: false },
    ])
    expect(notes.every(item => item.turn === undefined)).toBe(true)
    // The `Task`-named call carries no settled activation result, so it is a
    // plain tool-call: evidence, not the historical alias, classifies.
    expect(items.find(item => item.eventId === 'c2')).toMatchObject({ kind: 'tool-call', toolName: 'Task' })
    expect(trajectoryOverview(items, events, 9)).toMatchObject({ turns: 1, calls: 2, subagents: 0, failures: 0, durationMs: 120 })
  })

  it('accepts exact immutable refs and preserves selectable Fold provenance', () => {
    const items = projectTrajectory('parent', events)
    const call = items.find(item => item.eventId === 'c1')!
    const snapshots = selectTrajectorySnapshots(items, events, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest }])
    expect(snapshots).toMatchObject([{ eventId: 'c1', kind: 'tool-call', redacted: false }])
    expect(snapshots[0]?.text).toContain('x'.repeat(4_500))
    expect(() => selectTrajectorySnapshots(items, events, [{ seq: call.seq, eventId: call.eventId, kind: call.kind, digest: 'stale' }])).toThrow(/stale/u)
    const fold = items.find(item => item.eventId === 'fold')!
    const foldSnapshots = selectTrajectorySnapshots(items, events, [{ seq: fold.seq, eventId: fold.eventId, kind: fold.kind, digest: fold.digest }])
    expect(foldSnapshots[0]?.text).toBe('[SideChat fold id=x rev=1 source=B]\nFold result')
    const cite = items.find(item => item.eventId === 'cite')!
    const citeSnapshots = selectTrajectorySnapshots(items, events, [{ seq: cite.seq, eventId: cite.eventId, kind: cite.kind, digest: cite.digest }])
    expect(citeSnapshots[0]?.text).toBe('[SideChat cite id=y source=B message=m1]\nCited reply')
  })

  it('does not classify a tool named subagent by name alone — result identity decides', () => {
    const subagentEvents: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'assistant-1', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [
        { type: 'tool-call', id: 'subagent-call', name: 'subagent', arguments: { prompt: 'inspect this' }, turns: 1 },
      ] } } },
      // alpha.2 V4 shape: a tool-role message with plain content blocks,
      // `source.callId`, and `isError` — no legacy tool-result wrapper. A
      // NORMAL text result (not activation-shaped) means an unrelated tool
      // that merely shares the delegation name: it must keep plain rendering.
      { seq: 4, time: 4, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'subagent-result-message', role: 'tool', source: { kind: 'tool', callId: 'subagent-call' }, content: [
        { type: 'text', text: 'child final answer' },
      ] } } },
    ]
    const projected = projectTrajectory('parent', subagentEvents)
    const call = projected.find(item => item.kind === 'tool-call')!
    const result = projected.find(item => item.kind === 'tool-result')!

    // Name-unconditional classification would mislabel this as a subagent.
    expect(projected.find(item => item.kind === 'subagent')).toBeUndefined()
    expect(call).toMatchObject({ callId: 'subagent-call', toolName: 'subagent' })
    // The result still correlates and stays readable with exact detail.
    expect(result).toMatchObject({ callId: 'subagent-call', toolName: 'subagent', selectable: true })
    expect(result.preview).toContain('child final answer')
    expect(trajectoryDetail(projected, subagentEvents, {
      seq: result.seq,
      eventId: result.eventId,
      kind: result.kind,
      digest: result.digest,
    }).text).toContain('child final answer')
  })

  it('classifies a real-shaped subagent call through its activation result identity', () => {
    // Real alpha.2 durable shape: tool-subagent's `output.render` persists the
    // model-facing text `started subagent <subagentId>` as the tool/result
    // content (upstream tool-subagent src/index.ts), paired by source.callId.
    const realShape: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-sub', name: 'delegate_work', arguments: '{"prompt":"go"}' } },
      { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm-sub', role: 'tool', source: { kind: 'tool', callId: 'call-sub' }, content: [
        { type: 'text', text: 'started subagent child-77' },
      ] } } },
    ]
    const projected = projectTrajectory('parent', realShape)
    expect(projected.find(item => item.kind === 'subagent')).toMatchObject({ callId: 'call-sub', toolName: 'delegate_work' })
    // The raw activation VALUE shape (documented output.schema) is the second
    // accepted identity, for logs whose tool did not render.
    const valueShape: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-val', name: 'delegate_work', arguments: '{"prompt":"go"}' } },
      { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm-val', role: 'tool', source: { kind: 'tool', callId: 'call-val' }, content: [
        { type: 'text', text: '{"kind":"activation","subagentId":"child-9"}' },
      ] } } },
    ]
    expect(projectTrajectory('parent', valueShape).find(item => item.kind === 'subagent'))
      .toMatchObject({ callId: 'call-val', toolName: 'delegate_work' })
  })

  it('keeps the legacy tool-result content-block wrapper readable for old fixtures and migrated logs', () => {
    const legacy: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'legacy-result', source: {}, content: [
        { type: 'tool-result', toolCallId: 'legacy-call', content: [{ type: 'text', text: 'wrapped legacy outcome' }], isError: true },
      ] } } },
    ]
    const projected = projectTrajectory('parent', legacy)
    const result = projected.find(item => item.kind === 'error' || item.kind === 'tool-result')!
    expect(result.callId).toBe('legacy-call')
    expect(result.status).toBe('error')
    expect(result.preview).toContain('wrapped legacy outcome')
  })

  it('reads V4 callId pairing and error status from the tool-role message, not the old block', () => {
    const v4: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-v4', name: 'read', arguments: '{}' } },
      { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm1', role: 'tool', source: { kind: 'tool', callId: 'call-v4' }, content: [{ type: 'text', text: 'boom' }], isError: true }, error: { name: 'ToolError', code: 'TOOL_FAILED', reason: 'permission denied' } } },
    ]
    const projected = projectTrajectory('parent', v4)
    const result = projected.find(item => item.kind === 'error')!
    expect(result).toMatchObject({ callId: 'call-v4', status: 'error', toolName: 'read' })
    expect(result.preview).toContain('boom')
    expect(trajectoryOverview(projected, v4, 3).failures).toBe(1)
  })

  it('treats a subagent activation result as start acceptance, never as a finished answer', () => {
    const activation: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'a1', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'tool-call', id: 'act-call', name: 'delegator', arguments: '{}' },
      ] } } },
      { seq: 3, time: 3, type: 'tool/call', data: { turn: 1, step: 1, callId: 'act-call', name: 'delegator', arguments: '{}' } },
      { seq: 4, time: 4, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm2', role: 'tool', source: { kind: 'tool', callId: 'act-call' }, content: [{ type: 'text', text: 'started subagent child-1' }] } } },
    ]
    const projected = projectTrajectory('parent', activation)
    const call = projected.find(item => item.kind === 'subagent')!
    const result = projected.find(item => item.kind === 'tool-result')!
    // Result identity, not the (configurable) tool name, classifies the call.
    expect(call).toMatchObject({ callId: 'act-call', toolName: 'delegator' })
    expect(result.callId).toBe('act-call')
    // Start acceptance is not completion: no success verdict may be derived.
    expect(result.status).toBeUndefined()
    expect(call.status).toBeUndefined()
    expect(trajectoryOverview(projected, activation, 4)).toMatchObject({ subagents: 1, failures: 0 })
  })

  it('never claims a delegation from a name alone; activation evidence classifies alias names too', () => {
    // An alias-named call with no settled result yet is NOT inferred to be a
    // subagent — a partial log proves nothing about the delegation.
    const forked: SessionEvent[] = [
      { seq: 1, time: 1, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'a1', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'tool-call', id: 'fork-call', name: 'subagent_fork', arguments: '{}' },
      ] } } },
    ]
    const projected = projectTrajectory('parent', forked)
    expect(projected.find(item => item.kind === 'subagent')).toBeUndefined()
    expect(projected.find(item => item.kind === 'tool-call')).toMatchObject({ toolName: 'subagent_fork' })

    // With the activation identity settled, an alias-named call IS classified
    // (identity is the signal; the alias merely agrees with it).
    const activated: SessionEvent[] = [
      { seq: 1, time: 1, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'a2', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'tool-call', id: 'fork-call', name: 'subagent_fork', arguments: '{}' },
      ] } } },
      { seq: 2, time: 2, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm3', role: 'tool', source: { kind: 'tool', callId: 'fork-call' }, content: [{ type: 'text', text: 'started subagent child-fork' }] } } },
    ]
    const activatedProjection = projectTrajectory('parent', activated)
    expect(activatedProjection.find(item => item.kind === 'subagent')).toMatchObject({ callId: 'fork-call', toolName: 'subagent_fork' })

    // A foreign tool sharing no alias keeps plain tool-call rendering.
    const foreign: SessionEvent[] = [
      { seq: 1, time: 1, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'a3', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'tool-call', id: 'wf-call', name: 'workflow_start', arguments: '{}' },
      ] } } },
    ]
    expect(projectTrajectory('parent', foreign).find(item => item.kind === 'subagent')).toBeUndefined()
  })

  it('pairs PTC sub-dispatches by subCallId without counting them as outer calls', () => {
    const ptc: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'run-code-1', name: 'run_code', arguments: '{"code":"1"}' } },
      { seq: 3, time: 3, type: 'tool/ptc-dispatch-start', data: { rootCallId: 'run-code-1', parentCallId: 'run-code-1', subCallId: 'run-code-1:ptc:1', name: 'read', arguments: { path: 'a.ts' } } },
      { seq: 4, time: 4, type: 'tool/ptc-dispatch', data: { rootCallId: 'run-code-1', parentCallId: 'run-code-1', subCallId: 'run-code-1:ptc:1', name: 'read', arguments: { path: 'a.ts' }, isError: false, content: [{ type: 'text', text: 'file body' }], meta: { diff: 'presentation only' } } },
      { seq: 5, time: 5, type: 'tool/ptc-dispatch-start', data: { rootCallId: 'run-code-1', parentCallId: 'run-code-1', subCallId: 'run-code-1:ptc:2', name: 'grep', arguments: { pattern: 'x' } } },
      { seq: 6, time: 6, type: 'tool/ptc-dispatch', data: { rootCallId: 'run-code-1', parentCallId: 'run-code-1', subCallId: 'run-code-1:ptc:2', name: 'grep', arguments: { pattern: 'x' }, isError: true, content: [{ type: 'text', text: 'no match' }], error: { name: 'ToolError', code: 'NO_MATCH' } } },
      { seq: 7, time: 7, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm3', role: 'tool', source: { kind: 'tool', callId: 'run-code-1' }, content: [{ type: 'text', text: 'program done' }] } } },
    ]
    const projected = projectTrajectory('parent', ptc)
    const dispatches = projected.filter(item => item.kind === 'ptc')
    expect(dispatches).toHaveLength(2)
    expect(dispatches.map(item => item.callId)).toEqual(['run-code-1:ptc:1', 'run-code-1:ptc:2'])
    expect(dispatches.map(item => item.status)).toEqual(['success', 'error'])
    expect(dispatches.map(item => item.turn)).toEqual([1, 1])
    expect(dispatches[0]?.preview).toContain('file body')
    // `meta` is presentation metadata: it never becomes the rendered body.
    expect(dispatches[0]?.preview).not.toContain('presentation only')
    // Sub-dispatches are enclosed by the outer run_code call; they do not
    // inflate the outer call count.
    expect(trajectoryOverview(projected, ptc, 7)).toMatchObject({ calls: 1, failures: 1 })
    // Full content stays readable through the exact-ref path.
    const detail = trajectoryDetail(projected, ptc, {
      seq: dispatches[0]!.seq, eventId: dispatches[0]!.eventId, kind: dispatches[0]!.kind, digest: dispatches[0]!.digest,
    })
    expect(detail.text).toContain('file body')
  })

  it('leaves an unsettled PTC dispatch unknown and unselectable instead of advertising unreadable content', () => {
    const partial: SessionEvent[] = [
      { seq: 1, time: 1, type: 'tool/ptc-dispatch-start', data: { rootCallId: 'r', parentCallId: 'r', subCallId: 'r:ptc:1', name: 'read', arguments: { path: 'a.ts' } } },
    ]
    const projected = projectTrajectory('parent', partial)
    const item = projected.find(candidate => candidate.kind === 'ptc')!
    expect(item.status).toBeUndefined()
    expect(item.label).toContain('未结算')
    expect(trajectoryOverview(projected, partial, 1).failures).toBe(0)
    // The bare start carries no readable `content` outcome: advertising full
    // content would make every selection throw "raw content is unavailable".
    // It stays visible but is never selectable.
    expect(item.selectable).toBe(false)
    expect(item.fullContentAvailable).toBe(false)
    const ref = { seq: item.seq, eventId: item.eventId, kind: item.kind, digest: item.digest }
    expect(() => trajectoryDetail(projected, partial, ref)).toThrow(/no separately readable full content/u)
    expect(() => selectTrajectorySnapshots(projected, partial, [ref])).toThrow(/stale or unavailable/u)
    // A settled dispatch keeps working: exact detail + preview masking.
    const settled: SessionEvent[] = [
      ...partial,
      { seq: 2, time: 2, type: 'tool/ptc-dispatch', data: { rootCallId: 'r', parentCallId: 'r', subCallId: 'r:ptc:1', name: 'read', arguments: { path: 'a.ts' }, isError: false, content: [{ type: 'text', text: 'file body' }], meta: { diff: 'presentation only' } } },
    ]
    const settledProjection = projectTrajectory('parent', settled)
    const settledItem = settledProjection.find(candidate => candidate.kind === 'ptc')!
    expect(settledItem).toMatchObject({ selectable: true, fullContentAvailable: true, status: 'success' })
    expect(settledItem.preview).toContain('file body')
    expect(settledItem.preview).not.toContain('presentation only')
    expect(trajectoryDetail(settledProjection, settled, {
      seq: settledItem.seq, eventId: settledItem.eventId, kind: settledItem.kind, digest: settledItem.digest,
    }).text).toContain('file body')
  })

  it('rejects refs stamped under the retired projection version while fresh refs validate', () => {
    expect(TRAJECTORY_PROJECTION_VERSION).toBe('trajectory-v5')
    const items = projectTrajectory('parent', events)
    const call = items.find(item => item.eventId === 'c1')!
    const fresh = { seq: call.seq, eventId: call.eventId, kind: call.kind, digest: call.digest }
    const fullText = trajectoryDetail(items, events, fresh).text

    // Reconstruct the exact digest recipe (version participates in the hash)
    // to stamp the ref as it would have existed under trajectory-v4, where
    // every input field of this settled call was identical.
    const computedKeys = new Set(['chars', 'estimatedTokens', 'digest', 'truncated', 'fullContentAvailable'])
    const input: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(call)) {
      if (!computedKeys.has(key)) input[key] = value
    }
    const stamped = (version: string): string =>
      createHash('sha256').update(JSON.stringify({ version, ...input, fullText })).digest('hex')
    // Recipe sanity: stamping with the live version reproduces the real digest.
    expect(stamped(TRAJECTORY_PROJECTION_VERSION)).toBe(call.digest)

    const v4 = stamped('trajectory-v4')
    expect(v4).not.toBe(call.digest)
    expect(() => trajectoryDetail(items, events, { ...fresh, digest: v4 })).toThrow(/stale/u)
    expect(() => selectTrajectorySnapshots(items, events, [{ ...fresh, digest: v4 }])).toThrow(/stale/u)
    // The fresh v5 ref still validates end to end.
    expect(trajectoryDetail(items, events, fresh).text).toBe(fullText)
    expect(selectTrajectorySnapshots(items, events, [fresh])[0]?.text).toBe(fullText)
  })

  it('never projects a failed or cancelled attempt as a successful assistant answer', () => {
    const attempts: SessionEvent[] = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'step/start', data: { turn: 1, step: 1 } },
      // A durable attempt that committed no surface message (stream error).
      { seq: 3, time: 3, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [{ type: 'chunk', time: 3, chunk: { type: 'error', error: { message: 'stream failed' } } }] } },
      { seq: 4, time: 4, type: 'llm/retry', data: { turn: 1, step: 1 } },
      { seq: 5, time: 5, type: 'llm/retry-started', data: { turn: 1, step: 1 } },
      { seq: 6, time: 6, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'a1', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'recovered answer' }] } } },
      { seq: 7, time: 7, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 8, time: 8, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const projected = projectTrajectory('parent', attempts)
    const assistantItems = projected.filter(item => item.kind === 'assistant')
    // Only the settled response is projected; the failed attempt produces no
    // node at all (dedicated attempt lane is a documented later expansion).
    expect(assistantItems).toHaveLength(1)
    expect(assistantItems[0]?.preview).toContain('recovered answer')
    expect(projected.some(item => item.label.includes('stream failed'))).toBe(false)
  })

  it('ignores runtime subagent lifecycle notifications that were never verified as durable SessionEvents', () => {
    // Runtime `subagent/start` / `subagent/end` notifications must not enter
    // the projection as if they were persisted session events.
    const noisy: SessionEvent[] = [
      { seq: 1, time: 1, type: 'subagent/start', data: { subagentId: 'child-1' } },
      { seq: 2, time: 2, type: 'subagent/end', data: { subagentId: 'child-1', result: 'done' } },
      { seq: 3, time: 3, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' } },
    ]
    const projected = projectTrajectory('parent', noisy)
    expect(projected.find(item => item.kind === 'subagent')).toBeUndefined()
    expect(projected.some(item => item.preview.includes('done'))).toBe(false)
    expect(projected.filter(item => item.kind === 'tool-call')).toHaveLength(1)
  })

  it('uses the supplied model-aware trajectory budget instead of the former fixed 8k cap', () => {
    const longEvents: SessionEvent[] = [{
      seq: 1,
      time: 1,
      type: 'tool/result',
      data: { id: 'long', name: 'read', content: [{ type: 'text', text: 'x'.repeat(40_000) }] },
    }]
    const items = projectTrajectory('parent', longEvents)
    const item = items[0]!
    const refs = [{ seq: item.seq, eventId: item.eventId, kind: item.kind, digest: item.digest }]
    expect(selectTrajectorySnapshots(items, longEvents, refs)[0]?.text).toContain('x'.repeat(40_000))
    expect(() => selectTrajectorySnapshots(items, longEvents, refs, {
      maxItems: 64,
      maxTokens: 9_000,
      maxChars: 36_000,
      description: '30% of a 30k context window',
    })).toThrow(/allows 9,000 tokens/u)
  })

  it('represents empty and cancelled turns from their real lifecycle boundaries', () => {
    const lifecycle: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 140, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { seq: 3, time: 200, type: 'turn/start', data: { turn: 2 } },
      { seq: 4, time: 240, type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
    ]
    const turns = projectTrajectory('parent', lifecycle).filter(item => item.kind === 'turn')
    expect(turns).toHaveLength(2)
    expect(turns.map(item => ({ turn: item.turn, status: item.status, durationMs: item.durationMs, preview: item.preview }))).toEqual([
      { turn: 1, status: 'success', durationMs: 40, preview: 'Turn 1 (empty)' },
      { turn: 2, status: 'cancelled', durationMs: 40, preview: 'Turn 2 (empty)' },
    ])
  })

  it('leaves an unanswered call unknown after a completed step instead of claiming success', () => {
    const incomplete: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 110, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 120, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }] } } },
      { seq: 4, time: 130, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' } },
      { seq: 5, time: 140, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 6, time: 150, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const call = projectTrajectory('parent', incomplete).find(item => item.kind === 'tool-call')
    expect(call).toMatchObject({ callId: 'call-1' })
    expect(call?.status).toBeUndefined()
  })

  it('does not turn one terminal Turn error into failures for every unresolved call', () => {
    const interrupted: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 110, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 120, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'tool-call', id: 'call-a', name: 'read', arguments: '{}' },
        { type: 'tool-call', id: 'call-b', name: 'read', arguments: '{}' },
      ] } } },
      { seq: 4, time: 130, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-a', name: 'read', arguments: '{}' } },
      { seq: 5, time: 140, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-b', name: 'read', arguments: '{}' } },
      { seq: 6, time: 150, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'loop failed' } } } },
    ]
    const projected = projectTrajectory('parent', interrupted)
    expect(projected.filter(item => item.kind === 'tool-call').map(item => item.status)).toEqual([undefined, undefined])
    expect(trajectoryOverview(projected, interrupted, 6).failures).toBe(1)

    const cancelled = interrupted.map(event => event.type === 'turn/end'
      ? { ...event, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } } as SessionEvent
      : event)
    expect(projectTrajectory('parent', cancelled).filter(item => item.kind === 'tool-call').map(item => item.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('does not infer successful Turn completion from a partial log', () => {
    const partial: SessionEvent[] = [
      { seq: 1, time: 100, type: 'assistant/message', data: { turn: 3, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'partial' }] } } },
    ]
    const turn = projectTrajectory('parent', partial).find(item => item.kind === 'turn')
    expect(turn).toMatchObject({ turn: 3, status: undefined })
    expect(turn?.preview).toContain('[assistant] assistant ✓')
  })

  it('counts a failed call and its failed result/terminal turn as one logical failure', () => {
    const failed: SessionEvent[] = [
      { seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 110, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 120, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'answer', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }] } } },
      { seq: 4, time: 130, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' } },
      { seq: 5, time: 140, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'result-1', role: 'tool', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'text', text: 'failed' }], isError: true } } },
      { seq: 6, time: 150, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 7, time: 160, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'tool failed', code: 'TOOL_FAILED' } } } },
    ]
    const projected = projectTrajectory('parent', failed)
    expect(projected.filter(item => item.status === 'error').map(item => item.kind)).toEqual(['turn', 'tool-call', 'error'])
    expect(trajectoryOverview(projected, failed, 7).failures).toBe(1)

    const withAggregate = [...failed, { seq: 8, time: 170, type: 'error', data: { turn: 1, message: 'aggregate failure diagnostic' } } as SessionEvent]
    const aggregateItems = projectTrajectory('parent', withAggregate)
    expect(aggregateItems.filter(item => item.status === 'error')).toHaveLength(4)
    expect(trajectoryOverview(aggregateItems, withAggregate, 8).failures).toBe(1)
  })
})
