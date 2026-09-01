// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrajectoryPanel } from '../src/client/trajectory-panel.tsx'
import { SideChatWorkflowHost } from '../src/client/workflow-dialogs.tsx'
import { installStyles } from '../src/client/styles.ts'
import type { TrajectoryChoice } from '../src/types.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.getElementById('dsh-sidechat-plugin-styles')?.remove()
})

const items: TrajectoryChoice[] = [
  { sourceSessionId: 'parent', seq: 1, eventId: 'turn:1', turn: 1, kind: 'turn', label: 'Turn 1', preview: '[user] inspect', chars: 14, estimatedTokens: 4, redacted: false, truncated: false, fullContentAvailable: false, selectable: true, digest: 'turn-digest', status: 'success', durationMs: 71_370_600 },
  { sourceSessionId: 'parent', seq: 2, eventId: 'u1', turn: 1, kind: 'user', label: 'inspect login', preview: 'inspect login', chars: 13, estimatedTokens: 4, redacted: false, truncated: false, fullContentAvailable: false, selectable: true, digest: 'user-digest', status: 'success' },
  { sourceSessionId: 'parent', seq: 3, eventId: 'm1', turn: 1, kind: 'request', label: 'deepseek/chat', preview: 'route', chars: 5, estimatedTokens: 2, redacted: false, truncated: false, fullContentAvailable: false, selectable: true, digest: 'model-digest', status: 'success' },
  { sourceSessionId: 'parent', seq: 4, eventId: 'c1', turn: 1, kind: 'tool-call', label: 'read', preview: '{"path":"src/login.ts"}', chars: 23, estimatedTokens: 6, redacted: false, truncated: false, fullContentAvailable: true, selectable: true, digest: 'call-digest', status: 'success', toolName: 'read', parallelGroup: 'p1' },
  { sourceSessionId: 'parent', seq: 5, eventId: 'a1', turn: 1, kind: 'assistant', label: 'assistant ✓', preview: 'done', chars: 4, estimatedTokens: 1, redacted: false, truncated: false, fullContentAvailable: false, selectable: true, digest: 'final-digest', status: 'success' },
]

function renderInConversation(api: unknown) {
  return render(<>
    <div data-testid="conversation-column" style={{ position: 'relative' }}>
      <header>
        <div role="tablist"><button type="button" role="tab">对话</button><button type="button" role="tab">轨迹</button><button type="button" role="tab">子会话</button></div>
        <div><TrajectoryPanel sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} /></div>
      </header>
      <main data-testid="messages">conversation</main>
    </div>
    <SideChatWorkflowHost sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn(async () => undefined)} />
  </>)
}

