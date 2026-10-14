# DSH 0.2.1-alpha.2 适配实施报告

- 更新日期：2026-10-13；当前接手修复与验收见 §10。§1–9 为 2026-10-12 历史批次记录。
- 目标上游：`@deepseek-ai/dsh@0.2.1-alpha.2`，提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`
- 插件版本：`0.3.4`（适配期间未发布新版本）
- 方案与验收标准：[DSH_0.2_UPGRADE_PLAN.md](DSH_0.2_UPGRADE_PLAN.md)（正文保留为历史方案，头部与第 9/11 节末尾附实施状态）
- 证据目录：`.smoke-dsh-alpha2/evidence/`（B/C 批 `bc-*`、D 批 `d-*`、修复轮 `repair-*`）；采集方式全部为 Node `spawn`/`spawnSync` 按 UTF-8 分别保存 stdout/stderr 与退出码，未使用 PowerShell `Tee-Object`

## 1. 改动总表（A / B / C / D）

| 批 | 范围 | 主要文件 | 状态 |
|---|---|---|---|
| A | alpha.2 隔离 runtime、依赖与声明式 preset、旧入口清理、真实类型 fixture | `package.json`（peer 精确固定 alpha.2）、`cordis.patch.yml`（declarative `sidechat-clarifier` preset + `sidechat` 服务行）、`presets/**` 删除、`src/preset-root.ts` 删除、`tests/contracts/alpha2-fixture/` | 已完成（B/C 批报告先记录） |
| B | Host 运行时：V4 source、异步历史读取、权限、激活修复 | `src/message-source.ts`（新）、`src/session-history.ts`（新）、`src/service.ts`、宿主懒 `ctx.inject(['connection','webServer'])` | 已完成 |
| C | 数据与交付：记录 schema v2 + legacy v1、三类交付事务、压缩经 `agentPresets.serviceFor` | `src/record-compat.ts`（新）、`src/types.ts`、`src/transactions.ts`、`src/safe-boundary.ts` | 已完成 |
| D | Client 与轨迹/usage、真实导出类型门槛、文档与本报告 | 见下表 | 本报告 |

### D 批逐项

| 项 | 内容 | 文件 |
|---|---|---|
| D1 导航统一 | `ctx.sessions.open()` 移除；创建进入 child、返回父会话、恢复、Fold 提交后跳转、组件内会话链接全部经 `ctx.uiWorkspace.openSession()`。三处声明齐全：`package.json.dsh.client.inject` 加入 `@deepseek-ai/dsh-client-ui-workspace`；Client `inject` 数组加入 `'uiWorkspace'`；真实类型导入 `UiWorkspace`（`@deepseek-ai/dsh-client-ui-workspace/client`）与 `ISessions` face（`@deepseek-ai/dsh-api-session-controller/client`）。普通 Session ID → `SessionTarget` 的品牌转换收敛在 `openSession` 一个边界（`as SessionId`，非 `any`；contracts.ts 用真实 `SessionId(...)` 值证明可赋值给 `SessionTarget`）。`sessions.refresh()`、Header/conversation slots、原生模型选择器保留 | `src/client/index.ts`、`package.json`、`types/dsh-compat.d.ts` |
| D2 命令 description 回调 | 16 个命令（含 `/traceask`）的 `description` 全部改为 `() => t('command.<name>')`；16 条 zh/en 词条补进现有 locale 机制；测试实际调用回调并断言与词条一致 | `src/client/index.ts`、`src/client/locales.ts`、`tests/commands.client.spec.ts` |
| D3 V4 tool/result 解析 | `tool/result.data.message` 按 tool-role message 读取 `source.callId`（真实 `ToolMessageSource`）、正文 `content`、`isError`；新格式优先，旧 tool-result 包装/扁平 `data.content` 保留为明确兼容分支。callId 配对不变；压缩 replace 副本仍不入执行轨迹、原事件详情保留 | `src/trajectory.ts` |
| D4 attempt / PTC / 状态 | `assistant/attempt`（失败/重试/取消的未投影 attempt）显式跳过，绝不渲染为成功模型回复；`tool/ptc-dispatch-start`/`tool/ptc-dispatch` 按 `subCallId` 配对，新增 `kind:'ptc'` 展示，归入外层 `run_code` 的 turn/step，不计入 overview 的 calls；dispatch `meta` 只保留为展示元数据，从不进入正文/执行结果/usage；未结算的 start 显式 unknown。未覆盖节点一律不给成功结论 | `src/trajectory.ts`、`src/types.ts`（`trajectoryKindSchema` 增加 `'ptc'`） |
| D5 subagent activation | `{kind:'activation', subagentId}` 的 tool result 状态置为 unknown（只表示启动接受，最终结果以真实持久化消息为证据；call 的 callStatus 同样返回 unknown）；识别优先别名集合 `{task, agent, subagent, subagent_fork}`（大小写不敏感，覆盖范围在源码注释与本节写明——`tool-subagent` 的 `toolName` 可配置，shipped agents 以 `subagent` 与 `subagent_fork` 两个名字暴露），另用结果身份（activation payload）识别配置名之外的可配置工具；运行时 `subagent/start`/`subagent/end` 生命周期通知从未被当作持久化 SessionEvent（新增回归测试） | `src/trajectory.ts` |
| D6 usage 真实 helper | 继续使用真实 `deriveTurnTokenUsage`（`@deepseek-ai/dsh-token-meter/client`）；`deriveSessionUsage` 在送入 helper 前过滤 `surfaceOp: replace` 的表面替换副本（替换不是新的计费 attempt；不过滤时上游 helper 是 fail-closed 的，整 turn 变 unknown，也绝不双计）。精确/estimated 区分不变；缺证据显示 unknown | `src/usage.ts` |
| D7 真实类型门槛 | `check:plugin-alpha2` 以 **Host / Client 两个真实导出工程**覆盖全部源码并加入 `pnpm verify` 链；详见 §3 | `tests/contracts/alpha2-fixture/tsconfig.full-plugin.json`、`tsconfig.full-plugin-client.json`（新）、`scripts/verify-real-exports.mjs`、`package.json` |
| D8 测试与脚本 | 测试更新与新增见 §4；smoke-manifest 增加 uiWorkspace inject 与 `dsh.client.inject` 包断言；verify-dsh-contracts 增加 facade 客户端段锚点与 `sessions.open` 禁用断言；verify-portable 增加两个 full-plugin 工程的覆盖与子路径精确映射规则 | `scripts/*` |
| D9 文档 | README、MANUAL_TEST、M0/M2 头部 alpha.2 状态块、UPGRADE_PLAN 状态行、本报告 | `README.md`、`docs/*` |

## 2. 记录迁移方案（v1→v2，引用 C 批，供完整阅读）

- 记录 schema 分为 `1|2` 两轴，读取统一经 `src/record-compat.ts` 规范化；storageDomain 的 domain version 保持 1（不借 domain 迁移重置数据）。
- v2 携带 `logFormat=4`、插件 `projectionVersion`、排他 offset（`epoch:'v4-offset'`）与 `committedMessageId` 稳定锚点；legacy v1 坐标保留原 inclusive 值（`epoch:'legacy-v1'`），**不做** `oldSeq+1` 数值换算——`foldStaleReason()` 对 legacy 坐标一律拒绝数值比较，要求重新预览/重建锚点。
- 晋升只在明确操作路径（Fold 预览锚点建立）写入；Seed 文本、来源与旧坐标 epoch 作为 provenance 完整保留；损坏/未知 schema 返回含原文的可诊断错误，绝不当作空列表覆盖。
- 旧权限快照含 `run_code` 时移除 transport、保留其余上限并标记 `transportRunCodeRemoved`。
- 迁移边界：上游日志迁移（V1→V4）与插件记录转换是两个独立版本轴；"日志已被 DSH 迁移、插件记录未转换"的组合由 legacy epoch 拒绝数值比较保证安全。

## 3. D7 真实类型门槛（最终覆盖说明）

`pnpm check:plugin-alpha2`（`scripts/verify-real-exports.mjs --full-plugin`）在 `tests/contracts/alpha2-fixture`（真实 `0.2.1-alpha.2` 发布包安装，`node_modules` 在位）内运行 **两个 noEmit 工程**：

1. **Host 工程 `tsconfig.full-plugin.json`**，files：
   - `src/index.ts`（桶：service/spec/types/seed/fold/transactions/safe-boundary/read/tool/revision/tool-contract/relations/task-seed/usage 及其传递依赖 message-source、session-history、record-compat 等）
   - `src/service.ts`、`src/trajectory.ts`、`src/usage.ts`（显式列出，防止桶导出收缩后静默漏检）
2. **Client 工程 `tsconfig.full-plugin-client.json`**（新增），files：`src/client/index.ts`、`api.ts`、`components.tsx`、`workflow-dialogs.tsx`、`trajectory-panel.tsx`、`trajectory-layout.ts`、`workflow-events.ts`、`locales.ts`、`styles.ts`（共享 `types/revision/seed` 经传递导入）。

两个工程都不含 `types/dsh-compat.d.ts` facade、Vitest alias/shim；`paths` 使用裸包名通配 + 每个 `/client`、`/types` 子路径的精确映射（裸通配把子路径当文件系统目录正是 03b "token-meter/client 未发布" 误诊的根因，B6 已修，本轮补齐 `@deepseek-ai/dsh-session/types`）。

**为什么拆成两个工程**：真实包中宿主 `dsh-session` 根入口把 `Context.sessions` 增强为宿主 `SessionStore`，而 `@deepseek-ai/dsh-api-session-controller/client` 把同一属性增强为客户端 `ISessions`。同一 TS 程序同时加载两者时（`skipLibCheck` 静默冲突）合并结果取决于导入顺序，产生"Client 代码拿不到 `refresh()`"的建模伪差。真实 Web Client 运行时只加载 client 包，因此 Client 工程独立建模，Host 工程独立建模；这不是用声明绕过检查（facade 与本地 `declare module` 都不参与这两个工程）。

**门槛链**：`package.json scripts.verify` 现为 `typecheck → lint → test → verify:contracts → verify:real-exports → check:plugin-alpha2 → verify:portable → build → smoke:manifest`。独立普通 build（`pnpm typecheck`/`pnpm build`）不依赖 fixture，继续走 facade。

## 4. 新增 / 更新测试（本轮 26 文件 / 151 测试，全部通过）

| 文件 | 变更 | 覆盖 |
|---|---|---|
| `tests/commands.client.spec.ts`（重写） | TestCommand.description 为回调；ctx mock 移除 `sessions.open`（仅保留 `refresh`），新增 `uiWorkspace.openSession` mock | 16 个命令注册、description() 实际调用且等于 locale 词条、tail:1 默认、identity 门槛 |
| `tests/trajectory.unit.spec.ts` | 更新 + 新增 7 例 | V4 tool-role 解析（source.callId/isError/正文）、旧 tool-result 包装兼容、activation 不误报完成（call 与 result 均 unknown）、`subagent_fork` 别名与非别名工具不误识别、PTC 按 `subCallId` 配对 + meta 不入正文 + 不计入外层 calls（overview calls=1, failures=1）、未结算 PTC unknown、`assistant/attempt` 不渲染为成功、运行时 `subagent/start|end` 通知不产生节点 |
| `tests/trajectory-execution.acceptance.spec.ts` | `result()` helper 改为 V4 形状 | 三步执行回放、逆序结果配对、压缩 replace 不入轨迹 |
| `tests/usage.unit.spec.ts` | 新增 2 例 | 压缩替换副本不产生第二份 usage（complete=true 且总量不变）、缺 usage 证据显示 unknown 不补数字 |
| `tests/usage-real-helper.unit.spec.ts`（新） | 从安装的 alpha.2 fixture 以运行时文件 URL 加载**真实** `deriveTurnTokenUsage`（绕开 Vitest alias 前缀改写，使 helper 内部 `@deepseek-ai/dsh-llm/assistant-stream` 走真实解析） | 单 attempt 精确聚合、失败 attempt（stream usage）+ retry 双 attempt 聚合（且上游契约：未归属 route 时 `routes` 收回）、缺证据 unknown、经 `durableAttemptEvent` 过滤组合后替换不双计（并实证未过滤时上游 helper fail-closed 返回 undefined，不产生双计） |
| 其余 21 个既有测试文件 | 未改 | 全部保持通过（B/C 批覆盖不变） |

shim 说明：`tests/shims/token-meter.ts` 保留为独立测试替身（便携性要求：普通 `pnpm test` 不依赖 fixture 安装）；它不能再证明兼容——真实兼容证据由 `usage-real-helper.unit.spec.ts`（运行时行为）+ full-plugin 类型工程（d.ts 签名）共同提供，签名核对自真实 `lib/types/turn-usage.d.ts`：`deriveTurnTokenUsage(events: readonly SessionEvent[]): TurnTokenUsage | undefined`。

## 5. 实测证据（命令 / 退出码 / 关键日志）

汇总 JSON：`.smoke-dsh-alpha2/evidence/d-verification-summary.json`（7 步全部 exit 0）。

| # | 命令 | 退出码 | 证据 |
|---|---|---|---|
| 1 | `pnpm verify`（typecheck → lint → test(26 文件/151 测试) → verify:contracts → verify:real-exports → **check:plugin-alpha2** → verify:portable → build → smoke:manifest） | 0 | d-verify.log |
| 2 | `npm pack --json`（重建 tgz） | 0 | d-pack.log |
| 3 | `dsh.ps1 plugin --profile web add <tgz> --force` | 0 | d-install.log |
| 4 | `dsh.ps1 --profile web --dump-config` | 0 | d-dump-config.txt |
| 5 | `node .smoke-dsh-alpha2/smoke-plugin.mjs` | 0 | d-smoke-plugin-run.txt |
| 6 | `dsh.ps1 plugin --profile web remove dsh-sidechat-plugin` | 0 | d-remove.log |
| 7 | `dsh.ps1 --profile web --dump-config`（卸载后） | 0 | d-dump-config-after-remove.txt |
| 8 | 残留进程探测 `check-processes.ps1` | **count=0** | （唯一匹配为探测命令自身） |

关键日志摘录：

- `d-verify.log`：`Test Files 26 passed (26)` / `Tests 151 passed (151)`；`real alpha.2 published exports satisfy the SideChat contract module`；`full plugin host and client sources compile against real alpha.2 exports`；`standalone source-build configuration and Git ignore policy passed`；`bundle manifest, declarative preset, client handoff, and forbidden-path checks passed`。
- `d-dump-config.txt`：`# == dsh-sidechat-plugin`、`id: preset-sidechat-clarifier`、`id: sidechat-clarifier`、`name: dsh-sidechat-plugin`、`preset: sidechat-clarifier`（共 9 处 sidechat 匹配）；卸载后 `d-dump-config-after-remove.txt` 中 sidechat 匹配为 **0**。
- `smoke-plugin-result.json`（真实 runtime 集成，home=.smoke-dsh-alpha2/home，回环端口 127.0.0.1:50797）：`version 0.2.1-alpha.2`、`bootstrapStatus 303`、`indexStatus 200`、两个入口 JS 200（40,691 B / 635,065 B）、`entryActivated: true`（激活错误行 0、"did not activate" 行 0）、`registryStatus 200`、`registryIds: standard, ptc, minimal, cordis, sidechat-clarifier`、`sidechatPresetListed: true`、`sidechatPresetBroken: null`、**`modelCalls: 0`**（无任何模型调用；未配置真实凭证）。
- 全程仅隔离 home 与回环端口；结束时无残留 DSH node 进程。

## 6. 未完成项与残留风险（如实）

1. **真实浏览器手工操作未运行**：docs/MANUAL_TEST.md 清单没有一项被人工执行过；本轮真实 runtime 集成只覆盖 entry 激活、HTTP 面、preset registry 数据与 dump-config（modelCalls=0）。
2. **真实模型调用未运行**：Fold 生成/改写、task/summary Seed、压缩路径的真实 provider 行为没有实测；相关逻辑由 Host 侧受控测试覆盖。
3. **attempt 展开视图（P2）**：`assistant/attempt` 的失败/重试/取消明细没有专用展示节点（显式跳过）；保证是不误报——未投影节点不产生成功结论。发布说明需列出该未覆盖项。
4. **PTC/子代理展开深化（P2）**：PTC 子派发以 `kind:'ptc'` 节点配对展示（未做树形展开视图）；子代理内部轨迹仍不加载（保留"内部轨迹未加载"占位语义）。
5. **并发重复交付**（B/C 遗留，未恶化）：dedupe 依赖 maintenance 边界内的 marker 复核；未构造真实并发调度测试（修复轮新增的 delivery.host.spec.ts 覆盖三类崩溃点与已存在 marker 的持久性证明，但不覆盖真实并发重复调度的竞态）。
6. **冷恢复 sandbox/approval 事件丢失场景**（B/C 遗留，未恶化）：恢复依赖创建时持久化的日志事件；未单独构造"恢复时事件丢失"场景。D 批未暴露新的 B/C 侧问题。
7. **（修复轮已解决）子代理分类改为仅凭证据**：原 D 批的名称别名集合 `{task, agent, subagent, subagent_fork}`（"名称即证据"的已知权衡）已整体移除——真实 alpha.2 的子代理结果以渲染文本持久化（`started subagent <id>`），旧 JSON-only activationOf 在真实日志上从不匹配，导致真实形状结果被误标 success。现在分类只看证据：真实渲染身份或原始 `{"kind":"activation"}` 值（文档化回退）；无关同名工具不会被误分类，activation 仍不代表完成。详见 §9 补充项。
8. **`ctx.sessions` 增强冲突**：宿主/客户端两包对同一 Context 属性的类型增强冲突由双工程拆分建模（§3）；若上游未来统一该属性类型，可合并回单工程。
9. **（修复轮已解决）fixture 类型洞已关闭**：原 D 批的 `ClientSessionContext` 间接 `any` 已修复——`@deepseek-ai/dsh-client-ui-input-trigger@0.2.1-alpha.2` 已加入 fixture 依赖并补精确 `/client` 路径映射；闭包以 scratch TS2339 探针证明（对 `ClientSessionContext` 的伪造属性访问现在编译失败）。full-plugin 门槛现在对 Client 源码无已知 `any` 洞。详见 §9 补充项。
10. **PTC 程序解释器为受控 stub（修复轮新增）**：真实工具 harness（permission-real-tools.spec.ts）中的 PTC program host 是实现真实 `ptcRuntime` 契约（language/resolve/run）的最小 stub；真实 `dsh-ptc-runtime-node` 程序解释器未在 fixture 中发布，测试没有编译/执行真实 TypeScript 程序文本。PTC 传输与嵌套能力守卫用真实 `@deepseek-ai/dsh-tools` + 真实 cordis 验证。
11. **fixture 依赖集合扩大（修复轮）**：fixture 精确固定新增 `dsh-storage`、`dsh-storage-json`、`dsh-scope`、`dsh-sandbox`、`dsh-client-ui-input-trigger`（均 `0.2.1-alpha.2`），pnpm-lock.yaml 经 `pnpm install` 更新。

总结声明：**未执行生产数据迁移；未执行在线模型验收；全部模型相关验证使用受控 provider/合成数据边界。**

## 7. 文档更新清单

- `README.md`：基线改为 alpha.2、verify 链说明、lib 产物（preset-root 移除）、dump-config 验收（sidechat 服务行 + registry）、轨迹/usage 能力描述（V4/PTC/activation/替换不双计）、已知限制（浏览器手工与模型调用未跑、attempt/PTC P2）、项目结构（presets/ 移除）。
- `docs/MANUAL_TEST.md`：头部实施状态块（区分真实检查 / shim 覆盖 / 未运行项）；dump-config 断言更新。
- `docs/M0_API_VERIFICATION.md`：头部 alpha.2 状态更新（sessions.open 移除、description 回调、plugin:dsh-sidechat source、异步读取、token-meter 误诊纠正）。
- `docs/M2_API_VERIFICATION.md`：头部 alpha.2 状态更新（token-meter 真实发布与实测、sessionQuery 排他 offset、MessageSourceMap）。
- `docs/DSH_0.2_UPGRADE_PLAN.md`：头部与第 9/11 节末尾实施状态行（不改动历史正文与验收标准）。
- 本文件：`docs/DSH_0.2_IMPLEMENTATION_REPORT.md`（新）。

## 8. 执行命令清单（本批实际运行）

```
node scripts/verify-real-exports.mjs --full-plugin        # 迭代期间多次，最终 exit 0
pnpm typecheck                                            # exit 0
pnpm lint                                                 # exit 0
pnpm test                                                 # 最终 26 文件/151 测试 exit 0
pnpm verify:contracts                                     # exit 0
pnpm verify:portable                                      # exit 0
pnpm build && pnpm smoke:manifest                         # exit 0
node .smoke-dsh-alpha2/run-d-verification.mjs             # 7 步全 exit 0（见 §5）
powershell -File .smoke-dsh-alpha2/check-processes.ps1    # count=0
```

中途失败均已修正后重跑：JSX flag 缺失（fixture tsconfig 补 `jsx: react-jsx`）、`@deepseek-ai/dsh-session/types` 子路径解析（补精确 paths 映射）、`ctx.sessions` 双增强冲突（双工程拆分）、`Set` 大小写导致 `Task` 别名漏识别、activation 结果的 call 状态仍为 success（ResultRecord 增加 activation 标记）、真实 helper 的 retry 状态机要求 `assistant/attempt → llm/retry → llm/retry-started → assistant/message` 顺序（按真实生命周期修正测试）、runner 的 PowerShell `-File` 引号问题（改为直接 spawn 参数数组）。一次运行中 `Set-Content` 编码事故损坏了 `src/trajectory.ts` 的 5 个非 ASCII 字符串（`↩`/`✓`），已逐一恢复并经 `check:plugin-alpha2`/全量测试复核。

## 9. 修复轮（repair）：Codex 源码审查 alpha.2 适配修复（2026-10-12）

本节记录 Codex 对 A–D 批源码审查发现的问题与对应修复，以及每项的实际验证状态。全量验证链（`typecheck → lint → test(28 文件/207 测试) → verify:contracts → verify:real-exports → check:plugin-alpha2 → verify:portable → build → smoke:manifest`）与真实 runtime 集成 smoke 全部 exit 0（证据见 §9.3）。测试计数为 JSON reporter 实测值。

| # | 问题 | 修复 | 测试证据 | 状态 |
|---|---|---|---|---|
| 1 | ensurePermission 安装语义：成功安装被误报失败、失败安装无重试与阻断 | 已成功的安装幂等返回 true 且不再拆除；失败安装记入 `permissionBlockedAgents` 并重试；`agent/created` 处理器与冷启动 sweep 尊重安装结果；被阻断 agent 经真实 `agent.cancel({kind:'hook'})`（upstream runtime-types.ts:176-183）停止，配合串行 created 派发保证（runtime-types.ts:248-261）与 deny-all 守卫；守卫自身安装失败绝不放行（blocking-guard 安装本身被包裹，agent 仍记为 blocked）；插件 model/tool 入口由 `assertPermissionEnforced`/`assertPermissionNotBlocked` 把关（generateSeedSummary、applyModelStrategy、generateFold 严格、createOne 首问不变）。**（最终修复轮 R1 补强）**本项原始修复的 cancel+串行派发不是持久强制：接手修复新增 `agent/pre-step` 准入 gate（§10），取消后新入队的工作同样被拒，legacy 缺快照子会话不再无限制恢复 | `tests/permission.host.spec.ts`（17 测试；最终修复轮扩至 24） | 通过 |
| 2 | PTC：合法快照下保留的 `run_code` 传输被误入 restrict（上游 restrict 遇 run_code 会抛错）；restrict 收到不可探测的 scope-local 工具名 | 守卫在有效快照下放行保留的 `run_code` 传输，同时对原生与 PTC 嵌套的 terminal 能力逐调用检查（upstream ptc.ts:542-627 嵌套派发流经 per-agent 守卫）；`run_code` 永不进入 restrict；restrict 只接收可探测的继承工具名（同层 scope-local 工具改为守卫约束，不传给 restrict）。真实受控 Tools harness：fixture 依赖补入 dsh-scope + dsh-sandbox，使用真实 `@deepseek-ai/dsh-tools` + 真实 cordis——原生 deny/allow、PTC 传输 run_code 成功执行 + 超快照嵌套能力逐调用拒绝、真实上游 restrict 对 run_code 与 scope-local 名抛错、restrict 失败后无残留安装（事务性）。**如实限制**：harness 的 PTC program host 是实现真实 `ptcRuntime` 契约（language/resolve/run）的最小 stub——真实 `dsh-ptc-runtime-node` 程序解释器未在 fixture 发布，测试未编译/执行真实 TypeScript 程序文本（§6 项 10） | `tests/permission-real-tools.spec.ts`（4 测试，真实 @deepseek-ai/dsh-tools + 真实 cordis） | 通过（PTC 程序解释器部分为 stub，见限制） |
| 3 | Persona：inherit-mode 子会话只有 suffix，没有完整 SideChat 角色 prefix；readonly 子会话有重复 prefix 风险（upstream `systemPrompt.section` 对重名抛错，persona/src/index.ts:62-68、system-prompt/src/index.ts:466-483） | 所有 SideChat 子会话都拿到完整角色：子会话组合 preset 不是声明式 sidechat-clarifier 时，运行时安装 PERSONA_PREFIX_SECTION（order `DEPLOYMENT_PERSONA_PREFIX`）；readonly 子会话不重复安装 prefix；共享常量 `src/persona.ts`（`SIDECHAT_PERSONA_PREFIX`），带 cordis.patch.yml 同步测试。父 preset 与权限上限不变 | `tests/permission.host.spec.ts`（persona 前缀安装/不重复/patch.yml 同步） | 通过 |
| 4 | deliverAtSafeBoundary 已存在 marker 分支把"live 读到"当持久性证明：真实 alpha.2 `readSession` 是 live-preferred（读内存 snapshotEvents，corpus.ts:98-127），不证明磁盘 | marker 在 live-preferred 快照中命中时触发真实 flush；flush 失败抛 "durability unproven … will not be committed"（不提交）；flush 成功后重读日志并重新定位 marker。测试用诚实的 memory-vs-disk harness（append→memory；flush 复制 memory→persisted；readSession 返回 live memory），覆盖三个崩溃点：append-before-flush（flush 失败的重试不提交；flush 成功的重试无第二次 append 即提交）、flush-before-domain-commit（marker 已持久，无第二次 append 即提交）、domain-commit（不重投）。原"flushed-but-uncommitted"缺陷测试（memory+flush-false 被当作已持久）已修正 | `tests/delivery.host.spec.ts`（14 测试，重写） | 通过 |
| 5 | locateSideChatDelivery 证据过宽：快照/Seed 引用完整 marker+payload、用户粘贴、相似 marker 的其他操作都可能命中 | 现在要求同时满足全部条件：SideChat 生产者（当前或显式 legacy notice 身份）、source form `notice`、精确绑定的 notice summary、完整 marker、以及 frozen-payload 证据（**修复轮时为前 160 个空白规范化字符的摘录；接手修复已升级为 marker 之后完整正文的精确相等身份**，`src/session-history.ts` DeliveryEvidence/deliveryPayloadIdentity）。反例测试：插件快照/Seed 引用完整 marker+payload（不命中）、用户粘贴（不命中）、相似 marker 的其他操作（不命中）；真例：当前与 legacy notice 交付均命中 | `tests/delivery.host.spec.ts`、`src/session-history.ts`（DeliveryEvidence）；全文匹配修复见 §10 | 通过 |
| 6 | 维护期重校验缺失：waitIdle/压缩后 source 可能过期；pending payload 可在提交前被改写 | atSafeBoundary 现接受 agent resolver——每次维护尝试重新解析目标 agent 并校验身份；deliverFold/deliverCite/deliverWithdrawal 把 relation/workspace/跨父生命周期/revision 检查经 revalidate 回调移入维护任务内部；pending payload 冻结在提交点强制：commitFold（committedContent 不一致 → 'payload-frozen'）、withdrawFold（frozen reason 不一致 → 'payload-frozen'）、cite（reserveCite 幂等 + updateCite 内容硬守卫） | `tests/revision-fence.host.spec.ts`（7）、`tests/transactions.unit.spec.ts`（8）、`tests/delivery.host.spec.ts`（14） | 通过 |
| 7 | Fold 选择取 firstAssistantAtOrAfter：计划/工具步骤叙述可能成为 Fold payload | 改为 `finalAssistantAtOrAfter`（src/session-history.ts:93）：取排他基线之后**最后**一条直接撰写的 assistant 消息，排除 surfaceOp replace 副本 | `tests/fold.unit.spec.ts`（17）、`tests/seq-boundary.host.spec.ts`（9：叙述+工具窗口场景选中最终回答） | 通过 |
| 8 | Stop/HMR 顺序：dispose 时在途操作未排空即释放读取/权限/阻断 disposers；冷启动遗留 'generating' Fold 无明确恢复语义 | dispose effect 先 `await allSettled` 排空 operationTails+deliveries，再释放 read-tool/permission/blocking disposers 并关闭 domain（真实 Cordis 等待 effect disposers——fiber.ts:407-465/674-687 已在代码注释引用）；冷启动 sweep 把遗留 'generating' Fold 转为显式 failed 状态，恢复原因 "interrupted by a restart … Re-run the preview (prepareFold)"，绝不自动运行模型 | `tests/delivery.host.spec.ts`（14：dispose 顺序 + generating 恢复） | 通过 |
| 9 | 记录兼容只在自研模拟存储上验证；真实 storageDomain 的写入/打开行为未实测 | `tests/record-compat-real-domain.unit.spec.ts` 在临时目录运行**真实** `@deepseek-ai/dsh-storage-domain` + 真实 JSON 后端（fixture 依赖补入 dsh-storage + dsh-storage-json）：合法 v1 legacy 往返（不预填坐标——epoch 来自读取边界的 zod 默认；frozen baselineSeq/previewThroughSeq、committed/revision/withdrawal 历史、Seed provenance 保留）；真实行为验证：put 不校验写入（domain.ts:307-313）——错误在 open 时以 DomainError 'invalid-record' 出现、原始字节保留、无空表写回（index.ts:121-141/164-167/198-209）；损坏字节 → malformed-medium/version-mismatch；close/re-open 存活。`tests/record-compat.unit.spec.ts` 增加显式不预填坐标守卫 | `tests/record-compat-real-domain.unit.spec.ts`（4）、`tests/record-compat.unit.spec.ts`（7） | 通过 |

### 9.1 补充项（client / 轨迹 / usage / fixture）

| 项 | 内容 | 测试证据 | 状态 |
|---|---|---|---|
| S1 命令导航真 RPC 驱动 | commands.client.spec.ts 导航测试真正驱动 command/option 回调 over mocked RPC：create→ 经真实 `/side` onSelect 进入 child → workflow → 真实 SideChatApi over mocked connection.rpc.call → openSession('child-created')；back-to-parent；resume；16 个 description() 调用全部保留 | `tests/commands.client.spec.ts`（7） | 通过 |
| S2 未结算 PTC start 语义 | 未结算 PTC start 现为 selectable:false + fullContentAvailable:false（裸 ptc-dispatch-start 没有已结算内容，宣称精确明细即失实）；已结算 dispatch 的 detail/masking 语义不变 | `tests/trajectory.unit.spec.ts`（19） | 通过 |
| S3 子代理分类改为仅凭证据 | 名称别名集合整体移除；分类只看证据：真实 alpha.2 渲染身份 `started subagent <subagentId>`（tool-subagent/src/index.ts:277 + tools createSuccessResult 持久化内容）+ 文档化的原始 `{"kind":"activation"}` 值回退。关键事实：旧 JSON-only activationOf 从不匹配真实 alpha.2 日志（真实结果以渲染文本持久化）——之前真实形状结果被误标 'success'，已修。无关同名工具不误分类；activation 仍不代表完成。旧 §6.7 "alias 已知权衡"已更新为已解决（§6 项 7） | `tests/trajectory.unit.spec.ts`（19） | 通过 |
| S4 轨迹投影版本 v5 | TRAJECTORY_PROJECTION_VERSION 'trajectory-v4' → 'trajectory-v5'（语义变更：ptc kind、unsettled-start、subagent 证据、activation 身份）；v4 戳的 ref/snapshot 经 digest 版本参与被拒绝为 stale（测试证明 v4 ref 被拒、v5 通过）；types.ts 无需 schema 变更 | `tests/trajectory.unit.spec.ts`（19）、`src/trajectory.ts:13` | 通过 |
| S5 usage 真实 helper 组合路径 | deriveSessionUsage 组合路径对真实 `deriveTurnTokenUsage` 测试（vi.mock factory 把别名 specifier 重定向到真实 fixture 模块；以 helper 身份证明拦截生效；真实 retry 状态机数字 24/27 vs shim 14/17）；surfaceOp replace fixture 全部改为真实 V4 形状 `{op:'replace', startSeq, endSeq}` | `tests/usage-real-helper.unit.spec.ts`（9）、`tests/usage.unit.spec.ts`（5） | 通过 |
| S6 Unicode 复核 | src/ + tests/ 的 U+FFFD/mojibake 字节级扫描干净（修复轮复跑确认；本轮复扫扩展到 docs/ scripts/ 亦干净） | 本轮 Node 字节扫描（结果见命令清单） | 通过 |
| S7 fixture 类型洞关闭 | `@deepseek-ai/dsh-client-ui-input-trigger@0.2.1-alpha.2` 加入 fixture（另加 dsh-storage、dsh-storage-json、dsh-scope、dsh-sandbox 作为必需真实依赖），补精确 `/client` 路径映射；闭包以 scratch TS2339 探针证明（对 ClientSessionContext 的伪造属性访问现在失败；此前为 any）。旧 §6.9 已更新（§6 项 9）；fixture 依赖集合扩大见 §6 项 11 | `pnpm check:plugin-alpha2`（repair-check-plugin-alpha2.log，exit 0）+ TS2339 scratch 探针 | 通过 |

### 9.2 修复轮验证与集成证据（命令 / 退出码）

汇总 JSON：`.smoke-dsh-alpha2/evidence/repair-verification-summary.json`（17 步全部 exit 0）。

| # | 命令 | 退出码 | 证据 |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | repair-typecheck.log |
| 2 | `pnpm lint` | 0 | repair-lint.log |
| 3 | `pnpm test`（**28 文件 / 207 测试全部通过**） | 0 | repair-test.log |
| 4 | `pnpm verify:contracts` | 0 | repair-verify-contracts.log |
| 5 | `pnpm verify:real-exports` | 0 | repair-verify-real-exports.log |
| 6 | `pnpm check:plugin-alpha2` | 0 | repair-check-plugin-alpha2.log |
| 7 | `pnpm verify:portable` | 0 | repair-verify-portable.log |
| 8 | `pnpm build` | 0 | repair-build.log |
| 9 | `pnpm smoke:manifest` | 0 | repair-smoke-manifest.log |
| 10 | `npm pack --json`（tgz: dsh-sidechat-plugin-0.3.4.tgz） | 0 | repair-pack.log |
| 11 | `dsh.ps1 plugin --profile web add <tgz> --force` | 0 | repair-install.log |
| 12 | `dsh.ps1 --profile web --dump-config`（断言 `preset-sidechat-clarifier` 与 `sidechat`/`dsh-sidechat-plugin` 服务行在场） | 0 | repair-dump-config.txt |
| 13 | `node .smoke-dsh-alpha2/smoke-plugin.mjs` | 0 | repair-smoke-plugin-run.txt |
| 14 | `dsh.ps1 plugin --profile web remove dsh-sidechat-plugin` | 0 | repair-remove.log |
| 15 | `dsh.ps1 --profile web --dump-config`（卸载后 sidechat 匹配 **0**） | 0 | repair-dump-config-after-remove.txt |
| 16 | 残留进程探测（自进程排除后） | **count=0** | repair-process-check.txt、repair-process-check-rerun.txt |
| 17 | 端口探针（脚本 start 前 Node `listen(0)` 探得 127.0.0.1:59808 空闲） | 0 | repair-port-probe.txt |

真实 runtime smoke 门（repair-smoke-plugin-run.txt / smoke-plugin-result.json）：`version 0.2.1-alpha.2`、`entryActivated: true`（激活错误行 0）、`sidechatPresetListed: true`、`sidechatPresetBroken: null`、**`modelCalls: 0`**（无任何模型调用；未配置真实凭证）。隔离环境同 D 批：`.smoke-dsh-alpha2/home`（DSH_HOME）、`workspace`、`npm-cache`、loopback 回环；Host 以 `--port 0`（OS 分配临时端口）启动，不固定占用 50797 等端口。残留进程探测说明：脚本内首测 count=1 为探测脚本对验证脚本自身的子串自匹配，脚本退出后独立复跑 count=0，无 DSH 残留进程（repair-process-check-rerun.txt）。

### 9.3 修复轮执行命令清单（本节实际运行）

```
node .smoke-dsh-alpha2/run-repair-verification.mjs        # 17 步全 exit 0（§9.2）
pnpm vitest run --reporter=json                           # 分文件实测计数（总计 207）
pnpm vitest run tests/permission.host.spec.ts             # 17 测试
node -e "<U+FFFD byte scan>"                              # src/ tests/ docs/ scripts/ clean
powershell -File .smoke-dsh-alpha2/check-processes.ps1    # 复跑 count=0
```

本节如实声明：**未执行生产数据迁移；未执行在线模型验收；全部模型相关验证使用受控 provider/合成数据边界。**

## 10. 中断交付与 Codex 接手（2026-10-13）

用户新增执行要求：同一任务两次委派交付后仍存在未解决问题，由 Codex 自行修改和验证，不再反复委派。本次权限、Fold 与集成验收已达到该条件，后续由 Codex 接手。

先前 final-repair / integration 两轮均被中断，保留落盘改动供审查；它们不构成已验收交付。原 §10 声称的 `final-repair-*` 验证文件未找到，其“220 测试 / verify 通过”不能作为证据。§1–9 为历史批次记录；当前结论以本节及当前 `codex-*` 日志为准。

### 10.1 亲自复核与修复

| 范围 | 最终实现 | 验证 |
|---|---|---|
| Persona | SideChat 使用自有 `sidechat:persona-prefix` / `sidechat:persona-suffix` section；保留父 preset 的 prefix 与非空 suffix。真实 `dsh-persona.apply`、preset 父层及 `bindScopeParent` 子层组合已加入测试 | `permission-real-tools.spec.ts` 真实发布包测试 |
| 冷 SideChat 父会话 task Seed | 即使历史已有 model route，也先 resolve/resume 父 Agent 并恢复权限，再进入 `llm.stream`；失败时拒绝 provider 工作 | `task-create.host.spec.ts` |
| 权限钩子注册失败 | 优先 Agent 作用域 `agent/pre-step`；失败则在服务作用域注册按 Agent 对象身份筛选的模型 gate。普通 Agent 与同 ID 的后续生命周期不被误阻断。两种 gate 均失败时显式拒绝 created / service startup。删除了“idle disposed cancel 可永久阻断后续模型”的错误推断 | `permission.host.spec.ts`：Agent listener 与 tool guard 同时失败时，服务级 gate 拒绝连续新请求；普通会话仍放行 |
| 冷 Fold | 在严格权限断言之前 resolve Agent 并安装持久化 ceiling；恢复失败时不调用 followup | `seq-boundary.host.spec.ts` 冷成功 / 冷失败 |
| Fold 回答归属 | 用自己排队的 UserMessage ID 找到 admitted turn；只接受该轮最终直接 assistant 文本，排除 replace 副本及 interrupted 前缀 | 同文件，生成和 rewrite 后均插入普通追问回归 |
| Fold 结算 | 必须有 `turn/end.reason.kind === completed`；aborted、error、blocked、interrupted、max-tokens、未结算输出均拒绝 | 同文件，逐类回归 |
| Fold 新鲜度 | preview offset 截止自己的成功 turn/end；后续普通轮次保持 stale。rewrite 明确绑定原草稿 ID 与全文，不能把插入的普通回答当成原稿或已覆盖上下文 | 同文件，普通追问 / rewrite 中间插入 / 正常完成不误过期 |
| 交付身份与冻结 | leading marker + producer + notice summary + 完整正文精确相等；只裁剪外层空白，保留正文缩进和换行。failed Fold 已冻结的正文同样禁止变更 | `fold.unit.spec.ts` / `delivery.host.spec.ts` |

### 10.2 当前验证证据

- `.smoke-dsh-alpha2/evidence/codex-focused.json` / `.log`：5 个文件 / 87 项针对性回归，exit 0。
- `.smoke-dsh-alpha2/evidence/codex-verify.json` / `.log`：2026-10-13 执行 `pnpm verify`，28 个文件 / **241 项测试通过**，exit 0；包括 lint、真实 alpha.2 导出与完整 Host/Client 类型工程、portable、build、manifest。
- 最终复跑 `codex-final-verify.json` / `.log`：2026-10-13 09:14–09:15（Asia/Shanghai），28 文件 / 241 测试，exit 0；另以 `DSH_SOURCE_DIR=D:\Developing\deepseek-harness` 核验 23 个上游源码契约锚点。
- 所有当前日志由 Node 捕获 UTF-8 输出和真实进程退出码。首次沙箱 pnpm realpath 遇 EPERM，随后在授权执行环境重跑成功。
- 真实隔离 RPC、冷重启、AgentLoop 故障恢复与 Chrome smoke 已通过，证据见 §10.3。

当前仍未执行在线模型验收、生产数据迁移及完整浏览器人工验收。已完成的 JSDOM 命令回调测试不等于浏览器人工操作；真实 Tools harness 的 PTC program host 仍为受控 stub。

### 10.3 真实 Host、AgentLoop 与 Chrome 验收

本轮真正调用插件 RPC 后发现此前 smoke 的漏检：专属 `connection.rpc.handle('/sidechat')` 在 provider 的 Cordis shadow context 中创建 route effect，即使调用方已 inject webServer，仍会抛 `cannot get property "webServer" without inject`。该异常位于子 fiber，旧 smoke 检查顶层 entry 无错误与 preset registry 会误判。它不是 Web 服务隔离问题；在初始化早期检查到服务暂未出现也不能证明隔离。

最终修复：`cordis.patch.yml` 按 `id: connection` 补充 provider 自身的 `webServer` grant，并保留 Web bundle 原有 `webStartup`；不替换其 config。`scripts/smoke-manifest.mjs` 增加该装配契约门槛。随后以新 tarball 安装并执行实际 RPC，全部通过：

| 实测场景 | 结果 |
|---|---|
| readonly / inherit 创建、首轮输出、persona 装配 | 两模式均成功；权限实际安装；当前测试父工具下分别可见 14 / 31 个工具（数量仅为本次环境观测，不是通用保证） |
| prepareFold → commitFold → Cite → withdrawFold | 实际服务写入 3 条父会话 notice；交付期间 provider 调用增量为 0 |
| Host 进程退出后重启 | committed / withdrawn 记录保留；重启后读取不运行模型；直接 cold prepareFold 成功恢复权限，自己的成功 turn/end 与 previewNextSeq 一致 |
| 真实 AgentLoop 故障注入 | 权限原安装释放后，同时使 Agent listener / Tools guard 注册失败；实际安装失败，服务级 gate 启用；连续 3 次 fresh followup 的 provider 增量为 0；恢复后重新安装成功，新 followup provider 增量为 1 |
| Chrome headless | 使用新建独立 user-data-dir；关闭预览提示、展开未分组、打开测试 SideChat；Header 与轨迹页面挂载，认证 RPC 200；输入 `/side` 后显示 sideback / sidefold / sideusage 等命令及中文描述；未捕获 JS 异常为 0 |
| 安装清理 | 验收 finally 卸载 SideChat，停止自己启动的 Host / Chrome；未修改用户默认 DSH_HOME |

证据（本机 `.smoke-dsh-alpha2/evidence/`）：`codex-runtime-result.json`、`codex-runtime-warm.log`、`codex-runtime-cold.log`、`codex-pack.log`、`codex-install.log`、`codex-remove.log`、`codex-browser-result.json`、`codex-browser.png`。测试 adapter 和诊断辅助路由仅在临时 overlay 中加载，不包含在发布 tarball 中。

复跑本机离线运行验收：从仓库根执行 `node .smoke-dsh-alpha2/codex-runtime-acceptance.mjs`。需要已安装的隔离 alpha.2 runtime 与 Chrome；该脚本打包、安装、用临时离线 overlay 启动、验收并 finally 卸载。脚本与证据位于 Git 忽略的本地测试环境，未作为插件运行依赖发布。正式包只包含产品实现与文档。

### 10.4 使用本机隔离环境

源码目录为 `D:\Developing\deepseek-harness`，固定在目标提交。运行时为 `D:\Developing\dsh-sidechat-plugin\.smoke-dsh-alpha2\runtime`，未全局安装 dsh。wrapper 只设置进程级 DSH_HOME。

验收结束后插件已卸载；要在本机重新打开插件页面，先从仓库根运行：

```powershell
npm pack
.\.smoke-dsh-alpha2\dsh.ps1 plugin --profile web add .\dsh-sidechat-plugin-0.3.4.tgz --force
.\.smoke-dsh-alpha2\dsh.ps1
```

普通 wrapper 不会加载离线 provider。继续真实对话需要配置可用模型；离线验收则使用上一节脚本。查看完毕可运行 `dsh.ps1 plugin --profile web remove dsh-sidechat-plugin` 卸载。

### 10.5 验收边界与保留事项

- 未调用任何在线模型，未使用用户真实凭证；受控输出验证 API 和状态机，不能证明真实模型输出质量。
- 未迁移生产数据；旧记录、坏字节保留等由真实 JSON domain 测试验证。
- 真实 PTC 程序解释器、跨平台、完整人工 UI 清单、真实并发重复交付竞态尚未覆盖；不把它们记录为通过。
- 无 requestContext 的空白父会话无法证明 Fold 的上下文预算，会按现有安全策略拒绝交付。真实 RPC 验收使用已完成一次受控模型请求的父会话。
- 验收结束时，改动保留在工作区，尚未 commit、stage、push 或发布；后续提交状态以 Git 历史为准。
