import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AssistantChoice,
  CreateSideChatRequest,
  PermissionMode,
  SeedMessage,
  SeedMode,
} from '../types.ts'
import { seedStats } from '../seed.ts'
import type { CommonInjected } from './components.tsx'
import {
  onCommandWorkflow,
  refreshSideChatIdentity,
  type CommandWorkflowRequest,
} from './workflow-events.ts'

type WorkflowProps = PropsRuntime<'conversation.session.header.actions'> & CommonInjected

const CHOICE_SEED_MODES = new Set<SeedMode>([
  'tail:1', 'tail:2', 'tail:4', 'pick:1', 'pick:many', 'turn', 'selection', 'summary',
])

const SEED_LABELS: Record<SeedMode, string> = {
  'tail:1': '最近 1 条',
  task: 'Task 式生成',
  none: '无 Seed',
  'tail:2': '最近 2 条',
  'tail:4': '最近 4 条',
  'pick:1': '选择 1 条',
  'pick:many': '选择多条',
  turn: '选择 Turn',
  selection: '文本片段',
  summary: 'Seed 摘要',
}

const PERMISSION_OPTIONS: ReadonlyArray<{
  readonly id: PermissionMode
  readonly label: string
  readonly detail: string
}> = [
  {
    id: 'readonly',
    label: '只读模式（推荐）',
    detail: 'read / glob / grep / Shell / web / plan / 提问 / 子代理 / workflow；同时受父会话权限过滤',
  },
  {
    id: 'inherit',
    label: '继承',
    detail: '继承父会话当前 Agent preset、工具权限、沙箱和审批策略',
  },
]

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compact(text: string, limit = 220): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

function submitOnPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.form?.requestSubmit()
}

function submitFormOnPlainEnter(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  if (event.target instanceof HTMLTextAreaElement) return
  if (event.target instanceof HTMLButtonElement) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.requestSubmit()
}

