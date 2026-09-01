# M0 技术 Spike：DSH 0.1.2-alpha.1 公共扩展面核验

核验日期：2026-08-29。核验源码提交：`cd5ef8148158c3a752a658978873241fdf8e2bbc`。

本文记录第一阶段实现所依赖的真实公共接口。它是实现约束，不是对设计文档的替代。

## 已验证 API

| 能力 | 源码结论 | 本插件采用方式 |
|---|---|---|
| 外部 bundle | 包可用 `dsh.bundle.patch`，通过 `dsh plugin --profile web add <path>` 安装 | `package.json` + `cordis.patch.yml` |
| Host + Web Client | 同包可声明 `dsh.client`，构建 `lib/client.js` 动态 bundle | Host `lib/index.js` 与 Client `lib/client.js` |
| 外部 Remote | Typert Gateway 的 SRC discovery 会扫描任意 live `TypertRemoteService` 的 `@Remote` | `sidechat/*` namespace；请求和返回另用 Zod 严格校验 |
| Client 调用 | 载体调用为 `connection.rpc.call('/api', endpoint, { args }, signal)` | Client 封装 `SideChatApi`，不伪造 `ctx.remote.sidechat` 生成代码 |
| 普通 Session 创建 | `SessionController.create({cwd, agentPreset})` 创建普通 Session | B 不带 `origin`、物理 parent 或 fork seed |
| Session 检查 | `SessionController.inspect()` 冷读或读 live Session | 校验 parent/child 生命周期与准确消息 ID |
| 当前 transcript surface | `sessionQuery.readSurface()` 返回 compaction 后可见 surface | Seed tail/pick 只从 surface 抽取直接 user/assistant 文本 |
| 持久化 sidecar | `storageDomain.open(defineDomain(...))`；`KvTable.update()` 串行原子更新单行 | 每个 child 一个聚合行，关系、Seed、Fold、Cite 和幂等状态同一原子记录 |
| 核心消息 | `user/message` 是已知事件；`MessageSourceMap.plugin` 是内置 source | Seed、Fold、Cite 只追加 plugin-source `user/message` |
| 安全 no-reply append | `Agent.runMaintenance()` 只在真正 idle 执行非 turn 任务；`Session.append()` + `sessions.flush()` | A running 时登记 pending，后台等 idle 后 maintenance append；append 本身不启动父 turn、不 followup、不 steer。Fold 达到压力阈值时先在 maintenance 外显式压缩父历史，该压缩可能独立调用模型 |
| Fold 生成 | `Agent.followup(createUserMessage(...))` 可让 B 正常启动模型 turn；`whenIdle()` 等待完成 | Fold 请求作为 B 内 plugin-source `user/message`，模型回复仍是普通 assistant message |
| Agent preset | bundle 可给 `agent-presets.roots` 增加 system root；v0.3.4 进一步核验 agent-scoped `tools.restrict()`、sandbox/approval session setter 与 `AgentPresets.composedPreset()` | `sidechat-clarifier` 提供只读候选工具，Host 取父可见工具交集并固定 read-only/never；继承模式按父 preset 与有效策略冻结 |
| Web UI slot | `conversation.view`、`conversation.session.header.actions`、`conversation.chat.assistant-actions` 均为 public list slot | 子会话页签和 Header 身份信息；v0.3.0 已完成命令迁移，不再注入 assistant 引用按钮 |
| Web 命令 | `ctx.commandUi.register()` 支持 client-owned `popupSelect` | SideChat 创建、导航、Fold、revision 和生命周期操作均注册为 Web 命令 |
| 打开 Session | Client `ctx.sessions.refresh()` / `open(id)` | 创建后刷新普通列表并进入 B 完整 Session 页 |

## 已验证但带限制的 API

### 模型选择

`SessionController.selectModel()` 会先安装 Session-local selection，随后调用
`agentDefaultModel.saveSelection()`。因此 DSH 0.1.2-alpha.1 没有“只改 B、绝不影响全局默认”的公开接口。

