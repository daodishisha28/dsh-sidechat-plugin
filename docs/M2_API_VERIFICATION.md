# M2 技术核验：DSH 0.1.2-alpha.1 渐进式记忆扩展面

核验日期：2026-08-29。核验源码提交：`cd5ef8148158c3a752a658978873241fdf8e2bbc`。

## 已验证 API 与采用方式

| M2 能力 | DSH 公共事实 | 实现 |
|---|---|---|
| 完整日志精确读 | `sessionQuery.readSession()` 返回 replay-validated complete raw log，不受当前 compaction surface 限制 | `sidechat_read` 与 Cite 按 exact message ID 从完整日志查找；只投影直接 user/assistant 文本 |
| Agent-scoped tool | `Agent.ctx.tools.register()` 在调用 Agent scope 注册，scoped layer 会覆盖 global；返回 disposer | 每个存在直接 SideChat child 的 live 父 Agent 动态安装 `sidechat_read`，关闭插件时卸载 |
| live Agent 发现 | `AgentRegistry.list()/get()` 与 `agent/created`、`agent/disposed` 是公开接口；created 时 setup 已完成 | 初始化扫描现有 Agent，随后监听生命周期；tool closure 固定父 Session ID |
| Tool 输出契约 | `defineTool()` 支持严格 input/output schema、render、并发安全声明 | 返回结构化 exact entries；renderer 添加“不可信背景”边界；最多 5 条并设字符预算 |
| 独立摘要模型调用 | `ctx.llm.stream()` 与 `BlockAssembler` 是公开能力 | bounded Seed summary 单独调用 B 的已解析模型 route，不写父 transcript，不扩大工具权限 |
| Task 式 Seed 调用 | `ctx.llm.stream()` 接受显式 provider/model/messages/maxTokens；`tools` 可省略 | 使用父会话最近 `request/header` route，回退父 Agent route；无 tools、最大 500 token，不写 A，不创建 A turn；成功后重验父 lifecycle identity 才创建 B |
| 精确 token 用量 | `@deepseek-ai/dsh-token-meter/client` 公开 `deriveTurnTokenUsage()`；DSH durable message usage 区分 uncached input、cache read/write、output、reasoning 和 total | `/sideusage` 只聚合完整且内部有效的 turn；保存创建时父 usage 基线，并单列 task/summary 独立调用 usage |
| 递归关系 | `storageDomain` 聚合记录可保存每条逻辑 parent/child edge | `tree` 从任意普通/SideChat Session 向下递归；每次 Fold/Cite/read 仍只授权一条直接边 |
| 外部 Host/Client bridge | `connection.rpc.handle()` 可注册包自有、经过 Host/Origin 与浏览器认证的逻辑 RPC channel | v0.3.2 使用 `/sidechat` channel 和有限 endpoint switch；每个 endpoint 仍调用原有 Host 方法并重新验证业务参数 |

`scripts/verify-dsh-contracts.mjs` 将 `readSession`、Agent registry、scoped tool registration、`llm.stream()` 的可选 tools 以及公开 token-meter fold 加入源码漂移检查。

Client bundle 必须保持 namespace plugin 导出 `{ apply, inject }`，不能同时导出 `default`。DSH Loader 会优先 unwrap `default`，导致 `inject` 元数据丢失并在访问 `locale` 等服务时拒绝加载。`smoke:manifest` 对该形状做了回归断言，隔离 Web smoke 还会验证实际 loader 应用成功。

## 权限与持久化决策

v0.3.4 核验了 DSH 权限的三个公开层面：`AgentPresets.composedPreset()`/`SessionController.create({ agentPreset })`、agent-scoped `tools.schemas()` 与 `tools.restrict({ allow })`、`SandboxPolicyService.resolve()`/`setSandboxMode()` 以及 `ApprovalService.overrideOf()`/`setApprovalPolicy()`。因此浏览器只选择 `inherit|readonly`，真正权限由 Host 从父 Agent 当前状态重新计算并冻结：

