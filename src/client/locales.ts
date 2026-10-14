export const NS = 'sidechat'

export const zh = {
  'view.children': '子会话',
  'badge': 'SideChat',
  'label.parent': '父会话',
  'hint.create': '使用 /side 创建新的 SideChat；使用 /sidechats 选择并打开已有子会话。',
  'empty': '还没有 SideChat 子会话。',
  'loading': '正在加载…',
  'orphaned': '父会话已不存在；Fold 和引用已禁用。',
  'fold.preview': 'Fold 预览',
  'fold.commit': '提交到父会话',
  'fold.pending': '父会话正在运行，Fold 已排队等待安全边界。',
  'fold.committed': 'Fold 已提交到父会话。',
  'fold.cancel': '取消',
  'revision.history': 'Fold revision 历史',
  'revision.compare': 'Revision 对比',
  'status.open': '进行中',
  'status.archived': '已归档',
  'status.abandoned': '已放弃',
  'status.orphaned': '孤立',
  // Command menu descriptions (alpha.2 requires a `() => string` callback so a
  // locale change reaches the next menu open without re-registration).
  'command.traceask': '打开当前 Session 的轨迹可视化并选择事件发起 SideChat 提问',
  'command.side': '创建普通、持久化的 SideChat Session',
  'command.btw': '/side 的别名：创建普通、持久化的 SideChat Session',
  'command.sideback': '从当前 SideChat 返回其直接父会话',
  'command.sidechats': '列出当前工作区 SideChat；当前 Session 的直接子会话优先',
  'command.sideresume': '选择已有 SideChat，打开完整 Session 后继续对话',
  'command.sidefold': '让当前 SideChat 生成、预览并提交 Fold 到直接父会话',
  'command.sidecompare': '比较当前 SideChat 的两个 committed Fold revision',
  'command.sidewithdraw': '软撤回当前 SideChat 的指定 Fold revision，保留审计历史',
  'command.sidearchive': '将当前 SideChat 标记为 archived',
  'command.siderestore': '恢复当前 archived SideChat',
  'command.sideabandon': '将当前 SideChat 标记为 abandoned，保留原始 transcript',
  'command.sidecites': '查看当前 SideChat 已创建的 Cite，并打开引用目标 Session',
  'command.sidecite': '从 SideChat 选择 assistant 回复并无回复引用到父会话',
  'command.sideusage': '查看当前 SideChat、父会话增量和额外 Seed 调用的 token 用量',
  'command.sidecite-cross': '显式选择同工作区 SideChat 回复并引用到当前 Session（Host 默认关闭）',
} as const

export const en: Record<keyof typeof zh, string> = {
  'view.children': 'SideChats',
  'badge': 'SideChat',
  'label.parent': 'Parent Session',
  'hint.create': 'Use /side to create a SideChat, or /sidechats to select an existing child.',
  'empty': 'No SideChat sessions yet.',
  'loading': 'Loading…',
  'orphaned': 'The parent Session is gone; Fold and cite are disabled.',
  'fold.preview': 'Fold preview',
  'fold.commit': 'Commit to parent',
  'fold.pending': 'The parent is running. Fold is queued for a safe boundary.',
  'fold.committed': 'Fold committed to the parent.',
  'fold.cancel': 'Cancel',
  'revision.history': 'Fold revision history',
  'revision.compare': 'Revision comparison',
  'status.open': 'Open',
  'status.archived': 'Archived',
  'status.abandoned': 'Abandoned',
  'status.orphaned': 'Orphaned',
  'command.traceask': 'Open the current Session trajectory, pick events, and ask a SideChat question',
  'command.side': 'Create an ordinary, persistent SideChat Session',
  'command.btw': 'Alias of /side: create an ordinary, persistent SideChat Session',
  'command.sideback': 'Return from the current SideChat to its direct parent Session',
  'command.sidechats': 'List workspace SideChats; direct children of the current Session first',
  'command.sideresume': 'Pick an existing SideChat and continue its full Session',
  'command.sidefold': 'Generate, preview, and commit a Fold from the current SideChat to its parent',
  'command.sidecompare': 'Compare two committed Fold revisions of the current SideChat',
  'command.sidewithdraw': 'Soft-withdraw a Fold revision of the current SideChat, keeping audit history',
  'command.sidearchive': 'Mark the current SideChat as archived',
  'command.siderestore': 'Restore the current archived SideChat',
  'command.sideabandon': 'Mark the current SideChat as abandoned, keeping the original transcript',
  'command.sidecites': 'Inspect the current SideChat Cites and open their target Sessions',
  'command.sidecite': 'Pick an assistant reply from a SideChat and cite it to the parent without a reply',
  'command.sideusage': 'Inspect SideChat, parent-delta, and extra Seed token usage',
  'command.sidecite-cross': 'Explicitly cite a workspace SideChat reply into the current Session (Host-off by default)',
}

export type SideChatLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidechat: SideChatLocaleKey
  }
}