describe('trajectory panel interactions', () => {
  it('opens details on click, toggles S3 selection with Ctrl and forwards refs into creation', async () => {
    const create = vi.fn(async () => ({ childSessionId: 'child', record: {} }))
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 1, calls: 1, subagents: 0, failures: 0, durationMs: 100, capturedThroughSeq: 5 })),
      trajectoryItems: vi.fn(async () => ({ items, capturedThroughSeq: 5, projectionVersion: 'trajectory-v2' })),
      create,
    }
    renderInConversation(api)
    const trigger = await screen.findByRole('button', { name: /轨迹速览 · 1 turns/u })
    expect(trigger.closest('[role="tablist"]')).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.getByLabelText('轨迹速览面板').parentElement).toBe(screen.getByTestId('conversation-column'))
    fireEvent.doubleClick(await screen.findByText('Turn 1'))
    expect(await screen.findByText(/19h49m/u)).toBeTruthy()
    const user = await screen.findByText('inspect login')
    fireEvent.click(user)
    expect(await screen.findByText('Host 投影 · 无敏感字段')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    fireEvent.click(user, { ctrlKey: true })
    expect(await screen.findByText('含 1 项已选')).toBeTruthy()
    fireEvent.pointerDown(screen.getByTestId('messages'))
    expect(screen.queryByLabelText('轨迹速览面板')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByText('含 1 项已选')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '基于所选轨迹提问 →' }))
    const permissions = await screen.findByRole('listbox', { name: 'SideChat 权限模式' })
    fireEvent.keyDown(permissions, { key: 'Enter' })
    expect(await screen.findByText('不可变轨迹快照')).toBeTruthy()
    const question = screen.getByPlaceholderText(/描述你希望/u)
    fireEvent.change(question, { target: { value: '为什么读取这个文件？' } })
    fireEvent.keyDown(question, { key: 'Enter' })
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      seedMode: 'trajectory',
      trajectorySelection: expect.objectContaining({ sourceSessionId: 'parent', refs: [expect.objectContaining({ eventId: 'u1', digest: 'user-digest' })] }),
    })))
  })

  it('loads unredacted full tool content separately from the bounded preview', async () => {
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 1, calls: 1, subagents: 0, failures: 0, durationMs: 100, capturedThroughSeq: 5 })),
      trajectoryItems: vi.fn(async () => ({ items, capturedThroughSeq: 5, projectionVersion: 'trajectory-v2' })),
      trajectoryDetail: vi.fn(async () => ({
        seq: 4, eventId: 'c1', kind: 'tool-call', digest: 'call-digest',
        text: '{"path":"C:\\\\Users\\\\zzc\\\\secret.txt","apiKey":"sk-visible"}',
        chars: 62, estimatedTokens: 16, redacted: false,
      })),
    }
    renderInConversation(api)
    fireEvent.click(await screen.findByRole('button', { name: /轨迹速览 · 1 turns/u }))
    fireEvent.doubleClick(await screen.findByText('Turn 1'))
    fireEvent.click(await screen.findByText('read'))
    expect(await screen.findByText(/sk-visible/u)).toBeTruthy()
    expect(screen.getByText('工具原文可能包含 API key、Cookie、环境变量或本机路径，请在加入 SideChat 前确认内容。')).toBeTruthy()
    expect(api.trajectoryDetail).toHaveBeenCalledWith('parent', expect.objectContaining({ eventId: 'c1', digest: 'call-digest' }), expect.any(AbortSignal))
  })

  it('keeps trigger and overlay out of flow and supports every close path', async () => {
    const dispose = installStyles()
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 1, calls: 1, subagents: 0, failures: 0, durationMs: 100, capturedThroughSeq: 5 })),
      trajectoryItems: vi.fn(async () => ({ items, capturedThroughSeq: 5, projectionVersion: 'trajectory-v2' })),
    }
    renderInConversation(api)
    const trigger = await screen.findByRole('button', { name: /轨迹速览 · 1 turns/u })
    const tabActions = trigger.parentElement!
    expect(getComputedStyle(tabActions).position).toBe('absolute')
    const before = screen.getByTestId('messages').getBoundingClientRect()

    fireEvent.click(trigger)
    const panel = screen.getByLabelText('轨迹速览面板')
    expect(getComputedStyle(panel).position).toBe('absolute')
    expect(panel.style.height).toBe('320px')
    expect(screen.getByTestId('messages').getBoundingClientRect()).toEqual(before)
    fireEvent.click(trigger)
    expect(screen.queryByLabelText('轨迹速览面板')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '收起 ▴' }))
    expect(screen.queryByLabelText('轨迹速览面板')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('轨迹速览面板')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByTestId('messages'))
    expect(screen.queryByLabelText('轨迹速览面板')).toBeNull()
    dispose()
  })

  it('keeps the trajectory workspace open underneath the SideChat workflow layer', async () => {
    installStyles()
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 1, calls: 1, subagents: 0, failures: 0, durationMs: 100, capturedThroughSeq: 5 })),
      trajectoryItems: vi.fn(async () => ({ items, capturedThroughSeq: 5, projectionVersion: 'trajectory-v2' })),
    }
    renderInConversation(api)
    fireEvent.click(await screen.findByRole('button', { name: /轨迹速览 · 1 turns/u }))
    fireEvent.doubleClick(await screen.findByText('Turn 1'))
    fireEvent.click(await screen.findByText('inspect login'), { ctrlKey: true })
    const panel = screen.getByLabelText('轨迹速览面板')
    fireEvent.click(within(panel).getByRole('button', { name: '基于所选轨迹提问 →' }))

    const permissions = await screen.findByRole('listbox', { name: 'SideChat 权限模式' })
    const backdrop = permissions.closest('.dsh-sidechat-dialog-backdrop') as HTMLElement
    expect(backdrop.parentElement).toBe(document.body)
    expect(Number(getComputedStyle(backdrop).zIndex)).toBeGreaterThan(Number(getComputedStyle(panel).zIndex))
    const inherit = screen.getByRole('option', { name: /继承/u })
    fireEvent.pointerDown(inherit)
    fireEvent.click(inherit)
    expect(screen.getByLabelText('轨迹速览面板')).toBe(panel)

    const dialog = await screen.findByRole('dialog', { name: '创建 SideChat · 所选轨迹 · 继承' })
    const question = screen.getByPlaceholderText(/描述你希望/u)
    fireEvent.keyDown(question, { key: 'Escape' })
    await waitFor(() => { expect(dialog.isConnected).toBe(false) })
    expect(screen.getByLabelText('轨迹速览面板')).toBe(panel)
    expect(screen.getByText('含 1 项已选')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('轨迹速览面板')).toBeNull()
  })

  it('keeps all adjacent edges in the node transform through nested expansion, zoom and pan', async () => {
    const nestedItems: TrajectoryChoice[] = [
      ...items.slice(0, 3),
      { sourceSessionId: 'parent', seq: 4, eventId: 'sa1', turn: 1, kind: 'subagent', label: 'Task: search agent', preview: 'search', chars: 6, estimatedTokens: 2, redacted: false, truncated: false, fullContentAvailable: true, selectable: true, digest: 'subagent-digest', status: 'success', childTurns: 2, toolName: 'Task' },
      { ...items[4]!, seq: 5 },
      { sourceSessionId: 'parent', seq: 6, eventId: 'turn:2', turn: 2, kind: 'turn', label: 'Turn 2', preview: 'next', chars: 4, estimatedTokens: 1, redacted: false, truncated: false, fullContentAvailable: false, selectable: true, digest: 'turn-2-digest', status: 'success', durationMs: 2_000 },
    ]
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 2, calls: 1, subagents: 1, failures: 0, durationMs: 71_372_600, capturedThroughSeq: 6 })),
      trajectoryItems: vi.fn(async () => ({ items: nestedItems, capturedThroughSeq: 6, projectionVersion: 'trajectory-v2' })),
    }
    renderInConversation(api)
    fireEvent.click(await screen.findByRole('button', { name: /轨迹速览 · 2 turns/u }))
    fireEvent.doubleClick(await screen.findByText('Turn 1'))
    const panel = screen.getByLabelText('轨迹速览面板')
    await waitFor(() => { expect(panel.querySelectorAll('.dsh-trajectory-edges path')).toHaveLength(5) })
    fireEvent.doubleClick(screen.getByText('Task: search agent'))
    await waitFor(() => { expect(panel.querySelectorAll('.dsh-trajectory-edges path')).toHaveLength(7) })

    const world = panel.querySelector<HTMLElement>('.dsh-trajectory-world')!
    const edgeLayer = panel.querySelector<SVGElement>('.dsh-trajectory-edges')!
    expect(edgeLayer.parentElement).toBe(world)
    expect(edgeLayer.getAttribute('viewBox')).toBeNull()
    const canvas = panel.querySelector<HTMLElement>('.dsh-trajectory-canvas')!
    fireEvent.wheel(canvas, { deltaY: -1, clientX: 40, clientY: 40 })
    expect(world.style.transform).toContain('scale(1.1)')
    const afterZoom = world.style.transform
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 20 })
    fireEvent.mouseMove(canvas, { clientX: 45, clientY: 55 })
    expect(world.style.transform).not.toBe(afterZoom)
    expect(world.style.transform).toContain('scale(1.1)')
    expect(panel.querySelectorAll('.dsh-trajectory-edges path')).toHaveLength(7)
    for (let index = 0; index < 20; index += 1) fireEvent.click(within(panel).getByRole('button', { name: '−' }))
    expect(world.style.transform).toContain('scale(0.5)')
    expect(panel.querySelectorAll('.dsh-trajectory-edges path')).toHaveLength(7)
    for (let index = 0; index < 30; index += 1) fireEvent.click(within(panel).getByRole('button', { name: '＋' }))
    expect(world.style.transform).toContain('scale(2)')
    expect(panel.querySelectorAll('.dsh-trajectory-edges path')).toHaveLength(7)
  })

  it('renders SideChat context appended outside any turn in sequence order', async () => {
    const contextItems: TrajectoryChoice[] = [
      ...items,
      { sourceSessionId: 'parent', seq: 6, eventId: 'fold-1', kind: 'fold-note', label: '↩ SideChat Fold', preview: '[SideChat fold id=f1 rev=1 source=child]\nFold result', chars: 55, estimatedTokens: 14, redacted: false, truncated: false, fullContentAvailable: false, selectable: false, digest: 'fold-digest', status: 'success' },
      { sourceSessionId: 'parent', seq: 7, eventId: 'cite-1', kind: 'fold-note', label: '↩ SideChat Cite', preview: '[SideChat cite id=c1 source=child message=m1]\nCited reply', chars: 58, estimatedTokens: 15, redacted: false, truncated: false, fullContentAvailable: false, selectable: false, digest: 'cite-digest', status: 'success' },
      { sourceSessionId: 'parent', seq: 8, eventId: 'withdrawal-1', kind: 'fold-note', label: '↩ SideChat Fold 撤回', preview: '[SideChat fold-withdrawal id=f1 rev=1 source=child]\nWithdrawn', chars: 64, estimatedTokens: 16, redacted: false, truncated: false, fullContentAvailable: false, selectable: false, digest: 'withdrawal-digest', status: 'success' },
      { sourceSessionId: 'parent', seq: 9, eventId: 'turn:2', turn: 2, kind: 'turn', label: 'Turn 2', preview: '[user] continue', chars: 15, estimatedTokens: 4, redacted: false, truncated: false, fullContentAvailable: false, selectable: true, digest: 'turn-2-digest', status: 'success', durationMs: 10 },
    ]
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 2, calls: 1, subagents: 0, failures: 0, durationMs: 130, capturedThroughSeq: 9 })),
      trajectoryItems: vi.fn(async () => ({ items: contextItems, capturedThroughSeq: 9, projectionVersion: 'trajectory-v2' })),
    }
    renderInConversation(api)
    fireEvent.click(await screen.findByRole('button', { name: /轨迹速览 · 2 turns/u }))
    const panel = screen.getByLabelText('轨迹速览面板')
    expect(within(panel).getByText('↩ SideChat Fold')).toBeTruthy()
    expect(within(panel).getByText('↩ SideChat Cite')).toBeTruthy()
    expect(within(panel).getByText('↩ SideChat Fold 撤回')).toBeTruthy()
    expect([...panel.querySelectorAll('.dsh-trajectory-node-name')].map(node => node.textContent)).toEqual([
      'Turn 1▸', '↩ SideChat Fold', '↩ SideChat Cite', '↩ SideChat Fold 撤回', 'Turn 2▸',
    ])
    fireEvent.click(within(panel).getByText('↩ SideChat Cite'))
    expect(await within(panel).findByText(/Cited reply/u)).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: '选择此项' })).toBeNull()
  })

  it('renders the persistent empty state with disabled actions', async () => {
    const api = {
      trajectoryOverview: vi.fn(async () => ({ turns: 0, calls: 0, subagents: 0, failures: 0, durationMs: 0, capturedThroughSeq: 0 })),
      trajectoryItems: vi.fn(async () => ({ items: [], capturedThroughSeq: 0, projectionVersion: 'trajectory-v2' })),
    }
    renderInConversation(api)
    fireEvent.click(await screen.findByRole('button', { name: '轨迹速览 · 暂无数据' }))
    expect(screen.getByText('暂无轨迹事件 · 会话产生首个 turn 后此处自动生成轨迹图')).toBeTruthy()
    const panel = screen.getByLabelText('轨迹速览面板')
    expect((within(panel).getByRole('button', { name: '⤢ 适应视图' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(panel).getByRole('button', { name: '全部收起' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(panel).getByRole('button', { name: '基于所选轨迹提问 →' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