- `inherit`：使用父 preset ID 创建，工具限制为父/子当前可见工具交集，复制父有效 sandbox 与 approval；
- `readonly`：使用 `sidechat-clarifier` 候选 preset，只允许请求中列出的能力与父可见工具交集，固定 `read-only + approval never`；
- agent-scoped restriction 与 SideChat persona 在冷恢复时根据 storage-domain 快照重新安装；sandbox/approval 本身是 DSH 核心日志事件，随 Session 重放；
- DSH 普通 Session create API 不接受“绑定父 preset 已挂载 generation”的 setup callback；继承模式使用相同 preset ID，并以父实际可见工具 allowlist 防止能力扩大。热更新恰好跨越创建窗口时，B 可能使用同 ID 新 generation，这是已记录的公共接口限制。

- `sidechat_read` 不是全局工具。Host 仅对已有直接 child 的父 Agent 注册，且执行时再次验证 closure 中的调用方 ID、domain direct edge、parent/child lifecycle identity 和 workspace。
- 请求必须给出 1–5 个 exact message ID；不接受范围、通配符或 transcript dump。缺失 ID、非直接 authored 文本和超预算结果全部 fail closed。
- Fold detail pointer 只允许 `sidechat://<child>/message/<message>`。commit 会针对完整 child 日志验证每个 pointer；跨 child、未知 ID、畸形编码或超过 5 个均拒绝。
- Revision 继续存放在同一 child 聚合行：新提交成为 `current`，旧 committed 变为 `superseded`；软撤回只追加父会话撤回通知并标记 `withdrawn`，不删除原消息或不可变 revision。
- 跨父 Cite 默认关闭。启用后，Host 要求显式 target、source/target 同 `cwd`、两侧 lifecycle identity 未改变；持久化的是 source assistant 文本 snapshot 和 target identity，后续 source 归档不影响已投递内容。
- storage domain 版本保持 `1`。M2 新字段均为 optional，从而可读取第一阶段的既有聚合记录；没有伪造 DSH 不存在的 migration API。
- `task` 的 `generatedContext`、summary 的精确 usage 和 `parentUsageBaseline` 均为 optional。旧 `schema: 1` 行不需要迁移；缺失基线时 `/sideusage` 明确显示不可得。

## v0.3.0 命令与 OpenCode Task 偏差

DSH 0.1.2-alpha.1 的公开 command contribution 只有同步 `available({ sessionId })` 和 `popupSelect`。插件通过 B Header identity 查询维护只读缓存，使 `/sidefold`、`/sideusage` 和生命周期命令按普通 A/B 及 B 状态控制可见性；所有 Host Remote 仍独立重验身份，缓存从不作为授权依据。

Header 现只保留 SideChat badge、状态、revision 和父会话导航。创建、Fold、Cite、revision、归档/恢复/放弃全部走 slash command；Fold 提交/取消和用量关闭仍属于必要对话框控件。`conversation.chat.assistant-actions` 公共 Slot 仍存在，但 v0.3.0 不再注入 Cite 按钮。

OpenCode 原生 `task()` 的 prompt 由正在运行的父 Agent 在调用工具时自然写出，child 不自动继承 transcript。DSH 的 `/side task` 是手动 UI 命令，无法安全复用一个正在生成中的父 Agent 调用，因此采用一次独立的父 route 模型请求：输入为父 surface 中从新到旧、完整消息组成的不超过 12,000 字符/约 3,000 token 窗口，输出不超过 500 token。该调用没有 tools，不调用 followup/steer，不写 A；失败不创建 B。原始输入窗口和输出、route、usage 一起冻结到 provenance，B transcript 只接收生成上下文和澄清问题。

`/sideusage` 不采用 UI 上的字符估算。它复用 DSH token-meter 的完整 turn 归并语义；未完成 turn、缺失 provider usage、旧记录没有父基线时均标为不完整或不可得。Fold 模型生成是 B 的普通 turn，Fold/Cite 的 no-reply append 本身不启动父 turn；若 Fold 追加将达到 `foldAppendThresholdRatio`，SideChat 会先调用 DSH 显式压缩父会话旧历史，该压缩通常包含一次独立模型调用。

## 设计偏差与不可用 API

