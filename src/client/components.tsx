import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { FoldRecord, SideChatRecord, SideChatTreeItem, UsageReport, UsageTotals } from '../types.ts'
import type { SideChatApi } from './api.ts'
import type { SideChatLocaleKey } from './locales.ts'
import {
  onFoldPreview,
  onRevisionComparison,
  onSideChatIdentityRefresh,
  onUsageReport,
  type RevisionComparisonRequest,
} from './workflow-events.ts'

interface CommonInjected {
  readonly api: SideChatApi
  readonly openSession: (sessionId: string) => void
  readonly refreshSessions: () => Promise<void>
  readonly identityChanged?: (sessionId: string, record: SideChatRecord | null) => void
}

type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'sidechat'> & CommonInjected
type ViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'sidechat'> & CommonInjected

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusCopy(t: (key: SideChatLocaleKey) => string, status: SideChatRecord['status']): string {
  return t(`status.${status}` as SideChatLocaleKey)
}

function statusDotClass(status: SideChatRecord['status']): string {
  return `dsh-sidechat-status-dot dsh-sidechat-status-dot-${status}`
}

function usageCount(value: number | undefined): string {
  return value === undefined ? '不可得' : value.toLocaleString()
}

function UsageTotalsView({ title, usage }: { readonly title: string; readonly usage: UsageTotals | undefined }) {
  const metrics: ReadonlyArray<readonly [string, number | undefined]> = usage === undefined
    ? [['Total', undefined]]
    : [
        ['Uncached input', usage.uncachedInputTokens],
        ['Cache read', usage.cacheReadTokens],
        ['Cache write', usage.cacheWriteTokens],
        ['Output', usage.outputTokens],
        ['Reasoning', usage.reasoningTokens],
        ['Total', usage.totalTokens],
      ]
  return (
    <section className="dsh-sidechat-ucard">
      <h3>{title}</h3>
      <dl className="dsh-sidechat-stat-grid">
        {metrics.map(([label, value]) => (
          <div className="dsh-sidechat-stat-tile" key={label}>
            <dt>{label}</dt>
            <dd className={value === undefined ? 'dsh-sidechat-stat-na' : undefined}>{usageCount(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Header identity only. Operational actions live in slash commands. */
export function SideChatHeaderActions({ sessionId, api, openSession, identityChanged, t }: HeaderProps) {
  const [record, setRecord] = useState<SideChatRecord | null | undefined>(undefined)
  const [fold, setFold] = useState<FoldRecord | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [comparison, setComparison] = useState<RevisionComparisonRequest | null>(null)
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const [staleConfirmation, setStaleConfirmation] = useState<string | null>(null)
  const foldEditorRef = useRef<HTMLTextAreaElement>(null)
  const comparisonStats = comparison?.lines.reduce((counts, line) => {
    counts[line.kind] += 1
    return counts
  }, { added: 0, removed: 0, same: 0 })

  const refresh = useCallback(async () => {
    try {
      const next = (await api.get(sessionId)).record
      setRecord(next)
      identityChanged?.(sessionId, next)
    } catch {
      setRecord(null)
      identityChanged?.(sessionId, null)
    }
  }, [api, identityChanged, sessionId])

  useEffect(() => {
    const abort = new AbortController()
    void api.get(sessionId, abort.signal).then(
      value => { setRecord(value.record); identityChanged?.(sessionId, value.record) },
      () => { if (!abort.signal.aborted) { setRecord(null); identityChanged?.(sessionId, null) } },
    )
    return () => { abort.abort() }
  }, [api, identityChanged, sessionId])

  useEffect(() => {
    const stopFold = onFoldPreview(sessionId, (nextFold) => {
      setFold(nextFold)
      setDraft(nextFold.generatedContent)
      setMessage(null)
      setStaleConfirmation(null)
    })
    const stopComparison = onRevisionComparison(sessionId, setComparison)
    const stopUsage = onUsageReport(sessionId, setUsage)
    const stopRefresh = onSideChatIdentityRefresh(sessionId, () => { void refresh() })
    return () => { stopFold(); stopComparison(); stopUsage(); stopRefresh() }
  }, [refresh, sessionId])

  useEffect(() => {
    if (fold === null) return
    const focusEditor = () => {
      const textarea = foldEditorRef.current
      if (textarea === null) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
    const timer = window.setTimeout(focusEditor, 0)
    return () => { window.clearTimeout(timer) }
  }, [fold])

  const commit = useCallback(async (allowStale = false) => {
    if (record === null || record === undefined || fold === null) return
    setBusy(true)
    setMessage(null)
    setStaleConfirmation(null)
    try {
      const result = await api.commitFold(record.childSessionId, fold.foldId, draft, allowStale)
      const parentSessionId = record.parentSessionId
      setFold(null)
      await refresh()
      setMessage(result.state === 'pending' ? t('fold.pending') : t('fold.committed'))
      openSession(parentSessionId)
    } catch (error) {
      const text = errorText(error)
      if (!allowStale && text.includes('changed after')) setStaleConfirmation(text)
      else setMessage(text)
    } finally { setBusy(false) }
  }, [api, draft, fold, openSession, record, refresh, t])

  const handleFoldEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    void commit(staleConfirmation !== null)
  }

  if (record === undefined || record === null) return null
  return (
    <>
      <div className="dsh-sidechat-actions">
        <span className="dsh-sidechat-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M6 3v12" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M18 8.5a8 8 0 0 1-8 8" />
          </svg>
          {t('badge')}
        </span>
        <a
          className="dsh-sidechat-parent-label"
          href={`#session-${record.parentSessionId}`}
          onClick={(event) => { event.preventDefault(); openSession(record.parentSessionId) }}
        >{t('label.parent')} · {record.parentSessionId.slice(0, 12)}</a>
        <span className="dsh-sidechat-separator" aria-hidden="true" />
        <span className="dsh-sidechat-status"><span className={statusDotClass(record.status)} />{statusCopy(t, record.status)}</span>
        <span className="dsh-sidechat-chip">rev {record.revision}</span>
        {record.permission !== undefined && <span>{record.permission.mode === 'inherit' ? '继承权限' : '只读权限'}</span>}
        {record.status === 'orphaned' && <span className="dsh-sidechat-chip dsh-sidechat-chip-warn">父会话已不可达</span>}
        {message !== null && <span className="dsh-sidechat-message" role="status">{message}</span>}
      </div>
      {fold !== null && (
        <div className="dsh-sidechat-dialog-backdrop" role="presentation">
          <section
            className="dsh-sidechat-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('fold.preview')}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
              event.preventDefault()
              event.stopPropagation()
              if (!busy) setFold(null)
            }}
          >
            <header className="dsh-sidechat-dialog-header">
              <h2>{t('fold.preview')}<span className="dsh-sidechat-dialog-tag">rev {fold.revision} · {fold.mode === 'incremental' ? '增量' : '完整'}</span></h2>
              <button className="dsh-sidechat-icon-button" type="button" aria-label="关闭" onClick={() => { if (!busy) setFold(null) }}>×</button>
            </header>
            <div className="dsh-sidechat-meta-row">
              <span className="dsh-sidechat-chip">约 {fold.estimatedTokens} token</span>
              <span className={`dsh-sidechat-chip ${fold.structureValid ? 'dsh-sidechat-chip-ok' : 'dsh-sidechat-chip-warn'}`}>{fold.structureValid ? '✓ 结构有效' : '需要编辑后提交'}</span>
            </div>
            <textarea
              className="dsh-sidechat-question dsh-sidechat-fold-editor"
              ref={foldEditorRef}
              value={draft}
              onChange={(event) => { setDraft(event.currentTarget.value) }}
              onKeyDown={handleFoldEditorKeyDown}
            />
            {staleConfirmation !== null && (
              <div className="dsh-sidechat-notice-bar" role="alert">
                <span>{staleConfirmation} 父会话或 B 已在预览后发生变化。只有确认旧预览仍然有效时才应强制提交。</span>
              </div>
            )}
            <footer className="dsh-sidechat-dialog-footer">
              <span className="dsh-sidechat-keyboard-hint"><kbd>Enter</kbd> 提交 · <kbd>Shift+Enter</kbd> 换行 · <kbd>Esc</kbd> 取消</span>
              <button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" disabled={busy} onClick={() => { setFold(null) }}>{t('fold.cancel')}</button>
              <button className={`dsh-sidechat-button ${staleConfirmation === null ? 'dsh-sidechat-button-primary' : 'dsh-sidechat-button-warning'}`} type="button" disabled={busy} onClick={() => { void commit(staleConfirmation !== null) }}>{staleConfirmation === null ? t('fold.commit') : '仍提交旧预览'}</button>
            </footer>
          </section>
        </div>
      )}
      {comparison !== null && (
        <div className="dsh-sidechat-dialog-backdrop" role="presentation">
          <section className="dsh-sidechat-dialog" role="dialog" aria-modal="true" aria-label={t('revision.compare')}>
            <header className="dsh-sidechat-dialog-header">
              <h2>{t('revision.compare')}<span className="dsh-sidechat-dialog-tag">rev-{comparison.left} → rev-{comparison.right}</span></h2>
              <button className="dsh-sidechat-icon-button" type="button" aria-label="关闭" onClick={() => { setComparison(null) }}>×</button>
            </header>
            <div className="dsh-sidechat-meta-row">
              {comparisonStats !== undefined && comparisonStats.added > 0 && <span className="dsh-sidechat-chip dsh-sidechat-chip-ok">+ {comparisonStats.added} 行</span>}
              {comparisonStats !== undefined && comparisonStats.removed > 0 && <span className="dsh-sidechat-chip dsh-sidechat-chip-err">− {comparisonStats.removed} 行</span>}
              <span className="dsh-sidechat-chip">{comparisonStats?.same ?? 0} 行未变化</span>
            </div>
            <pre className="dsh-sidechat-diff">{comparison.lines.map((line, index) => (
              <span className={`dsh-sidechat-diff-${line.kind}`} key={`${index}-${line.kind}`}><span className="dsh-sidechat-diff-prefix">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>{line.text}{'\n'}</span>
            ))}</pre>
            <footer className="dsh-sidechat-dialog-footer"><span className="dsh-sidechat-keyboard-hint"><kbd>Esc</kbd> 关闭</span><button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" onClick={() => { setComparison(null) }}>关闭</button></footer>
          </section>
        </div>
      )}
      {usage !== null && (
        <div className="dsh-sidechat-dialog-backdrop" role="presentation">
          <section className="dsh-sidechat-dialog" role="dialog" aria-modal="true" aria-label="SideChat 用量">
            <header className="dsh-sidechat-dialog-header">
              <h2>SideChat 用量<span className="dsh-sidechat-dialog-tag">{usage.child.complete ? `完整 · ${usage.child.completedTurns} turns` : '不完整'}</span></h2>
              <button className="dsh-sidechat-icon-button" type="button" aria-label="关闭" onClick={() => { setUsage(null) }}>×</button>
            </header>
            <UsageTotalsView title="B 累计" usage={usage.child.totals} />
            <UsageTotalsView title="B 最近完整 Turn" usage={usage.child.latestTurn} />
            <UsageTotalsView
              title="父会话自创建后的增量"
              usage={usage.parentDeltaSinceCreate.available ? usage.parentDeltaSinceCreate.totals : undefined}
            />
            <p className="dsh-sidechat-muted">
              Fold/Cite no-reply append 自身模型调用：{usage.noReplyModelCalls}（Fold 超阈值时的父历史压缩可能另有模型调用）
              {usage.seedGeneration !== undefined && <>；Seed 额外调用：{usage.seedGeneration.model === undefined ? '模型不可得' : `${usage.seedGeneration.model.provider}/${usage.seedGeneration.model.model}`}，Input {usageCount(usage.seedGeneration.usage?.inputTokens)} · Output {usageCount(usage.seedGeneration.usage?.outputTokens)} · Total {usageCount(usage.seedGeneration.usage?.totalTokens)}</>}
            </p>
            <footer className="dsh-sidechat-dialog-footer"><span className="dsh-sidechat-keyboard-hint"><kbd>Esc</kbd> 关闭</span><button className="dsh-sidechat-button dsh-sidechat-button-secondary" type="button" onClick={() => { setUsage(null) }}>关闭</button></footer>
          </section>
        </div>
      )}
    </>
  )
}

export function SideChatsView({ sessionId, api, openSession, t }: ViewProps) {
  const [items, setItems] = useState<SideChatTreeItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const abort = new AbortController()
    void api.tree(sessionId, abort.signal).then(
      value => { setItems(value.items); setError(null) },
      reason => { if (!abort.signal.aborted) { setError(errorText(reason)); setItems([]) } },
    )
    return () => { abort.abort() }
  }, [api, sessionId])
  const visibleItems = items?.filter((item) => {
    if (items === null) return false
    const byChild = new Map(items.map(candidate => [candidate.childSessionId, candidate]))
    let parentId = item.parentSessionId
    const visited = new Set<string>()
    while (parentId !== sessionId && !visited.has(parentId)) {
      if (collapsed.has(parentId)) return false
      visited.add(parentId)
      const parent = byChild.get(parentId)
      if (parent === undefined) break
      parentId = parent.parentSessionId
    }
    return true
  })
  return (
    <section className="dsh-sidechat-view">
      <h2>{t('view.children')}</h2>
      <p className="dsh-sidechat-command-hint">
        {t('hint.create').split(/(\/side(?:chats?)?)/u).map((part, index) => part.startsWith('/side')
          ? <kbd key={`${part}-${index}`}>{part}</kbd>
          : part)}
      </p>
      {items === null && <div className="dsh-sidechat-list" aria-label={t('loading')}><span className="dsh-sidechat-skeleton" /><span className="dsh-sidechat-skeleton" /><span className="dsh-sidechat-skeleton" /></div>}
      {items?.length === 0 && <p className="dsh-sidechat-empty">{t('empty')}</p>}
      {error !== null && <p className="dsh-sidechat-error">{error}</p>}
      <div className="dsh-sidechat-list">
        {visibleItems?.map(item => (
          <article className="dsh-sidechat-card" data-depth={item.depth} key={item.childSessionId} style={{ marginInlineStart: `${Math.min(item.depth, 6) * 26}px` }}>
            <div>
              <div className="dsh-sidechat-title">
                {items?.some(candidate => candidate.parentSessionId === item.childSessionId)
                  ? <button
                      className="dsh-sidechat-tree-toggle"
                      type="button"
                      aria-label={collapsed.has(item.childSessionId) ? '展开子会话' : '折叠子会话'}
                      aria-expanded={!collapsed.has(item.childSessionId)}
                      onClick={() => { setCollapsed((current) => {
                        const next = new Set(current)
                        if (next.has(item.childSessionId)) next.delete(item.childSessionId)
                        else next.add(item.childSessionId)
                        return next
                      }) }}
                    >{collapsed.has(item.childSessionId) ? '▸' : '▾'}</button>
                  : <span className="dsh-sidechat-tree-leaf">·</span>}
                {item.title}
              </div>
              <div className="dsh-sidechat-meta">
                <span className="dsh-sidechat-status"><span className={statusDotClass(item.status)} />{statusCopy(t, item.status)}</span><span className="dsh-sidechat-chip">rev {item.revision}</span><span>{item.model}</span>
                <time>{new Date(item.updatedAt).toLocaleString()}</time>
              </div>
            </div>
            <button className="dsh-sidechat-button dsh-sidechat-button-secondary dsh-sidechat-button-open" type="button" onClick={() => { openSession(item.childSessionId) }}>打开</button>
          </article>
        ))}
      </div>
    </section>
  )
}

export type { CommonInjected }
