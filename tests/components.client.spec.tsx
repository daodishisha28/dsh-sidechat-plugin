// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SideChatHeaderActions, SideChatsView } from '../src/client/components.tsx'
import { SideChatWorkflowHost } from '../src/client/workflow-dialogs.tsx'
import { zh, type SideChatLocaleKey } from '../src/client/locales.ts'
import type { SideChatRecord } from '../src/types.ts'
import { showCommandWorkflow, showFoldPreview, showUsageReport } from '../src/client/workflow-events.ts'

const t = (key: SideChatLocaleKey): string => zh[key]

afterEach(() => { cleanup() })

function record(): SideChatRecord {
  return {
    schema: 1, childSessionId: 'child', parentSessionId: 'parent',
    parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'q', title: '澄清：q', status: 'open',
    seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, messages: [] },
    modelStrategy: { kind: 'default' }, selectedModel: { provider: 'deepseek', model: 'chat' },
    createdAt: 2, updatedAt: 2, revision: 0, folds: [], cites: [],
  }
}

describe('SideChat Client slots', () => {
  it('keeps the Header informational and exposes no operational buttons', async () => {
    const openSession = vi.fn()
    const api = { get: vi.fn(async () => ({ record: record() })) }
    render(<SideChatHeaderActions sessionId={'child' as never} api={api as never} openSession={openSession} refreshSessions={vi.fn()} t={t} />)
    expect(await screen.findByText('SideChat')).toBeTruthy()
    expect(screen.getByText(/父会话 · parent/u)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(openSession).not.toHaveBeenCalled()
    screen.getByRole('link', { name: /父会话/u }).click()
    expect(openSession).toHaveBeenCalledWith('parent')
  })

  it('adds no Header entry on an ordinary Session', async () => {
    const api = { get: vi.fn(async () => ({ record: null })) }
    const rendered = render(<SideChatHeaderActions sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} t={t} />)
    await waitFor(() => { expect(api.get).toHaveBeenCalled() })
    expect(rendered.container.textContent).toBe('')
  })

  it('opens the editable Fold preview when /sidefold emits its workflow event', async () => {
    const api = { get: vi.fn(async () => ({ record: record() })), commitFold: vi.fn() }
    render(<SideChatHeaderActions sessionId={'child' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} t={t} />)
    await screen.findByText('SideChat')
    act(() => { showFoldPreview({ sessionId: 'child', fold: {
      foldId: '11111111-1111-4111-8111-111111111111', revision: 1, state: 'prepared', generatedContent: 'preview',
      baselineSeq: 1, previewThroughSeq: 2, estimatedTokens: 2, structureValid: true, createdAt: 1, updatedAt: 1,
    } }) })
    expect(await screen.findByRole('dialog', { name: 'Fold 预览' })).toBeTruthy()
    expect(screen.getByDisplayValue('preview')).toBeTruthy()
  })

  it('uses an in-page stale Fold confirmation instead of browser confirm', async () => {
    const openSession = vi.fn()
    const commitFold = vi.fn()
      .mockRejectedValueOnce(new Error('parent changed after Fold preview'))
      .mockResolvedValueOnce({ state: 'committed' })
    const api = { get: vi.fn(async () => ({ record: record() })), commitFold }
    render(<SideChatHeaderActions sessionId={'child' as never} api={api as never} openSession={openSession} refreshSessions={vi.fn()} t={t} />)
    await screen.findByText('SideChat')
    act(() => { showFoldPreview({ sessionId: 'child', fold: {
      foldId: '11111111-1111-4111-8111-111111111111', revision: 1, state: 'prepared', generatedContent: 'preview',
      baselineSeq: 1, previewThroughSeq: 2, estimatedTokens: 2, structureValid: true, createdAt: 1, updatedAt: 1,
    } }) })
    screen.getByRole('button', { name: '提交到父会话' }).click()
    expect(await screen.findByRole('button', { name: '仍提交旧预览' })).toBeTruthy()
    screen.getByRole('button', { name: '仍提交旧预览' }).click()
    await waitFor(() => { expect(commitFold).toHaveBeenLastCalledWith('child', expect.any(String), 'preview', true) })
    expect(openSession).toHaveBeenCalledWith('parent')
  })

  it('supports a keyboard-only Fold preview and returns to the parent after commit', async () => {
    const openSession = vi.fn()
    const commitFold = vi.fn(async () => ({ state: 'committed' }))
    const api = { get: vi.fn(async () => ({ record: record() })), commitFold }
    render(<SideChatHeaderActions sessionId={'child' as never} api={api as never} openSession={openSession} refreshSessions={vi.fn()} t={t} />)
    await screen.findByText('SideChat')
    act(() => { showFoldPreview({ sessionId: 'child', fold: {
      foldId: '22222222-2222-4222-8222-222222222222', revision: 1, state: 'prepared', generatedContent: 'preview',
      baselineSeq: 1, previewThroughSeq: 2, estimatedTokens: 2, structureValid: true, createdAt: 1, updatedAt: 1,
    } }) })
    const editor = await screen.findByDisplayValue('preview')
    await waitFor(() => { expect(document.activeElement).toBe(editor) })
    fireEvent.change(editor, { target: { value: 'preview\nsecond line' } })
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    expect(commitFold).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => { expect(commitFold).toHaveBeenCalledWith('child', expect.any(String), 'preview\nsecond line', false) })
    expect(openSession).toHaveBeenCalledWith('parent')
  })

  it('closes the Fold preview with Escape without committing', async () => {
    const commitFold = vi.fn()
    const api = { get: vi.fn(async () => ({ record: record() })), commitFold }
    render(<SideChatHeaderActions sessionId={'child' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} t={t} />)
    await screen.findByText('SideChat')
    act(() => { showFoldPreview({ sessionId: 'child', fold: {
      foldId: '33333333-3333-4333-8333-333333333333', revision: 1, state: 'prepared', generatedContent: 'preview',
      baselineSeq: 1, previewThroughSeq: 2, estimatedTokens: 2, structureValid: true, createdAt: 1, updatedAt: 1,
    } }) })
    const editor = await screen.findByDisplayValue('preview')
    fireEvent.keyDown(editor, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Fold 预览' })).toBeNull() })
    expect(commitFold).not.toHaveBeenCalled()
  })

  it('renders an exact /sideusage report without turning unavailable values into zero', async () => {
    const api = { get: vi.fn(async () => ({ record: record() })) }
    render(<SideChatHeaderActions sessionId={'child' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} t={t} />)
    await screen.findByText('SideChat')
    act(() => { showUsageReport('child', {
      childSessionId: 'child',
      child: {
        complete: true, completedTurns: 1, incompleteTurns: 0,
        totals: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4, reasoningTokens: 3, totalTokens: 20 },
        latestTurn: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4, reasoningTokens: 3, totalTokens: 20 },
      },
      parentDeltaSinceCreate: { available: false, complete: false },
      noReplyModelCalls: 0,
    }) })
    expect(await screen.findByRole('dialog', { name: 'SideChat 用量' })).toBeTruthy()
    expect(screen.getAllByText('20').length).toBeGreaterThan(0)
    expect(screen.getByText(/不可得/u)).toBeTruthy()
    expect(screen.getByText(/append 自身模型调用：0/u)).toBeTruthy()
  })

  it('renders the parent child-session catalog with status, revision and model', async () => {
    const api = { tree: vi.fn(async () => ({ items: [{
      childSessionId: 'child', parentSessionId: 'parent', title: '澄清：q', status: 'open',
      revision: 2, model: 'deepseek/chat', updatedAt: 10, depth: 0,
    }] })) }
    render(<SideChatsView sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} t={t} />)
    await waitFor(() => { expect(screen.getByText('澄清：q')).toBeTruthy() })
    expect(screen.getByText('rev 2')).toBeTruthy()
    expect(screen.getByText('deepseek/chat')).toBeTruthy()
  })

  it('collapses and expands recursive SideChat descendants', async () => {
    const api = { tree: vi.fn(async () => ({ items: [
      { childSessionId: 'child', parentSessionId: 'parent', title: 'B', status: 'open', revision: 1, model: 'm', updatedAt: 10, depth: 0 },
      { childSessionId: 'grandchild', parentSessionId: 'child', title: 'C', status: 'open', revision: 0, model: 'm', updatedAt: 9, depth: 1 },
    ] })) }
    render(<SideChatsView sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} t={t} />)
    expect(await screen.findByText('C')).toBeTruthy()
    screen.getByRole('button', { name: '折叠子会话' }).click()
    await waitFor(() => { expect(screen.queryByText('C')).toBeNull() })
    screen.getByRole('button', { name: '展开子会话' }).click()
    expect(await screen.findByText('C')).toBeTruthy()
  })

  it('runs /side creation in a DSH-native dialog and opens the created Session', async () => {
    const openSession = vi.fn()
    const refreshSessions = vi.fn(async () => undefined)
    const api = {
      seedChoices: vi.fn(async () => ({ items: [{
        messageId: 'm1', role: 'assistant', text: 'Frozen parent answer', seq: 3, turn: 1,
      }] })),
      create: vi.fn(async () => ({ childSessionId: 'child-new', record: record() })),
    }
    render(<SideChatWorkflowHost sessionId={'parent' as never} api={api as never} openSession={openSession} refreshSessions={refreshSessions} />)
    act(() => { expect(showCommandWorkflow({ kind: 'permission-choice', sessionId: 'parent', seedMode: 'tail:1' })).toBe(true) })
    const permissionList = await screen.findByRole('listbox', { name: 'SideChat 权限模式' })
    await waitFor(() => { expect(document.activeElement).toBe(permissionList) })
    expect(screen.getByRole('option', { name: /只读模式/u }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(permissionList, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: '创建 SideChat · 最近 1 条 · 只读模式' })).toBeTruthy()
    await screen.findByText('Frozen parent answer')
    const question = screen.getByPlaceholderText(/描述你希望/u)
    await waitFor(() => { expect(document.activeElement).toBe(question) })
    expect(screen.queryByText('模型策略')).toBeNull()
    expect(screen.getByRole('button', { name: '取消' }).className).toContain('dsh-sidechat-button-metal')
    expect(screen.getByRole('button', { name: '创建并进入 SideChat' }).className).toContain('dsh-sidechat-button-metal')
    fireEvent.change(question, { target: { value: 'Redis 在哪里配置？' } })
    fireEvent.keyDown(question, { key: 'Enter', shiftKey: true })
    expect(api.create).not.toHaveBeenCalled()
    fireEvent.keyDown(question, { key: 'Enter' })
    await waitFor(() => { expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'parent', question: 'Redis 在哪里配置？', seedMode: 'tail:1', permissionMode: 'readonly', modelStrategy: { kind: 'inherit' },
    })) })
    expect(refreshSessions).toHaveBeenCalled()
    expect(openSession).toHaveBeenCalledWith('child-new')
  })

  it('closes SideChat creation with Escape without creating a Session', async () => {
    const api = { seedChoices: vi.fn(async () => ({ items: [] })), create: vi.fn() }
    render(<SideChatWorkflowHost sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} />)
    act(() => { showCommandWorkflow({ kind: 'create', sessionId: 'parent', seedMode: 'tail:1', permissionMode: 'readonly' }) })
    const dialog = await screen.findByRole('dialog', { name: '创建 SideChat · 最近 1 条 · 只读模式' })
    const question = screen.getByPlaceholderText(/描述你希望/u)
    await waitFor(() => { expect(document.activeElement).toBe(question) })
    fireEvent.keyDown(question, { key: 'Escape' })
    await waitFor(() => { expect(dialog.isConnected).toBe(false) })
    expect(api.create).not.toHaveBeenCalled()
  })

  it('selects inherited permissions with arrows before opening the creation form', async () => {
    const api = { seedChoices: vi.fn(async () => ({ items: [] })), create: vi.fn() }
    render(<SideChatWorkflowHost sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} />)
    act(() => { showCommandWorkflow({ kind: 'permission-choice', sessionId: 'parent', seedMode: 'none' }) })
    const list = await screen.findByRole('listbox', { name: 'SideChat 权限模式' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /继承/u }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: '创建 SideChat · 无 Seed · 继承' })).toBeTruthy()
  })

  it('submits withdraw and cite confirmation dialogs with Enter while Shift+Enter keeps a newline', async () => {
    const withdrawFold = vi.fn(async () => ({ state: 'committed' }))
    const cite = vi.fn(async () => ({ state: 'committed' }))
    const api = {
      withdrawFold,
      assistantMessages: vi.fn(async () => ({ items: [{ messageId: 'a1', text: 'answer', seq: 4 }] })),
      cite,
    }
    render(<SideChatWorkflowHost sessionId={'child' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} />)
    act(() => { showCommandWorkflow({ kind: 'withdraw', sessionId: 'child', foldId: '11111111-1111-4111-8111-111111111111', revision: 1 }) })
    const reason = await screen.findByLabelText('撤回原因')
    fireEvent.change(reason, { target: { value: 'new\nreason' } })
    fireEvent.keyDown(reason, { key: 'Enter', shiftKey: true })
    expect(withdrawFold).not.toHaveBeenCalled()
    fireEvent.keyDown(reason, { key: 'Enter' })
    await waitFor(() => { expect(withdrawFold).toHaveBeenCalledWith('child', expect.any(String), 'new\nreason') })

    act(() => { showCommandWorkflow({ kind: 'cite-message', sessionId: 'child', childSessionId: 'child', crossParent: false }) })
    const radio = await screen.findByRole('radio')
    await waitFor(() => { expect((radio as HTMLInputElement).checked).toBe(true) })
    fireEvent.keyDown(radio, { key: 'Enter' })
    await waitFor(() => { expect(cite).toHaveBeenCalledWith('child', 'a1', expect.any(String)) })
  })

  it('keeps Remote failures inside the DSH-native creation dialog', async () => {
    const api = { seedChoices: vi.fn(async () => { throw new Error('HTTP 404') }) }
    render(<SideChatWorkflowHost sessionId={'parent' as never} api={api as never} openSession={vi.fn()} refreshSessions={vi.fn()} />)
    act(() => { showCommandWorkflow({ kind: 'create', sessionId: 'parent', seedMode: 'tail:1', permissionMode: 'readonly' }) })
    expect((await screen.findByRole('alert')).textContent).toContain('无法读取 Seed 候选：HTTP 404')
    expect(screen.getByRole('button', { name: '重试读取' })).toBeTruthy()
  })
})