### Typert SRC discovery 在后置外部 bundle 中不可用

真实 DSH `0.1.2-alpha.1` 启动核验中，Loader 将 `dsh-sidechat-plugin` 标记为 `active`，`TypertRemoteService` 上的 15 个 `@Remote` marker 也完整存在；但外部 bundle 行在内置 Remote assembly 之后追加，Gateway 所在 sibling context 无法重新解析该 Service，`/api/sidechat/tree`、`/api/sidechat/seedChoices` 等全部返回 HTTP 404。额外发送 Cordis service 变更信号不能修复该隔离边界。

采用的兼容实现是 DSH 公开 `connection.rpc.handle('/sidechat', ...)`：它复用 Connection 的信任、认证、请求体和取消边界，只接受有限的方法名并分发到同一批 Host 方法。Client 不再调用 `/api/sidechat/*`，而是调用 `/sidechat/<method>`；未知 endpoint fail closed。共享 Zod business schema、parent/child/workspace/message identity 重验以及所有持久化事务均未改变，也没有复制 Gateway 私有实现。

### 普通 Session 列表隐藏偏好未实现

DSH 0.1.2-alpha.1 的普通 Sidebar/session catalog 没有稳定的外部 list-filter Slot，也没有“插件停用后仍可恢复”的持久隐藏协议。拦截内部列表或复制 Sidebar 私有实现会破坏公共边界，并可能使卸载后的 B 难以发现。

因此本版本保持 B 始终出现在普通 Session 列表，专用递归“子会话”树是额外入口。此项属于设计中明确可选能力，安全 fallback 满足“不让数据搁浅”的约束。

### 跨父 Cite 默认关闭

实现已经具备同工作区、显式选择、不可变 snapshot、来源 parent/workspace 展示以及引用目标审计信息，但它扩大了引用图，Host 配置 `allowCrossParentCite` 默认仍为 `false`。没有 Agent 侧自由发现入口；只能由用户运行 `/sidecite-cross` 完成显式选择。

### 工具 schema 会改变父 Agent prompt schema

DSH scoped tool registration 会触发工具 schema 变化。插件只在首次创建/恢复出直接 child 时安装一个稳定 schema，避免按 child 数量增长。当前稳定 name/description/input schema 的保守 4 chars/token 估算不超过 180 token；`tests/tool-contract.unit.spec.ts` 防止后续无意膨胀。

## M2 结论

精确 recall、detail pointers、revision 状态/对比/替代/软撤回、丰富 Seed、递归树和受控跨父 Cite 均有公共实现路径。普通列表隐藏没有安全公共路径，按产品文档的可选/fallback 规则不实现。没有修改 DSH 源码，没有引入自定义 Session event，也没有改变 B 的普通持久 Session 身份。

## 隔离 Web smoke

在插件目录内创建临时 `DSH_HOME`，对本地 DSH 基线执行了 `plugin add --offline`、`--dump-config`、真实 Web Host 启动和浏览器页面加载。第一次页面加载暴露了 Client bundle 同时导出 `default` 导致 Loader 丢失 `inject` 的问题；修正为 namespace-only `{ apply, inject }` 后重新构建、刷新，DSH 首页正常渲染且当前 loader 不再显示插件失败。临时页面、Host 进程和 profile 均已清理。

此 smoke 不配置真实模型，因此精确工具调用、summary/Fold 模型生成和运行中安全边界仍需按 `MANUAL_TEST.md` 在用户可用模型 profile 中人工验证。

v0.3.2 在真实 `web` profile 的独立 3081 端口完成了可视 smoke：父会话“子会话”页签成功列出 3 条既有 SideChat，`/side` 默认高亮 `tail:1` 并在 DSH 页面内显示不可变 Seed 预览，B 的完整 Session 页面显示 badge、父 breadcrumb、状态与 revision，`/sideusage` 页面内报告成功显示 2 个完整 turn 和精确 token 字段。页面与 Client 日志均未再出现 `sidechat/*` HTTP 404；测试未提交新的 SideChat、Fold/Cite 或模型调用。临时 3081 Host 在验证后关闭。