function DialogShell({
  title,
  titleTag,
  ariaLabel,
  className,
  children,
  onClose,
}: {
  readonly title: string
  readonly titleTag?: string | undefined
  readonly ariaLabel?: string
  readonly className?: string
  readonly children: ReactNode
  readonly onClose: () => void
}) {
  return (
    <div className="dsh-sidechat-dialog-backdrop" role="presentation">
      <section
        className={`dsh-sidechat-dialog dsh-sidechat-workflow${className === undefined ? '' : ` ${className}`}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <header className="dsh-sidechat-dialog-header">
          <h2>{title}{titleTag !== undefined && <span className="dsh-sidechat-dialog-tag">{titleTag}</span>}</h2>
          <button className="dsh-sidechat-icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  )
}

/** Command workflow host rendered inside the DSH Session tree, never in browser-native dialogs. */
export function SideChatWorkflowHost({ sessionId, api, openSession, refreshSessions }: WorkflowProps) {
  const [workflow, setWorkflow] = useState<CommandWorkflowRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const permissionChoiceRef = useRef<HTMLDivElement>(null)

  const [question, setQuestion] = useState('')
  const [seedChoices, setSeedChoices] = useState<SeedMessage[] | null>(null)
  const [choiceReload, setChoiceReload] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null)
  const [selectionMessageId, setSelectionMessageId] = useState<string | null>(null)
  const [selectionStart, setSelectionStart] = useState('0')
  const [selectionEnd, setSelectionEnd] = useState('0')
  const [assistants, setAssistants] = useState<AssistantChoice[] | null>(null)
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [permissionIndex, setPermissionIndex] = useState(0)

  useEffect(() => onCommandWorkflow(sessionId, (request) => {
    setWorkflow(request)
    setBusy(false)
    setError(null)
    setQuestion('')
    setSeedChoices(null)
    setSelectedIds(new Set())
    setSelectedTurn(null)
    setSelectionMessageId(null)
    setSelectionStart('0')
    setSelectionEnd('0')
    setAssistants(null)
    setSelectedAssistantId(null)
    setWithdrawReason('')
    setPermissionIndex(0)
  }), [sessionId])

  useEffect(() => {
    if (workflow?.kind !== 'permission-choice') return
    const timer = window.setTimeout(() => { permissionChoiceRef.current?.focus({ preventScroll: true }) }, 0)
    return () => { window.clearTimeout(timer) }
  }, [workflow])

  useEffect(() => {
    if (workflow?.kind !== 'create') return
    const focusQuestion = () => {
      const textarea = questionRef.current
      if (textarea === null) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
    // DSH popupSelect restores focus to the composer after onSelect settles.
    // Run after that native cleanup so the newly opened workflow owns focus.
    const timer = window.setTimeout(focusQuestion, 0)
    return () => { window.clearTimeout(timer) }
  }, [workflow])

  useEffect(() => {
    if (workflow?.kind !== 'create' || !CHOICE_SEED_MODES.has(workflow.seedMode)) return
    const abort = new AbortController()
    void api.seedChoices(workflow.sessionId, abort.signal).then(({ items }) => {
      setSeedChoices(items)
      const latest = items.at(-1)
      if (latest !== undefined) {
        setSelectedIds(new Set([latest.messageId]))
        setSelectionMessageId(latest.messageId)
        setSelectionStart('0')
        setSelectionEnd(String(latest.text.length))
      }
      const latestTurn = items.flatMap(item => item.turn === undefined ? [] : [item.turn]).at(-1)
      setSelectedTurn(latestTurn ?? null)
    }, (reason) => {
      if (!abort.signal.aborted) {
        setSeedChoices([])
        setError(`无法读取 Seed 候选：${errorText(reason)}`)
      }
    })
    return () => { abort.abort() }
  }, [api, choiceReload, workflow])

  useEffect(() => {
    if (workflow?.kind !== 'cite-message') return
    const abort = new AbortController()
    void api.assistantMessages(workflow.childSessionId, abort.signal).then(({ items }) => {
      setAssistants(items)
      setSelectedAssistantId(items.at(-1)?.messageId ?? null)
    }, (reason) => {
      if (!abort.signal.aborted) {
        setAssistants([])
        setError(`无法读取 SideChat 回复：${errorText(reason)}`)
      }
    })
    return () => { abort.abort() }
  }, [api, workflow])

  const previewMessages = useMemo(() => {
    if (workflow?.kind !== 'create' || seedChoices === null) return []
    if (workflow.seedMode === 'tail:1') return seedChoices.slice(-1)
    if (workflow.seedMode === 'tail:2') return seedChoices.slice(-2)
    if (workflow.seedMode === 'tail:4') return seedChoices.slice(-4)
    if (workflow.seedMode === 'turn') return seedChoices.filter(item => item.turn === selectedTurn)
    if (workflow.seedMode === 'selection') {
      const picked = seedChoices.find(item => item.messageId === selectionMessageId)
      const start = Number(selectionStart)
      const end = Number(selectionEnd)
      if (picked === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end <= start || end > picked.text.length) return []
      return [{ ...picked, text: picked.text.slice(start, end), selection: { start, end } }]
    }
    return seedChoices.filter(item => selectedIds.has(item.messageId))
  }, [seedChoices, selectedIds, selectedTurn, selectionEnd, selectionMessageId, selectionStart, workflow])

  const close = () => { if (!busy) setWorkflow(null) }

  const setNotice = (title: string, message: string, tone: 'success' | 'warning' | 'error' = 'success') => {
    setWorkflow({ kind: 'notice', sessionId, title, message, tone })
    setBusy(false)
    setError(null)
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (workflow?.kind !== 'create' || busy) return
    const trimmedQuestion = question.trim()
    if (trimmedQuestion === '') { setError('请输入要澄清的问题'); return }
    let seedOptions: Pick<CreateSideChatRequest, 'pickMessageId' | 'selectedMessageIds' | 'turn' | 'selection' | 'summarySourceMessageIds'> = {}
    if (workflow.seedMode === 'pick:1') {
      const id = previewMessages[0]?.messageId
      if (id === undefined) { setError('请选择一条消息'); return }
      seedOptions = { pickMessageId: id }
    } else if (workflow.seedMode === 'pick:many') {
      if (previewMessages.length === 0) { setError('请至少选择一条消息'); return }
      seedOptions = { selectedMessageIds: previewMessages.map(item => item.messageId) }
    } else if (workflow.seedMode === 'summary') {
      if (previewMessages.length === 0) { setError('请至少选择一条摘要来源消息'); return }
      seedOptions = { summarySourceMessageIds: previewMessages.map(item => item.messageId) }
    } else if (workflow.seedMode === 'turn') {
      if (selectedTurn === null || previewMessages.length === 0) { setError('请选择一个有效 Turn'); return }
      seedOptions = { turn: selectedTurn }
    } else if (workflow.seedMode === 'selection') {
      const picked = previewMessages[0]
      if (picked?.selection === undefined) { setError('请输入有效的文本字符区间'); return }
      seedOptions = { selection: { messageId: picked.messageId, ...picked.selection } }
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.create({
        parentSessionId: workflow.sessionId,
        question: trimmedQuestion,
        seedMode: workflow.seedMode,
        permissionMode: workflow.permissionMode,
        ...seedOptions,
        modelStrategy: { kind: 'inherit' },
      })
      await refreshSessions()
      setWorkflow(null)
      openSession(result.childSessionId)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (event: FormEvent) => {
    event.preventDefault()
    if (workflow?.kind !== 'withdraw') return
    const reason = withdrawReason.trim()
    if (reason === '') { setError('请输入软撤回原因'); return }
    setBusy(true)
    setError(null)
    try {
      const result = await api.withdrawFold(workflow.sessionId, workflow.foldId, reason)
      refreshSideChatIdentity(workflow.sessionId)
      setNotice(
        `Fold rev-${workflow.revision} 已撤回`,
        result.state === 'pending' ? '撤回通知已排队，等待父会话安全边界。' : '父会话已收到软撤回通知；审计历史仍保留。',
      )
    } catch (reasonValue) {
      setError(errorText(reasonValue))
      setBusy(false)
    }
  }

  const cite = async (event: FormEvent) => {
    event.preventDefault()
    if (workflow?.kind !== 'cite-message' || selectedAssistantId === null) return
    setBusy(true)
    setError(null)
    try {
      const result = workflow.crossParent
        ? await api.crossCite(workflow.sessionId, workflow.childSessionId, selectedAssistantId, crypto.randomUUID())
        : await api.cite(workflow.childSessionId, selectedAssistantId, crypto.randomUUID())
      setNotice(
        workflow.crossParent ? '跨父引用已提交' : '引用已提交',
        result.state === 'pending' ? '引用已排队，等待目标会话安全边界。' : '不可变回复快照已写入目标会话；没有触发模型调用。',
      )
    } catch (reason) {
      setError(errorText(reason))
      setBusy(false)
    }
  }

  if (workflow === null) return null

  if (workflow.kind === 'notice') {
    return (
      <DialogShell title={workflow.title} onClose={close} className="dsh-sidechat-dialog-narrow">
        <div className={`dsh-sidechat-notification-icon dsh-sidechat-notification-icon-${workflow.tone ?? 'success'}`} aria-hidden="true">{workflow.tone === 'error' ? '×' : workflow.tone === 'warning' ? '!' : '✓'}</div>
        <p className="dsh-sidechat-notification-message" role="status">{workflow.message}</p>
        <footer className="dsh-sidechat-dialog-footer" style={{ justifyContent: 'center' }}><button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" onClick={close}>关闭</button></footer>
      </DialogShell>
    )
  }

  if (workflow.kind === 'permission-choice') {
    const choosePermission = (permissionMode: PermissionMode) => {
      setWorkflow({
        kind: 'create',
        sessionId: workflow.sessionId,
        seedMode: workflow.seedMode,
        permissionMode,
      })
    }
    return (
      <DialogShell title="选择 SideChat 权限" titleTag={SEED_LABELS[workflow.seedMode]} onClose={close}>
        <div className="dsh-sidechat-steps" aria-label="创建步骤">
          <span className="dsh-sidechat-step dsh-sidechat-step-current"><span className="dsh-sidechat-step-dot">1</span>权限</span>
          <span className="dsh-sidechat-step-line" />
          <span className="dsh-sidechat-step"><span className="dsh-sidechat-step-dot">2</span>问题与 Seed</span>
          <span className="dsh-sidechat-step-line" />
          <span className="dsh-sidechat-step"><span className="dsh-sidechat-step-dot">3</span>确认创建</span>
        </div>
        <p className="dsh-sidechat-muted">权限会在 Host 端按父会话当前能力再次校验。</p>
        <div
          ref={permissionChoiceRef}
          className="dsh-sidechat-strategy-list"
          role="listbox"
          aria-label="SideChat 权限模式"
          aria-activedescendant={`dsh-sidechat-permission-${PERMISSION_OPTIONS[permissionIndex]?.id ?? 'readonly'}`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              event.stopPropagation()
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setPermissionIndex(current => (current + direction + PERMISSION_OPTIONS.length) % PERMISSION_OPTIONS.length)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              const option = PERMISSION_OPTIONS[permissionIndex]
              if (option !== undefined) choosePermission(option.id)
            }
          }}
        >
          {PERMISSION_OPTIONS.map((option, index) => (
            <button
              id={`dsh-sidechat-permission-${option.id}`}
              className={`dsh-sidechat-strategy-option${index === permissionIndex ? ' is-active' : ''}`}
              type="button"
              role="option"
              aria-selected={index === permissionIndex}
              key={option.id}
              onMouseEnter={() => { setPermissionIndex(index) }}
              onClick={() => { choosePermission(option.id) }}
            >
              <span className="dsh-sidechat-radio" aria-hidden="true" />
              <strong>{option.id === 'readonly' ? <>只读模式<span className="dsh-sidechat-rec">推荐</span></> : option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
        <footer className="dsh-sidechat-dialog-footer">
          <span className="dsh-sidechat-keyboard-hint"><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 确认 · <kbd>Esc</kbd> 取消</span>
          <button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" onClick={close}>取消</button>
        </footer>
      </DialogShell>
    )
  }

  if (workflow.kind === 'withdraw') {
    return (
      <DialogShell title="软撤回 Fold" titleTag={`rev-${workflow.revision}`} onClose={close} className="dsh-sidechat-dialog-narrow">
        <form onSubmit={(event) => { void withdraw(event) }}>
          <div className="dsh-sidechat-notice-bar" role="note">原 Fold 消息不会删除；父会话会收到一条正式撤回通知，审计历史保留。</div>
          <label className="dsh-sidechat-field">
            <span>撤回原因</span>
            <textarea className="dsh-sidechat-compact-textarea" value={withdrawReason} onChange={event => { setWithdrawReason(event.currentTarget.value) }} onKeyDown={submitOnPlainEnter} autoFocus />
          </label>
          {error !== null && <p className="dsh-sidechat-error" role="alert">{error}</p>}
          <footer className="dsh-sidechat-dialog-footer">
            <span className="dsh-sidechat-keyboard-hint"><kbd>Enter</kbd> 提交 · <kbd>Esc</kbd> 取消</span>
            <button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" disabled={busy} onClick={close}>取消</button>
            <button className="dsh-sidechat-button dsh-sidechat-button-danger" type="submit" disabled={busy}>{busy ? '提交中…' : '确认软撤回'}</button>
          </footer>
        </form>
      </DialogShell>
    )
  }

  if (workflow.kind === 'cite-message') {
    return (
      <DialogShell title={workflow.crossParent ? '选择要跨父引用的回复' : '选择要引用到父会话的回复'} titleTag={workflow.crossParent ? '跨父' : undefined} onClose={close}>
        <form onSubmit={(event) => { void cite(event) }} onKeyDown={submitFormOnPlainEnter}>
          {workflow.crossParent && <div className="dsh-sidechat-notice-bar" role="note">将把所选回复的不可变快照写入当前 Session；不会调用当前 Session 的模型。</div>}
          {assistants === null && <div className="dsh-sidechat-choice-list" aria-label="正在读取 assistant 回复"><span className="dsh-sidechat-skeleton" /><span className="dsh-sidechat-skeleton" /><span className="dsh-sidechat-skeleton" /></div>}
          {assistants?.length === 0 && <p>该 SideChat 还没有可引用的 assistant 文本回复。</p>}
          <div className="dsh-sidechat-choice-list">
            {assistants?.map(item => (
              <label className="dsh-sidechat-choice" key={item.messageId}>
                <input type="radio" name="assistant-message" checked={selectedAssistantId === item.messageId} onChange={() => { setSelectedAssistantId(item.messageId) }} />
                <span className="dsh-sidechat-radio" aria-hidden="true" />
                <span className="dsh-sidechat-seed-role" aria-hidden="true">A</span>
                <span><strong>assistant · seq {item.seq}</strong><small>{compact(item.text)}</small></span>
              </label>
            ))}
          </div>
          {error !== null && <p className="dsh-sidechat-error" role="alert">{error}</p>}
          <footer className="dsh-sidechat-dialog-footer">
            <span className="dsh-sidechat-keyboard-hint"><kbd>Enter</kbd> 引用 · <kbd>Esc</kbd> 取消</span>
            <button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" disabled={busy} onClick={close}>取消</button>
            <button className="dsh-sidechat-button dsh-sidechat-button-primary" type="submit" disabled={busy || selectedAssistantId === null}>{busy ? '提交中…' : '引用回复'}</button>
          </footer>
        </form>
      </DialogShell>
    )
  }

  const mode = workflow.seedMode
  const choicesLoading = CHOICE_SEED_MODES.has(mode) && seedChoices === null
  const stats = previewMessages.length === 0 ? null : seedStats(previewMessages)
  const turns = [...new Set((seedChoices ?? []).flatMap(item => item.turn === undefined ? [] : [item.turn]))]
  const selectionMessage = seedChoices?.find(item => item.messageId === selectionMessageId)
  const toggleMessage = (messageId: string, single: boolean) => {
    setSelectedIds(current => {
      if (single) return new Set([messageId])
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else if (next.size < 8) next.add(messageId)
      return next
    })
  }

  return (
    <DialogShell
      title="创建 SideChat"
      titleTag={`${SEED_LABELS[mode]} · ${workflow.permissionMode === 'inherit' ? '继承' : '只读模式'}`}
      ariaLabel={`创建 SideChat · ${SEED_LABELS[mode]} · ${workflow.permissionMode === 'inherit' ? '继承' : '只读模式'}`}
      onClose={close}
    >
      <form onSubmit={(event) => { void create(event) }}>
        <div className="dsh-sidechat-steps" aria-label="创建步骤">
          <span className="dsh-sidechat-step dsh-sidechat-step-done"><span className="dsh-sidechat-step-dot">✓</span>权限</span>
          <span className="dsh-sidechat-step-line" />
          <span className="dsh-sidechat-step dsh-sidechat-step-current"><span className="dsh-sidechat-step-dot">2</span>问题与 Seed</span>
          <span className="dsh-sidechat-step-line" />
          <span className="dsh-sidechat-step"><span className="dsh-sidechat-step-dot">3</span>确认创建</span>
        </div>
        <label className="dsh-sidechat-field">
          <span>澄清问题</span>
          <textarea
            ref={questionRef}
            className="dsh-sidechat-question"
            value={question}
            onChange={event => { setQuestion(event.currentTarget.value) }}
            onKeyDown={submitOnPlainEnter}
            placeholder="描述你希望在独立 SideChat 中澄清的问题…"
          />
        </label>

        {mode === 'task' && <p className="dsh-sidechat-notice dsh-sidechat-notice-warning">会额外调用一次父会话最近实际模型，生成不超过 500 token 的 Task 式最小上下文；不会写入、唤醒或推进父会话。</p>}
        {mode === 'summary' && <p className="dsh-sidechat-notice dsh-sidechat-notice-warning">会额外调用一次 B 继承的父会话模型生成不超过 500 token 的 Seed 摘要；原始选择仅冻结在 provenance。</p>}
        {mode === 'none' && <p className="dsh-sidechat-muted">不复制任何父会话文本，只把澄清问题发送给 B。</p>}

        {choicesLoading && <p>正在读取可用 Seed 消息…</p>}
        {error?.startsWith('无法读取 Seed 候选：') === true && (
          <div>
            <p className="dsh-sidechat-error" role="alert">{error}</p>
            <button className="dsh-sidechat-button" type="button" onClick={() => { setSeedChoices(null); setError(null); setChoiceReload(value => value + 1) }}>重试读取</button>
          </div>
        )}

        {(mode === 'pick:1' || mode === 'pick:many' || mode === 'summary' || mode === 'selection') && seedChoices !== null && (
          <div className="dsh-sidechat-choice-list" aria-label="Seed 消息">
            {seedChoices.map(item => {
              const single = mode === 'pick:1' || mode === 'selection'
              const checked = mode === 'selection' ? selectionMessageId === item.messageId : selectedIds.has(item.messageId)
              return (
                <label className="dsh-sidechat-choice" key={item.messageId}>
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={single ? 'seed-message' : undefined}
                    checked={checked}
                    onChange={() => {
                      if (mode === 'selection') {
                        setSelectionMessageId(item.messageId)
                        setSelectionStart('0')
                        setSelectionEnd(String(item.text.length))
                      } else toggleMessage(item.messageId, single)
                    }}
                  />
                  <span><strong>{item.role} · seq {item.seq}{item.turn === undefined ? '' : ` · turn ${item.turn}`}</strong><small>{compact(item.text)}</small></span>
                </label>
              )
            })}
          </div>
        )}

        {mode === 'turn' && (
          <div className="dsh-sidechat-inline-options" aria-label="Seed Turn">
            {turns.map(turn => <label key={turn}><input type="radio" name="seed-turn" checked={selectedTurn === turn} onChange={() => { setSelectedTurn(turn) }} /> Turn {turn}</label>)}
          </div>
        )}

        {mode === 'selection' && selectionMessage !== undefined && (
          <div className="dsh-sidechat-range-grid">
            <label className="dsh-sidechat-field"><span>起始字符</span><input type="number" min={0} max={Math.max(0, selectionMessage.text.length - 1)} value={selectionStart} onChange={event => { setSelectionStart(event.currentTarget.value) }} /></label>
            <label className="dsh-sidechat-field"><span>结束字符</span><input type="number" min={1} max={selectionMessage.text.length} value={selectionEnd} onChange={event => { setSelectionEnd(event.currentTarget.value) }} /></label>
          </div>
        )}

        {CHOICE_SEED_MODES.has(mode) && !choicesLoading && error?.startsWith('无法读取 Seed 候选：') !== true && (
          <section className="dsh-sidechat-seed-preview">
            <div className="dsh-sidechat-seed-header">
              <h3>不可变 Seed 预览</h3>
              {stats !== null && <span className="dsh-sidechat-seed-token">{stats.chars.toLocaleString()} chars · 约 {stats.estimatedTokens.toLocaleString()} token</span>}
            </div>
             {previewMessages.length === 0
               ? <p>没有候选文本；仍可创建，provenance 会记录所选模式。</p>
               : <div className="dsh-sidechat-seed-scroll">
                   {previewMessages.map(item => (
                     <div className="dsh-sidechat-seed-bubble" key={`${item.messageId}-${item.selection?.start ?? 0}`}>
                       <span className="dsh-sidechat-seed-role" aria-hidden="true">{item.role === 'assistant' ? 'A' : 'U'}</span>
                       <span className="dsh-sidechat-seed-message"><strong>{item.role} · seq {item.seq}</strong> {item.text}</span>
                     </div>
                   ))}
                 </div>}
            <p className="dsh-sidechat-freeze-note"><span aria-hidden="true">🔒</span>创建后 Seed 将冻结为不可变快照，父会话后续变化不会带入</p>
          </section>
        )}

        {error !== null && !error.startsWith('无法读取 Seed 候选：') && <p className="dsh-sidechat-error" role="alert">{error}</p>}
        <footer className="dsh-sidechat-dialog-footer">
          <span className="dsh-sidechat-keyboard-hint"><kbd>Enter</kbd> 创建 · <kbd>Shift+Enter</kbd> 换行 · <kbd>Esc</kbd> 关闭</span>
          <button className="dsh-sidechat-button dsh-sidechat-button-secondary dsh-sidechat-button-metal" type="button" disabled={busy} onClick={close}>取消</button>
          <button className="dsh-sidechat-button dsh-sidechat-button-primary dsh-sidechat-button-metal" type="submit" disabled={busy || choicesLoading || error?.startsWith('无法读取 Seed 候选：') === true}>{busy ? '创建中…' : '创建并进入 SideChat'}</button>
        </footer>
      </form>
    </DialogShell>
  )
}
