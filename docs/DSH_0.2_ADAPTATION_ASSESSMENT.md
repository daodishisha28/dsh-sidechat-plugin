# SideChat 适配 DSH 0.2 的源码评估

核验日期：2026-10-05。本文只记录评估与建议，没有实施运行时代码迁移。

后续实施方案见 [详细更新计划](DSH_0.2_UPGRADE_PLAN.md)（2026-10-11，目标 `0.2.1-alpha.2`）。本文保留 alpha.1 的历史评估基线；工具 mode、workflow 注入等后续变化以更新计划为准。

## 1. 目标与结论

| 项目 | 本次核验的版本 |
|---|---|
| 当前插件 | `0.3.4`，本地 HEAD `581296e3cbafa01e3673342ee2eafbc6bb1675f7` |
| 插件声明的旧 DSH 基线 | `0.1.2-alpha.1` / `cd5ef81481` |
| 上游最新 master | `0.2.1-alpha.1` / `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，提交时间 2026-10-03 |
| npm 默认 latest / next | `0.2.0-rc.2` |
| npm alpha | `0.2.1-alpha.1` |

本次逐项源码对照以最新 master / alpha 为准。npm 通道已经另外查询；不能把 `npx @deepseek-ai/dsh` 的默认目标与 master 等同，也没有对 RC 另做完整运行验证。

结论：需要迁移依赖与 preset 组装、V4 消息来源、会话历史读取、客户端导航、命令描述与轨迹结果解析，并补齐权限与历史数据兼容。仅升级版本号或修改本地声明无法完成适配。普通 Session + storageDomain 关系 + idle maintenance 回写的主体架构可以保留。

证据：[上游目标提交](https://github.com/deepseek-ai/deepseek-harness/commit/5badb15009ae1756c3afe0ae0cef1faafc290ccc)、[npm 元数据](https://registry.npmjs.org/@deepseek-ai%2Fdsh)。评估阶段的上游源码下载在系统临时目录；后续按用户要求，另在 `D:\Developing\deepseek-harness` 保留同一提交的长期 checkout，没有引入插件构建依赖。

## 2. 必须修改的项目

### 2.1 依赖坐标与版本规则

插件位置：`package.json:78`、`src/service.ts:12`、`scripts/verify-dsh-contracts.mjs:6`。

- `@deepseek-ai/dsh-agent-presets` 已不存在，改为 `@deepseek-ai/dsh-agent-preset-registry`；服务名仍是 `agentPresets`，`composedPreset(ctx)` 仍存在。
- 声明 SideChat preset 需要 `@deepseek-ai/dsh-agent-preset`。
- 客户端导航需要 `@deepseek-ai/dsh-client-ui-workspace`；在 peer、`dsh.client.inject`、类型导入和运行时 `inject` 中表达实际依赖。客户端 `sessions` 的类型归属应补充 `@deepseek-ai/dsh-api-session-controller/client`。
- DSH 包的目标版本为 `0.2.1-alpha.1`，但 vendor 包拥有独立版本：该提交的 Cordis 是 `4.0.5-alpha.1`，Schemastery 是 `3.18.5-alpha.1`。
- 不能继续要求所有 `@deepseek-ai/*` peer 等于同一个 DSH 版本。原校验脚本需要改为按包族或明确版本表检查。
- preset 中的工具包需明确运行时解析来源，尤其新增 `dsh-agent-preset` 与替换后的 workflow 后端；用实际打包、安装验证是否能被 Host 解析。

上游证据：[preset registry](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/preset/agent-preset-registry/package.json)、[Cordis](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/vendor/cordis/package.json)、[Schemastery](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/vendor/schemastery/package.json)。

### 2.2 目录 preset 改为声明式 preset

插件位置：`cordis.patch.yml:5`、`src/preset-root.ts`、`presets/sidechat-clarifier/preset.yml`、`presets/sidechat-clarifier/agent.cordis.yml`。

旧的 `agent-presets.roots`、`includeShippedRoot`、`includeUserRoot` 与 system root 注入机制已经退出。新版 Web 组装使用 `agent-preset-registry` 行，以及单独的 `@deepseek-ai/dsh-agent-preset` 声明。

建议在插件 patch 中插入一个 preset 声明，保留身份 `sidechat-clarifier`，将原显示信息与工具组装放进 `config`：

```yaml
- insert:
    - id: preset-sidechat-clarifier
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: sidechat-clarifier
        name: SideChat 澄清模式
        description: 父权限过滤的只读澄清 Agent
        order: 20
        plugins:
          # 迁移后的原 agent.cordis.yml 插件列表
```

这里是结构示意，不能直接代替完整配置。具体还要修改：

- `dsh-persona.config.text` 改为新版必填的 `prefix`，按需求设置 `suffix`。保留原只读与不可信背景约束。
- `dsh-workflow-worker-thread` 已不存在，替换为 `dsh-workflow-ptc`。它需要 Host 的 `subagents`、`ptcRuntime` 与 `sandboxPolicy` 服务，必须核验真实 profile 组装。
- 移除不再需要的 preset root 行、提供方与构建入口；同步清理 `package.json` exports/files、`tsdown.config.ts`、smoke 检查与 README。可暂留兼容导出，但旧 root 已不承担注册职责。
- 保持 `sidechat-clarifier` 这个 preset ID，避免旧 SideChat 恢复时因定义缺失被拒绝。

上游证据：[声明机制说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.zh.md)、[标准 preset 范例](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/web-app/presets/standard.patch.yml)、[persona 配置](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/preset/persona/src/index.ts)。

### 2.3 V4 消息来源：旧 plugin wrapper 会被拒绝

插件位置：`src/service.ts:1043,1070,1214,1313,1324,1470`、`src/trajectory.ts:482`。

目前这些位置构造 `{ kind: 'plugin', plugin: 'dsh-sidechat', ... }`。新版消息来源由生产者自己声明；原生 V4 不再接纳这个旧 wrapper。创建首条消息、Fold 生成请求以及 Fold/Cite/撤回回写都受影响。

建议统一定义消息来源与构造函数，并声明合并 `MessageSourceMap`。可选用 `kind: 'plugin:dsh-sidechat'`，去掉 `plugin` 字段，继续保留 `form`、`summary`、`sections`；该 kind 与 DSH 将旧 SideChat 消息迁移到 V4 后的身份一致。也可以使用其他专属 kind，但读取器必须同时识别历史迁移身份。

轨迹 Fold/Cite 分类要由旧 `source.kind === 'plugin'` 改为准确识别 SideChat 生产者及 marker。不要把所有插件来源消息都归为 SideChat。

继续写入普通 `user/message` 即可，这项改动不要求新增 `sidechat/*` Session 事件，也不要求为此注册自定义消息投影。

上游证据：[生产者消息来源与 V4 拒绝规则](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.agents/notes/implemented/architecture/2026-09-09-producer-owned-message-sources.zh.md)、[来源迁移表](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/session/session-format-v3-to-v4/README.zh.md#message-sources)。

### 2.4 Session 历史读取与普通会话判定

插件位置：`src/service.ts:1284–1338,1478,976,1561`、`types/dsh-compat.d.ts:158`。

- `agent.session.events` 已不存在。目前 Fold baseline、消息目录、生成结果提取、previewThroughSeq 和回写 marker 幂等检查都通过这个属性读取，会直接失败。
- 使用 `session.seq` 获得尾部边界；需要内容时使用 `sessionQuery.readSession()` 或具有显式释放生命周期的 `observeSession()`。marker 校验要在 maintenance 已取得写入边界后读取，避免恢复出重复回写竞态。
- 不建议直接换成同步 `snapshotEvents()`：它仍存在，但已弃用；新版的长期方向是投影和显式异步历史读取。用消息事件增量维护 marker 集合也是可选设计。
- 最新 `SessionHeader` 使用 `version: 4`、`isSeeded`；继承长度是独立的 `inheritedEventCount`，不再有 header `seedLength`。
- 普通 SideChat 校验改为检查 `isSeeded === false`、没有 `parentSession`、没有 `origin`，必要时核对 `inheritedEventCount === 0`。不要继续用不存在字段为 undefined 来证明“未 seeded”。
- observation 的历史数组是 readonly；`readSession()` 的 detached snapshot 应按实际导出类型区分。`Inspection` 与 facade 要匹配对应契约，消费函数避免依赖数组可变。

上游证据：[Session 类型](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/session/src/types.ts)、[显式 observation](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/session-query/session-query/src/observation.ts)、[同步历史读取弃用决策](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.zh.md)。

### 2.5 Web 导航接口

插件位置：`src/client/index.ts:28,45`，以及所有通过注入的 `openSession` 回调进行的跳转。

`ctx.sessions.open()` 已移除。新版 `sessions` 负责目录、对象引用和历史保留；页面导航由 `ctx.uiWorkspace.openSession()` 负责。

将公共导航回调迁移到 `uiWorkspace`，补齐插件元数据与运行时注入。这样创建后进入子会话、返回父会话、恢复列表跳转与 Fold 后回父会话可一起恢复。`ctx.sessions.refresh()` 仍存在，可以继续使用。

保持现有 header/view 插槽方案即可；`slots.inject()`、`slots.register()`、`conversation.session.header.actions` 与 `conversation.view` 在最新代码中仍存在。标准 props 的类型应重新核验，但没有证据要求重写全部 React 组件。

上游证据：[新导航契约](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/navigation.ts)、[sessions 契约](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/session-controller/src/client/contract/sessions.ts)。

### 2.6 Slash command 描述改为回调

插件位置：`src/client/index.ts:111` 起共 16 个命令，包括 `/traceask`。

旧声明使用字符串 `description: '...'`；新契约是可选的 `description(): string`，菜单合成会直接调用它。保留旧值会发生 `description is not a function`，影响 slash 菜单生成。

逐项改为 `description: () => ...`，需要本地化时通过现有 locale 绑定返回。popupSelect 的 `options` / `onSelect` 主体形态仍可保留；不需要为这一变化把命令重写成 Host 命令。

上游证据：[CommandContribution](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-commands/src/client/contract.ts)、[实际描述调用](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-commands/src/client/service.ts#L243)。

### 2.7 轨迹工具结果改为一等 tool-role message

插件位置：`src/trajectory.ts:153,340,541`。

V4 的 `tool/result.data.message` 是 tool-role 消息，实际 content 和错误标志位于 `message.content` 与 `message.isError`；call ID 位于 `message.source.callId`。旧的 `content[0].type === 'tool-result'` wrapper 已被移除。

当前解析器虽然能从 source 获得 call ID，却会把完整 data 当作结果内容，且未读取 `message.isError`；仅有 message 错误标志、没有 data.error 的结果可能被标成成功。

必须按 V4 canonical 结构优先解析结果正文与错误标志。保留 call/result 配对、真实原文读取及压缩 replacement 不算执行事件的规则。

若要求新版轨迹完整呈现，还应补上 `assistant/attempt` 的嵌入流失败/取消，以及 `tool/ptc-dispatch-start`、`tool/ptc-dispatch` 的真实子调用。当前代码不会投影这些事件。它们属于新版覆盖能力，不能通过“新增了一次模型执行”的猜测替代。

`deriveTurnTokenUsage()` 仍存在，最新实现已消费嵌入 stream；优先继续使用 Host 对应版本的真实 helper，重做失败、重试、取消和 cache bucket fixture。

上游证据：[V4 工具结果类型](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/session/src/types.ts#L375)、[PTC dispatch 事件](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/tools/src/types.ts)、[usage fold](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/llm/token-meter/src/turn-usage.ts)。

### 2.8 权限快照、保留 transport 与 persona section

插件位置：`src/service.ts:939–999,1176–1195`。

新版 Tools 在 PTC/both 呈现下会给可见 schema 增加保留 transport `run_code`。它明确禁止在 `tools.restrict()` 的 allow/deny 中命名这个 transport，要求限制终端能力工具。

当前 inherit 分支把父子 `schemas()` 名称直接交集；若交集含 `run_code`，恢复权限时会抛错。`ensurePermission()` 捕获后仅 warn，清掉已经安装的 disposer，可能让子会话在没有预期工具限制的状态下继续。这是必须处理的条件性权限风险。

建议：

- 快照与限制列表只记录可限制的终端能力，排除 `run_code`。修复旧持久记录中的保留名。
- 明确把父能力快照与 tools presentation mode 分开；验证 native、ptc、both 的实际执行权限。
- 权限安装失败应阻止创建/恢复进入可运行状态，或先安装单调拒绝 guard。不能仅记录警告后继续。
- 最新 `tools.restrict()` 实际实现会约束继承的 Host 和 preset 祖先层能力，因此不能误判为“新版 preset 的全部工具都无法被过滤”。子会话自身注册的工具仍有独立语义，需要明确核验。
- `ensurePermission()` 当前使用的 `deployment:persona` 不再是 persona 覆盖点。使用导出的 `PERSONA_PREFIX_SECTION`（`deployment:persona-prefix`）及对应顺序，避免在父 persona 之外再拼接旧名称的第二段角色提示。

普通 SideChat 仍可按父 preset ID 创建。新版还支持保留确切 preset generation 的内部绑定；本次不建议为了获取该绑定而把 SideChat 改成 subagent。若以后要求严格继承同一代际，需要单独设计普通 Session 的公共创建路径。

上游证据：[限制校验与继承实现](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/tools/src/index.ts#L1097)、[persona 常量](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/system-prompt/src/index.ts)。

## 3. 条件性修改与历史兼容

### 3.1 Fold 压力压缩的 service 解析

插件位置：`src/service.ts:1504`。

最新标准 preset 把 compaction provider 放在隔离 group 中。直接访问 `agent.ctx.compaction` 不足以证明能找到这个实例。新版 `agentPresets.serviceFor(agent, 'compaction')` 专门读取所保留 preset 子树中的隔离服务。

建议按实际实例归属通过 `serviceFor` 解析，并在需要支持 Host 全局 provider 时使用明确的可选查询回退。继续保留 maintenance 外启动 compact、压缩后再次取得 maintenance 并重测的顺序；不要改成模型可见的 followup 来代替 no-reply append。

这是根据组装与服务查找源码得到的条件性风险，仍需用真实标准/自定义 preset 触发压力阈值确认。

### 3.2 持久记录中的 seq 与历史 Session 迁移

DSH 会迁移旧 Session 格式，但不了解 SideChat 的 storageDomain 记录。V1→V2 的流合并、V2→V3 的 system message 插入及 V3→V4 的部分中断回合补齐都可能改变后续 event seq；消息 ID 与插件域内坐标不能混为一谈。

插件持久化的 `baselineSeq`、`previewThroughSeq`、Seed/trajectory 来源 seq、`capturedThroughSeq` 与轨迹 digest 没有保存对应 DSH Session 格式代际。这些值不能默认在日志迁移后仍指向同一事件。

建议的兼容策略：

- 为新增可用作当前日志坐标的状态保存 Session format generation；保留不可变 Seed/trajectory 文本和原始 provenance。
- 旧 Fold prepared/generating 状态无法证明坐标仍有效时，要求重新生成/预览，避免错误地判定 stale 或选错回复。
- 已 committed Fold/Cite 与 pending delivery 恢复以现有不可变 marker 和稳定消息身份重新核验，维持“只补状态、不重复写入”的保证。
- 不可直接把历史冻结 seq 解释为 V4 seq；原始 provenance 与“当前定位”分开处理。
- 持久快照里的 `run_code` 需要迁移/规范化。若 record schema 需要升级，设计兼容读取与显式迁移，不能只提高 storageDomain version 并假设记录会自动转换。
- 保留 preset ID、关系、revision、withdrawal 与 committed marker；单独验证旧会话冷恢复，不需要重建整个 storageDomain。

上游证据：[格式迁移链](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.zh.md)、[V4 坐标重映射范围](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/session/session-format-v3-to-v4/README.zh.md#sequence-references)。

## 4. 可以保留的公开接口与业务设计

本次已经在目标源码核对下列接口仍存在：

- `SessionController.create/inspect/resolveAgent/rename/selectModel`；
- `sessionQuery.readSurface/readSession`（新增 observation 可改进读取生命周期）；
- `Agent.whenIdle/runMaintenance/followup`；
- `createUserMessage`、`LlmRuntime.stream/resolveModelInfo`、`BlockAssembler`；
- `setSandboxMode/setApprovalPolicy`；
- `storageDomain.open`、`KvTable.get/put/update/entries`；
- `tokenMeter.measure/estimateMessage`、`deriveTurnTokenUsage`；
- `connection.rpc.handle('/sidechat', ...)` 与客户端 `rpc.call`；
- `slots.inject/register`、现有 Header actions 与 Conversation view 插槽，以及 ModuleLoader bundle handoff。

自定义 `/sidechat` RPC 通道仍可作为适配阶段的低风险方案。新版 Typert 的发现/注册机制值得另做验证，但没有必要把“切换整个 RPC 架构”列为本次必须项。

普通 Session、插件域关系、不可变 Seed、Fold/Cite 三阶段事务、revision 与软撤回、只读工具交集和 no-reply 回写都可以继续采用。具体运行保证仍需在新版真实 Host 中验收。

## 5. 类型、测试与发布验证需要一起更新

涉及 `types/dsh-compat.d.ts`、两个 tsconfig、`vitest.config.ts`、`tests/shims/*`、契约/manifest 脚本与文档。

当前 `Context` 索引签名使用 `any`，局部声明还虚构 `AgentSession.events` 和字符串 command description；Vitest 又把关键 Host 包 alias 到本地 shim。因此旧版 typecheck/test 的成功不足以证明新版兼容。

建议保持独立构建能力，同时新增面向真实、指定版本 DSH 导出类型的契约检查，避免 ambient 声明覆盖真实错误。更新 facade、shim 与源码锚点，并让真实 Host 组装检查覆盖 preset、权限与持久化校验。避免仅凭字符串包含检查宣称契约兼容。

manifest smoke 要跟随声明式 preset、移除或兼容 preset-root 入口、增加 `uiWorkspace` 注入，并验证打包安装后的真实 client 激活。README/API 核验文档应记录 DSH 通道、精确提交、vendor 版本与实际 smoke 结果。

## 6. 实施顺序与验收门槛

1. 固定 alpha/master 目标，更新依赖版本表、声明式 preset、persona/workflow 组装及真实类型检查入口。
2. 改 V4 source、Session 读取/seeded 判定与权限失败处理，恢复 Host 的安全创建和事务回写。
3. 改 UI 导航与 16 个描述回调，恢复命令菜单、创建/返回/恢复与 Fold 跳转。
4. 改 tool-role 轨迹解析，按产品范围补失败 attempt/PTC dispatch；验证 usage 使用真实 helper。
5. 加入历史记录兼容策略与对应 fixtures；在真实新版 Web profile 中验收，再更新版本和发布说明。

最低验收场景：

| 场景 | 应验证的结果 |
|---|---|
| 安装并启动 Web | Host 激活；SideChat preset 无 broken 诊断；Client 注入完整；slash 菜单可打开 |
| `/side` 的 none/tail/task/summary | 普通持久 Session；首条消息通过 V4 校验；正确导航；不推进父 turn |
| readonly 与 inherit | 原生与 PTC preset 都落实父能力上限；权限安装失败不会继续运行 |
| `/sidefold`、Cite、撤回 | parent idle 后 no-reply append；持久化成功；不重复消息；Fold 后正确导航 |
| 崩溃/重启 | pending 在 append 前、append 后/commit 前分别恢复；marker 幂等成立 |
| 压力阈值 | 能找到标准 preset 的 compaction；压缩后重测；不满足阈值时不追加 |
| 轨迹 | V4 正文/错误标志、call ID 配对、取消/重试与 PTC 真实调用；replacement 不重复计执行 |
| 旧版本数据升级 | preset ID 可恢复；旧 source marker 可识别；seq/digest 不错误复用；committed 历史保留 |
| 包发布 | 独立 clone 构建、tarball 安装与真实 Web smoke；记录确切 DSH 通道与提交 |

## 7. 本次证据边界

源码评估阶段已检查发布通道、实际导出包、方法、配置字段、消息格式及调用点，没有修改运行时源码，也没有执行 SideChat 的新版端到端或真实迁移测试。本文中的条件性风险与验收步骤不能被当作已经通过的运行测试。

后续环境准备已安装官方 `@deepseek-ai/dsh@0.2.1-alpha.1` 到插件仓库忽略的 `.smoke-dsh-0.2/runtime`，使用独立 `DSH_HOME` 完成原生 Web 启动、认证跳转、首页与两个入口脚本的 HTTP 检查。未安装旧版 SideChat、未调用模型，也未执行源码 build；环境说明见本地 `.smoke-dsh-0.2/README.md`。此基础检查不改变上面的插件适配结论。

delegate 的现有注册目标绑定在另一仓库，未派发本项目探索；本次对照由 Codex 直接执行。