第一阶段仍提供三种选择：

- `default`：不调用选择 API，使用全局默认；
- `inherit`：读取父会话最近的 `request/header`，再调用公开选择 API；
- `custom`：从公开 model catalog 选择并调用公开选择 API。

后两者会在 UI 中明确提示“DSH 0.1.2-alpha.1 同时更新全局默认”。插件不直接追加私有模型事件，也不复制 Session Controller 内部选择实现。

### header lineage

`conversation.session.header.lineage` 是 single slot，已由原生 subagent UI 使用。全局注册会覆盖或冲突，破坏原生子代理行为。SideChat 身份、父 breadcrumb 和返回入口因此放在 public list slot
`conversation.session.header.actions`，产品信息完整但位置与设计稿略有偏差。

### 外部 Remote 类型

中央 `@deepseek-ai/dsh-api-remotes` 只包含仓库内生成的 namespaces，外部插件无法在不改 DSH
源码的前提下加入生成 assembly。本插件使用 Gateway 官方 SRC fallback，并在 Host/Client 两端用同一 Zod schema
验证 JSON。传输仍是 exact Typert Remote，不是无约束 Fetch。

## 不可用或明确禁止的路径

- Session log 不接受 out-of-repo `sidechat/*` event；本插件不会写入。
- `origin: 'subagent'`、continuable、settlement、report 均不使用。
- `SessionController.fork()` 会复制 transcript，不使用。
- `followup`/`steer` 会打开或污染 turn，绝不用于向 A 写 Fold/Cite。
- 直接追加 `model/selection` 不能可靠更新已创建 Agent 的 live selection，不使用。
- 覆盖 `header.lineage` 会影响原生 subagent，不使用。

## 持久化与崩溃恢复策略

设计稿建议 chats/folds/cites 三表；本实现改为“一 child 一聚合行”。这是有意偏差：`KvTable.update()`
只能保证单记录原子性，把 revision 分配、prepare reservation、Fold/Cite 状态和 chat 生命周期放在同一记录，
可避免跨表半提交。

A transcript 与 storageDomain 无法组成跨系统事务，因此使用可恢复的 prepare/commit：

1. 原子写入 `pending` 操作与不可变 ID/revision/content；
2. 在 A 的 idle maintenance 中追加带唯一 marker 的 plugin-source `user/message` 并 flush；
3. 原子标记 `committed`；
4. 启动恢复扫描 pending；若 A 已含 marker，只补第三步，否则重试第二步。

同一 fold/cite ID 重试返回当前状态，不会生成第二条父消息。

## M0 结论

S1–S11 所需的核心能力均有公共实现路径。唯一实质性产品偏差是 DSH 0.1.2-alpha.1 的模型选择会同步改变全局默认；该副作用无法在公共边界内消除，已在 UI 和文档中披露。其余偏差是 slot 位置与 Remote 类型生成方式，不改变 SideChat 的持久性、普通 Session 身份、Seed/Fold/Cite 语义或安全写入保证。

## 隔离 profile 实测

实现完成后，使用插件目录内的临时 `DSH_HOME` 对本地 DSH 提交执行了真实链路 smoke test：

1. `dsh plugin --profile web add <本插件绝对路径> --offline --config.auto-install-peers=false` 成功；
2. `dsh --profile web --dump-config` 成功组合 `sidechat-preset-root`、被注入的 `agent-presets` 与 `sidechat` Host 行；
3. `dsh --profile web --no-open --port 0` 成功启动，Host 无插件加载错误；
4. Web 启动页的 `__DSH_BOOT__` application batch 明确包含 `dsh-sidechat-plugin/client.js` 及声明的七项 client inject。

该隔离 profile 已在测试后清理；没有改动 DSH 源码或真实用户 profile。真实模型调用、浏览器交互和跨重启事务仍按 [人工验收清单](MANUAL_TEST.md) 执行。
