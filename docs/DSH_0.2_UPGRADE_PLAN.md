# SideChat 适配 DSH 0.2 的详细更新计划

> ## 当前状态（2026-10-13）
>
> - 适配目标固定为 `0.2.1-alpha.2` / `d743267388641bc76f17c45ce8b4c231aed1d32c`；源码 checkout 与隔离 runtime 已更新到该基线。
> - A–D 实施后，Codex 已按“两次委派交付仍有问题则自行接手”的用户要求修复残留。完整 `pnpm verify`：28 文件 / 241 测试通过；真实 RPC 与浏览器验收状态见 [实施报告 §10](DSH_0.2_IMPLEMENTATION_REPORT.md)。
> - 中断轮次的自报完成不能替代验收；原 final-repair 证据缺失声明已撤回。
> - 正文为历史更新方案，保留原验收标准；旧 alpha.1、未实施等表述只代表当时状态。

更新日期：2026-10-11。文档状态：**方案与验收标准已编写，运行时代码尚未实施（历史表述——见上方 CURRENT STATUS，实施已于 2026-10-12 完成）**。
实施状态（2026-10-12）：A/B/C/D 批已实施并通过验证门槛；逐项实测证据、与本文验收标准的对照及未完成项见 [DSH 0.2 实施报告](DSH_0.2_IMPLEMENTATION_REPORT.md)。本文正文保留为历史方案，原验收标准未改写。

本文面向执行适配的开发者，规定目标版本、文件修改、旧数据处理、测试与发布顺序。2026-10-05 的初次发现保留在 [源码评估](DSH_0.2_ADAPTATION_ASSESSMENT.md)；本文将实施目标推进到 `0.2.1-alpha.2`。后文的“应”“新增”“验收”均表示待完成要求，不代表已经实现。

## 1. 版本与证据基线

| 对象 | 已核对状态 | 本轮处理 |
|---|---|---|
| 插件 | `0.3.4`；HEAD `581296e3cbafa01e3673342ee2eafbc6bb1675f7` | 保留现有业务范围，实施后再确定插件发布版本 |
| 插件声明的 DSH | `0.1.2-alpha.1`；旧基线 `cd5ef81481` | 更换依赖、类型和组装基线 |
| 2026-10-11 上游 master | `0.2.1-alpha.2`；`d743267388641bc76f17c45ce8b4c231aed1d32c`，提交日期 2026-10-09 | **本次适配目标** |
| npm alpha | `0.2.1-alpha.2`，2026-10-09 发布 | 真实安装与插件集成测试固定此精确版本 |
| npm latest / next | 均为 `0.2.0-rc.2` | 不将默认 `npx @deepseek-ai/dsh` 当作本次目标 |
| 长期源码目录 | `D:\Developing\deepseek-harness` | 工作区 HEAD 仍为 alpha.1；已 fetch alpha.2，本文通过 `origin/master` 对应的固定提交读取源码（**历史表述，已过时**：实施后工作区 checkout 已固定到 alpha.2 目标提交 `d7432673…`，见头部 CURRENT STATUS） |
| 已安装本地测试环境 | 插件根目录 `.smoke-dsh-0.2/runtime`，`0.2.1-alpha.1` | 保留为旧基线；实施阶段另外准备 alpha.2 环境（**已完成**：`.smoke-dsh-alpha2/runtime` 与 `tests/contracts/alpha2-fixture`，见头部 CURRENT STATUS） |
| 已执行运行检查 | alpha.1 的 CLI、原生 Web 启动、认证跳转、首页和两个入口 JS 请求 | 不能作为 alpha.2 或 SideChat 已兼容的证据 |

历史方案阶段没有修改源码 checkout 或升级 alpha.1 runtime；实施阶段已将 checkout 更新至固定 alpha.2 提交，并新建隔离 alpha.2 runtime，保留旧 alpha.1 环境。源码引用均固定到目标提交；后续若上游继续发布，先重新核验差异，再变更基线，不自动扩大兼容范围。

证据：[alpha.2 发布提交](https://github.com/deepseek-ai/deepseek-harness/commit/d743267388641bc76f17c45ce8b4c231aed1d32c)、[目标根 manifest](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/package.json)、[npm 元数据](https://registry.npmjs.org/@deepseek-ai%2Fdsh)。

## 2. 适配完成后应保持的行为

1. SideChat 仍是普通、持久化、可恢复的 Session；不转换成 subagent 或 fork。
2. Seed 保存用户选择的不可变背景，不复制完整父 transcript；保留当前各 Seed 策略及预算约束。
3. Fold 的生成可以在子会话运行模型；向父会话提交 Fold、Cite、撤回通知时，父会话只追加消息，不启动模型 turn。
4. 保留 `pending → append/flush → committed` 的交付顺序、operation ID、marker、revision 和软撤回历史。
5. 权限上限仍由 Host 计算，冷恢复后重新安装；安装失败时子会话不能获得未受限制的运行能力。
6. 继续使用原生会话页面和模型选择器，保留“子会话”视图、Header 身份与返回导航、命令驱动流程。
7. 轨迹保持真实执行语义：call ID 关联、失败与取消分别展示、压缩 replacement 不重复算执行；没有证据时不推断子代理内部步骤。

本轮首先支持固定的新版 Host，并兼容旧持久数据。**旧数据兼容不等于同时支持旧 Host 运行时**。不在同一适配补丁中引入未经验证的双版本 API fallback，也不必同时重写 RPC、React 组件与所有存储设施。

## 3. alpha.2 相比初次评估新增的要求

| 新变化 | 对 SideChat 的影响 | 处理要求 |
|---|---|---|
| Tools mode 只支持 `native`、`ptc`，删除 `both` | 原评估中提到的 both 测试不适用于新目标 | 新配置和验收只覆盖 native/ptc；旧自定义 profile 的 both 配置需明确迁移 |
| `workflow-ptc` 新增 `workingDirectory` 注入 | 替换旧 workflow 包时，仅补齐原三项服务还不够 | 核验 `subagents`、`ptcRuntime`、`sandboxPolicy`、`workingDirectory` 全部可用 |
| 工具执行依赖 Session 当前工作目录 | `header.cwd` 不再等于可变的执行目录 | 生命周期身份仍使用创建元数据；不要把目录变化误判为 Session 被替换 |
| tool-subagent 去掉 `backgroundMode` 配置 | 当前 preset 两个 subagent 行还保留 `continuable` | 删除该字段；按新版 activation 语义测试，不依赖旧参数的行为 |
| 子代理工具返回 activation 身份，完成结果由运行时后续交付 | 启动成功的 tool result 不等于任务完成 | 轨迹应区分“启动已接受”与“子任务已完成”，不要把启动响应当最终答案 |
| Session projection 查询增加 `sequenced` / `migration-required` 分支 | 目录缓存可能只有旧提示，尚无当前精确 seq | 精确读取、Fold stale 判断和 marker 幂等校验不能使用未迁移缓存替代完整日志 |
| 新增实验性 `plugin:` record API | 不要求把 SideChat 关系存入 Session | 继续使用 storageDomain；实验 record 的尽力保留语义不适合承载本插件的权威关系和交付状态 |

上述新增差异已对照 alpha.1 与 alpha.2 源码。核心迁移项——声明式 preset、V4 source、异步历史读取、导航、命令描述回调——仍然成立。

证据：[Tools](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/tools/src/index.ts)、[workflow](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/workflow/workflow-ptc/src/index.ts)、[subagent 工具](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/subagent/tool-subagent/src/index.ts)、[projection 查询](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/index.ts)。

## 4. 文件改动总表

P0 表示会阻止安装、核心操作、权限落实或可靠恢复；P1 表示必须恢复的用户功能与验证能力；P2 表示可独立决定的扩展。完成适配需要通过全部适用的 P0/P1 验收。

| 优先级 | 文件或范围 | 具体工作 |
|---|---|---|
| P0 | `package.json`、`pnpm-lock.yaml` | 更新包名与版本；补充真实依赖；清理 preset-root 导出；重建锁文件 |
| P0 | `cordis.patch.yml` | 去掉旧 roots 覆盖，插入声明式 preset，保留 sidechat 服务配置 |
| P0 | `presets/sidechat-clarifier/*` | 迁移显示信息和插件列表；persona prefix；workflow-ptc；移除 backgroundMode |
| P0 | `src/service.ts` | 更新 import、六处 source、普通 Session 判定、历史读取、权限安装、交付与压缩服务解析 |
| P0 | `src/types.ts`、`src/spec.ts`、`src/transactions.ts` | 支持旧记录读取，定义新坐标语义与恢复分支；不丢失 committed 历史 |
| P1 | `src/client/index.ts`、`src/client/locales.ts` | uiWorkspace 导航，16 个命令描述回调及词条 |
| P1 | `src/trajectory.ts`、`src/usage.ts` | V4 tool-role 结果与错误标志；维持真实 usage；处理投影版本失效 |
| P0/P1 | `types/dsh-compat.d.ts`、两份 tsconfig、`vitest.config.ts`、`tests/shims/*` | 更新 facade 与 fixture；增加不依赖 shim 的真实导出类型检查 |
| P1 | `scripts/verify-dsh-contracts.mjs`、`scripts/smoke-manifest.mjs`、`scripts/verify-portable.mjs` | 新版本表、真实契约、manifest/注入/独立安装检查 |
| P1 | `src/preset-root.ts`、`tsdown.config.ts`、`tsconfig.host.json` | 删除旧注册实现及构建入口，或明确短期兼容导出的用途 |
| P1 | `tests/*.spec.*`、真实 Host 测试入口 | 按第 12 节修改原用例并补关键行为测试 |
| P1 | `README.md`、`docs/MANUAL_TEST.md`、API 核验文档 | 发布时更新已支持基线、安装方式和实测证据 |
| P2 | 轨迹 attempt/PTC/activation 的完整呈现 | 按第 9 节明确发布范围；不得让未覆盖节点显示错误结论 |

为降低 `service.ts` 中重复适配的风险，建议新增 `src/message-source.ts`、`src/session-history.ts` 和 `src/record-compat.ts`，分别集中 source 构造、历史/坐标读取、旧记录规范化。这些是建议的新文件，当前尚不存在；若现有模块能清楚承担职责，可保留现有文件组织。

## 5. 依赖、preset 与打包

### 5.1 包名和版本

| 包族/坐标 | 新目标 | 说明 |
|---|---|---|
| 仍使用的 `@deepseek-ai/dsh-*` 公共包 | `0.2.1-alpha.2` | 本轮精确固定；发布兼容范围只能覆盖实测版本 |
| `@deepseek-ai/dsh-agent-presets` | 删除 | 改为 `@deepseek-ai/dsh-agent-preset-registry` |
| `@deepseek-ai/dsh-agent-preset-registry` | 新增，`0.2.1-alpha.2` | service 名仍为 `agentPresets` |
| `@deepseek-ai/dsh-agent-preset` | 新增，`0.2.1-alpha.2` | 声明 SideChat preset |
| `@deepseek-ai/dsh-client-ui-workspace` | 新增，`0.2.1-alpha.2` | 客户端导航服务 |
| `@deepseek-ai/cordis` | `4.0.5-alpha.1` | 独立 vendor 版本 |
| `@deepseek-ai/schemastery` | `3.18.5-alpha.1` | 独立 vendor 版本 |
| workflow provider | `@deepseek-ai/dsh-workflow-ptc` | 替换不存在的 worker-thread 包；preset 使用的包也要有明确解析来源 |

保留现有 DSH 包中已核对仍可用的依赖，不按字符串前缀统一套用同一版本。客户端补充 `@deepseek-ai/dsh-api-session-controller/client` 的服务类型导入；如实现采用当前目录服务，再显式声明 `@deepseek-ai/dsh-working-directory` 的直接类型/运行依赖。

仓库 `.npmrc` 关闭自动安装 peers。因此“写进 peerDependencies”不等于开发和契约检查时已经有真实包。应分别规定：消费者 Host 提供哪些 peer，preset 插件由哪个 manifest 解析，真实类型 fixture 安装哪些包。以 tarball 安装测试确认；禁止依靠相邻 checkout 或本机偶然存在的 node_modules。

alpha.2 源码根目录要求 `pnpm@11.28.5`，高于本机上次检查的 `11.19.0`；源码 build 要按上游 packageManager 准备对应工具。插件自己的 pnpm 范围和 Node 要求可继续单独管理。

### 5.2 声明式 preset

当前 `cordis.patch.yml` 重写 `agent-presets` 行并注入 `sidechatPresetRoot`，新版不能继续采用。改为插入一个 `dsh-agent-preset` 声明，不覆盖 Host 的默认 preset registry 配置。保留 `sidechat-clarifier` 这个 ID；把原 `preset.yml` 的 name、description、order 和 `agent.cordis.yml` 的插件列表迁入声明。

以下仅说明目标结构，省略了完整插件列表，不能直接作为可运行 patch：

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
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: <现有 SideChat persona 正文>
          # 迁移后的工具与隔离 group
```

迁移插件列表时：

- persona 的旧 `text` 改为必填 `prefix`；需要 suffix 时另行配置，保留不可信背景与只读约束。
- 维持 Windows 的 pwsh 与其他平台的 bash 条件启用。
- 保留 planMode/workflowEngine 的隔离意图，核验跨 group 服务是否可达。
- 两个 subagent 行删除 `backgroundMode: continuable`；保留仍受支持的 provider、toolName 与模型配置。
- workflow 行换为 `dsh-workflow-ptc`，实际加载时必须具备新版四项服务依赖。
- 不为补齐初始化而默认加载所有工具；工具集合仍受父能力上限限制。

### 5.3 清理旧入口

默认方案是删除 `src/preset-root.ts` 及其 build/export/smoke 必需项。若要暂留 `/preset-root` 导出，只能作为明确标记的过渡兼容入口，新 preset 注册不得继续依赖它。

更新 `package.json.files`、`exports`、tsdown Host entry、tsconfig files 和 manifest smoke。若原 preset 文件保留用于 include，必须随包交付，并验证相对路径从安装后的包内解析；不能引用开发机绝对路径。

验收：干净安装后的 composed config 只有一个 SideChat preset 声明；registry 能列出它且无 broken 诊断；卸载后不残留旧 roots 覆盖。

证据：[registry](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/src/index.ts)、[声明插件](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset/src/index.ts)、[标准 preset](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/bundle/web-app/presets/standard.patch.yml)。

## 6. Host：V4 消息来源与历史读取

### 6.1 统一 source

当前 `src/service.ts` 约 1043、1070、1214、1313、1324、1470 行构造旧 plugin wrapper，分别涉及首问、task/summary 生成、Fold 生成/重写和父消息回写。全部改为同一个 SideChat 生产者 kind。

建议采用 `plugin:dsh-sidechat`：这与旧消息迁移后的身份一致，能减少历史分支。按照上游生产者用法，在 `@deepseek-ai/dsh-llm` 的 `MessageSourceMap` 中声明合并；source 类型与 `ContextFormed` 组合，保持 notice 必须有 summary、snapshot 必须有 sections 的约束。

新增集中构造函数，统一处理 `boundContextSummary`。禁止继续写 `kind: 'plugin'` 或旧 `plugin` 字段；正文中的既有 Fold/Cite/撤回 marker 保持不变。轨迹读取器同步更新生产者识别。

source kind 与 Session event type 是不同层次：继续向 Session 写普通 `user/message`，无需新增 `sidechat/*` 或实验性 plugin record。

验收包括六个写入入口都通过 V4 校验、消息保存后冷读取成功、旧迁移消息可识别、普通用户粘贴类似 marker 不会被误识别为本插件已交付消息。

### 6.2 读取完整日志与读取 surface 分工

`agent.session.events` 已不存在。需要正文时，集中使用 `sessionQuery.readSession()` 或拥有明确释放责任的 `observeSession()`；只需要当前尾部位置时使用 `session.seq`。不新增 `snapshotEvents()`、`eventAt()`、`ownEvents()` 调用，这些同步读取已经弃用。

| 使用位置 | 应采用的数据 |
|---|---|
| 普通 Seed 候选 | surface 中直接 user/assistant 文本，保留现有“不复制工具与 reasoning”规则 |
| 轨迹与原文详情 | 完整 raw log，保留被压缩替换的原事件 |
| Fold 生成结果、pointer 校验 | 对应子会话的精确日志快照，配合生成边界和稳定 message ID |
| Fold/Cite/撤回 marker | 父会话 raw log；不能只读可能已隐藏历史消息的 surface |
| Session 基本身份 | 创建 header 与同一次检查中的继承元数据 |
| UI 列表提示 | 可使用缓存提示；不得据此作权限、精确坐标和事务决定 |

`observeSession()` 返回 caller-owned lease，成功、异常和取消路径均须释放。对纯读取函数使用 `readonly` 参数；不要依赖 observation 的数组可变。`readSession()` 的 detached snapshot 与 observation 并非所有地方都声明为同一种数组类型，应按实际导出类型检查。

### 6.3 明确 seq 的半开边界

新版 `session.seq` 是 **下一事件的位置，也就是 log length**。日志有 n 条事件时，已有 seq 为 `0…n-1`，尾部 offset 为 n。当前插件的 `baselineSeq` 和 `previewThroughSeq` 按最后一条已有事件的包含式位置使用；二者不能直接替换成 `session.seq`。

本轮建议新记录使用排他 offset：

| 含义 | 新字段建议 | 比较方式 |
|---|---|---|
| 生成前边界 | `baselineNextSeq` | 新生成事件满足 `event.seq >= baselineNextSeq` |
| 预览包含的尾部 | `previewNextSeq` | 当前 next offset `> previewNextSeq` 才算预览后有新事件 |
| 已冻结的历史来源 | 保留原 seq 与 format/projection 元数据 | 只作该代际来源，不直接当作当前定位 |

例：生成前 n=10，新 assistant 恰好位于 seq=10，必须被读取；不得沿用 `seq > 10`。空日志 offset=0，不用“最后一个 seq=0”的哨兵冒充已有事件。已有持久字段不原地改语义，按第 10 节兼容处理。

### 6.4 普通会话和工作目录

替换 `seedLength` 判定，要求 child `header.isSeeded === false`、没有 `parentSession`、没有 subagent origin，并核对独立 `inheritedEventCount === 0`。继承长度不属于新版 header 的同名字段。

关系校验继续使用创建时 `createdAt` / `header.cwd` 等稳定身份。alpha.2 的当前执行目录由 workingDirectory 服务管理；目录变化不能使 SideChat 变成 orphaned，也不能改变已冻结 provenance。

本轮可保留“child 使用父创建项目目录”的现有行为。若要改成继承父当前执行目录，应单独定义并测试跨目录 Cite/工作区判断；读取已提交目录可用 `workingDirectory.get(session)`。不要为读取目录直接调用可能追加恢复事件的 `ensure()`，从而违反创建不推进父日志的要求。两种目录语义不得在同一字段中混用。

证据：[Session 与 offset](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts)、[消息来源](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/message.ts)、[query](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query/src/index.ts)、[当前目录服务](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/working-directory/src/index.ts)。

## 7. 权限：先恢复限制，再允许运行

### 7.1 区分实际能力与 PTC 展示入口

父权限快照继续从 `tools.schemas(parentAgent)` 取得，再去掉保留的 PTC transport `run_code`，得到可限制的终端能力集合。不要从模型请求最终暴露的 transport schema 反推父权限：PTC 模式下模型看到的入口不等于运行时实际可调用的全部能力。

新版 `tools.restrict()` 明确拒绝把 `run_code` 放进 allow 或 deny。当前继承模式直接保存 schemas 的 name，在 PTC 下可能因此抛错；而当前 `ensurePermission()` 捕获异常、记录警告并清理 disposer，不能保证失败后仍有限制。这是发布阻断项。

需要调整：

1. 创建与恢复都规范化能力集合，移除 `run_code`，保留父快照的上限；不在恢复时重新取得更大的父工具集合。
2. 只读模式仍取“只读候选能力 ∩ 父实际能力”，同时安装 sandbox 与 approval 限制。提示词不能替代执行约束。
3. 在 `agent.ctx` 的作用域安装限制。新版 restrict 对继承层生效，同一层直接注册的工具具有例外；必须按真实 preset 挂载层次验证，不能只看 allow 列表判断所有工具已经被覆盖。
4. 必要时补充 scoped `tools.guard()`，对超出持久快照的实际执行拒绝放行；需覆盖原生调用、PTC 调用及 subagent/workflow 入口。
5. 安装失败时阻止创建后的首问、恢复后的 followup 与其他运行入口；或者维持有效的阻断 guard，直到限制全部安装成功。不能继续执行并只给 warning。
6. HMR、dispose 和重复 resume 不得出现“旧限制已卸载，新限制还未安装”的运行窗口；同一 Agent 不累积重复 guard，不把限制挂到全局误伤其他会话。

如果某个能力只在子 preset 中存在，且不属于父快照，应被排除。子代理启动后的实际 sandbox/approval 是否继承，需要真实调用验证；不能因为父级启动工具可见，就推断内部执行已只读。

### 7.2 persona 与系统提示

当前手工追加的 `deployment:persona` section 要迁移到新版 `PERSONA_PREFIX_SECTION`，顺序通过 `getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')` 取得。需要后缀时使用独立 suffix section，不把两个 section 当作同一位置。

验收应包含：native 与 ptc 下相同的父能力上限；PTC 允许合法的受限读操作，但不能通过 `run_code` 间接绕过限制；安装异常、冷恢复、空能力集合、不同 preset 层次和重复 resume。旧记录没有足够权限证据时，应阻止继续执行并给出可操作提示，不默认为完整继承。

证据：[限制、guard 与 schemas](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/tools/src/index.ts)、[persona section](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/persona/src/index.ts)。

## 8. Fold、Cite 与撤回：保留可靠交付

### 8.1 追加事务的统一顺序

三类交付都采用以下流程；这描述逻辑顺序，不要求把跨 Session 操作做成单一数据库事务：

1. 生成并保存 pending 操作，冻结 operation ID、目标身份、payload 与 marker。
2. 等待目标 Agent idle，进入 `runMaintenance()`。
3. 在 maintenance 内重新确认目标身份，并异步读取精确 raw log。
4. 检查同一生产者、同一操作和同一目标的交付是否已经存在；已有匹配消息时走恢复分支。
5. 检查追加压力；允许追加时写普通 `user/message`，等待 Session flush 成功。
6. 最后提交 storageDomain 中的 committed 状态与稳定消息定位信息。

父会话的追加路径不得调用 followup 或其他启动模型 turn 的接口。Fold 的子会话生成与改写仍可运行模型；“无回复”只约束向父会话交付的阶段。

当前 Fold 会把 marker 传给安全追加函数，但 Cite 与撤回只在进入该函数前检查 marker。应使三类操作都在 maintenance 内复核 marker，避免两个并发/恢复操作在外部检查后重复追加。异步历史读取会放大这种间隙，不能保留只在外部查重的实现。

当前 `containsMarker()` 对任意 user/message 做正文 includes 判断，证据过弱。应核对 SideChat source、完整 marker/operation ID、目标关系，以及可用的稳定消息 ID；用户手工粘贴 marker 不应冒充插件交付成功。旧格式迁移后的 source 需要显式支持，不能笼统信任所有 plugin 来源。

### 8.2 压缩服务和重入

新版标准 preset 的 compaction 可能处于隔离挂载作用域。应通过该 Agent 对应的 `agentPresets.serviceFor(agent, 'compaction')` 等已核验解析方式取得服务，不只读取 `agent.ctx.compaction` 并据此断言不存在。`compactNow()` 的基本调用能力仍可用；按实际导出签名传参。

压力过高时应退出当前 maintenance，执行压缩，再重新等待 idle、获取 maintenance、核验身份和 marker、测量压力。不能在持有 maintenance 的回调里递归等待同一个维护边界，也不能压缩后直接用旧压力值追加。

没有 compaction 后端、压缩失败或压力仍超标时，保留可解释的失败/待恢复状态，不提交 committed，不静默丢弃 payload。会话身份被替换、服务正在退出或 abort 时同样遵守这一规则。

### 8.3 崩溃与 flush 失败

| 中断点 | 恢复要求 |
|---|---|
| pending 已保存，尚未 append | 校验目标后追加一次 |
| append 已发生，flush 未确认 | 不立即标 committed；核验已持久化状态并完成保存，不能仅凭内存中有 marker 就宣称落盘 |
| flush 成功，storageDomain 尚未 committed | 从真实消息识别同一交付，只补状态，不重复写消息 |
| committed 已保存 | 保留历史，不自动再次交付 |
| 撤回通知已写入，revision 状态尚未更新 | 按撤回 operation ID 恢复状态，不写第二条通知 |

以上恢复还要覆盖 child 或 parent 不存在、跨会话 Cite 目标变化、同一操作重试两次、维护期间切换状态，以及服务停止。错误消息应区分“尚未交付”“交付可能发生，等待核验”“交付已确认”；具体文案与现有 RPC 错误结构保持一致。

证据：[preset 服务解析说明](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/README.zh.md)、[Agent maintenance 契约](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent/src/runtime-types.ts)。恢复顺序和 marker 加固是针对当前插件实现提出的改动要求。

## 9. Client 与轨迹

### 9.1 导航与命令

`ctx.sessions.open()` 已移除。统一导航回调改用 `ctx.uiWorkspace.openSession()`，并同时完成三处声明：`package.json.dsh.client.inject`、Client 的 runtime inject、`@deepseek-ai/dsh-client-ui-workspace` 类型导入。会话服务的类型由 `@deepseek-ai/dsh-api-session-controller/client` 提供；`sessions.refresh()` 等仍存在的能力不必重写。

创建成功、返回父会话、恢复、Fold 后跳转和组件内会话链接均应使用同一更新后的回调。验证普通 Session ID 符合 SessionTarget，不把旧 open 参数原样强转成 any。Header 与 conversation view 的 slots 注册能力仍存在，可保留现有组件架构。

16 个命令（含轨迹提问命令）的 `description` 改为 `() => string`。更新测试中的 `TestCommand`，实际调用 description 回调，而不是仅断言注册成功；需要本地化的描述补到现有词条，不在此补丁顺带扩大全部 UI 翻译范围。

验收包括命令菜单打开时不抛错、命令描述可正常渲染、创建/返回/恢复导航正确、会话列表可刷新，以及原生模型选择器与 SideChat view 共存。

证据：[workspace Client](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/ui-workspace/src/index.ts)、[sessions Client 契约](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/client/contract/sessions.ts)、[命令 UI](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/ui-commands/src/index.ts)。

### 9.2 V4 结果解析与状态

| 事件/数据 | 更新要求 | 发布范围 |
|---|---|---|
| `tool/result.data.message` | 按 tool-role message 读取 `content`、`isError` 和 `source.callId`；不能只找旧 tool-result 内容块 | 必须 |
| 旧 tool-result 包装 | 仅在旧 fixture/旧迁移证据需要时保留明确兼容分支；新格式优先 | 必须 |
| 压缩 replace | 保留原执行详情，replacement 不作为第二次调用或第二份 usage | 必须 |
| `assistant/attempt` | 核对嵌入 stream 的失败、重试、取消；不把未投影节点推断为成功 | 状态正确必须；完整 UI 可分批 |
| `tool/ptc-dispatch-start` / `tool/ptc-dispatch` | 明确 PTC 内部调用如何配对及展示；不与外层 run_code 重复计数 | 正确处理必须；展开 UI 可分批 |
| alpha.2 dispatch `meta` | 保留为展示元数据，验证结构后使用；不当成模型正文或执行结果 | 使用时必须 |
| subagent activation | `{ kind: 'activation', subagentId }` 只表示启动接受；最终结果以真实交付为准 | 必须避免误报完成 |

`subagent/start`、`subagent/end` 等运行时生命周期通知不能未经核对就当成已持久化 SessionEvent。轨迹要从实际保存的日志 fixture 决定如何关联后续完成消息；不能虚构子代理内部步骤，也不能只靠工具名包含 subagent 判断关联。

当前按 `task|agent|subagent` 精确匹配的识别逻辑会漏掉 `subagent_fork` 和可配置 toolName。应优先采用可靠的 source/结果身份或配置映射；若采用别名集合，写明覆盖范围，避免把无关同名工具误识别为子代理。

usage 继续使用上游真实 `deriveTurnTokenUsage` 等 helper；需要核对 attempt 内的 stream 用量。真实 helper 未运行的 shim 断言不能证明兼容。精确值与 estimated 值保留区分，缺少用量证据时显示未知，不补造精确数字。

如果本轮不实现全部新节点的展开视图，发布说明应列出未覆盖项，并测试这些节点不会造成失败显示为成功、最终答案错配、重复计数或来源错误。不能以“后续扩展”为由跳过 V4 基本结果解析。

证据：[Session 事件类型](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/types.ts)、[tool-role 消息](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/message.ts)、[subagent activation 实现](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/subagent/tool-subagent/src/index.ts)。

> 实施状态：第 9 节已实施——`uiWorkspace.openSession` 三处声明齐全、16 个命令 description 回调进 locale、V4 tool/result 解析（新格式优先+旧包装兼容分支）、PTC `subCallId` 配对、activation 不误报完成、usage 真实 helper（含 fixture 实测）。attempt 展开视图与 PTC/子代理展开深化属 P2 未做；详见实施报告 §"未完成项"。

## 10. 旧 storageDomain 记录迁移与恢复

### 10.1 记录版本与日志代际分开

当前 SideChat domain version 为 1，记录 schema 也使用 literal 1。它们与 DSH Session log format 是不同版本轴。上游能迁移自己的日志，但不知道本插件保存的 seq、Fold pointer 和投影缓存；上游迁移成功不代表 SideChat 的定位自动有效。

建议采用以下实施方案：

- 新记录 schema 设为 2；读取 schema 接受 legacy v1 与 v2，并集中规范化。新建记录写 v2，旧记录在明确操作路径中转换并保存。
- 初期保持 storageDomain 的 domain version 为 1，除非另有经过验证的 domain 迁移实现。单纯提高 domain version 不能替代记录转换；不得借此重置已有 chats。
- v2 保存 Session log format、插件投影版本、排他 offset 和可用的稳定 message/event 锚点。字段名与枚举需在实现时定稿，不能只改旧 `baselineSeq` 的含义。
- 已冻结 Seed 的文本、来源与旧坐标作为历史证据保留；增加代际说明，不用当前日志的 seq 覆盖旧 provenance。
- projectionVersion 用于判断缓存是否需重新投影。相同 log format 不保证插件投影规则相同；缓存失效应重算展示数据，不能改写历史交付正文。

旧记录没有 log format 元数据，不能一律标成 V4。V1→V2 的合并/重排、V2→V3 的系统事件变化、V3→V4 的终止事件修复，都可能使包含式 seq 不再对应同一条消息。仅做 `oldSeq + 1` 无法证明安全；只有能确认同一日志代际时才可作数值边界转换。

### 10.2 按状态处理，不自动重放全部操作

| 旧记录状态/内容 | 恢复策略 |
|---|---|
| Seed、普通关系、生命周期状态 | 保留既有文本、ID、身份和时间；读取后重新校验 parent/child 是否仍为同一 Session |
| Fold generating | 进程已结束则不假装生成仍在运行；清晰标为失败或需要重新生成，不在迁移后台静默调用模型 |
| Fold prepared，pointer/边界代际未知 | 保留预览正文供查看；阻止基于不可靠边界的直接提交，要求重新生成或重新预览并建立新锚点 |
| Fold/Cite pending，已冻结正文和 marker | 核验目标身份；查找真实交付，匹配时补状态，未交付时按原 payload 交付一次；不依赖失效 seq 盲找答案 |
| Fold/Cite committed | 保留正式历史；消息找不到时呈现定位不可确认，不自动再次回写 |
| superseded / withdrawn revision | 保留 revision 链和撤回历史；不恢复成 current，不删除旧结论 |
| pending withdrawal | 按独立撤回 marker 恢复一次，不能把 Fold marker 当撤回已完成 |
| orphaned / parent 或 child 缺失 | 保留记录供查看，按现有 orphaned 规则阻止不安全回写；不自动删除 |
| 旧权限快照含 run_code | 移除 transport，保留原终端能力上限；限制重装成功后才允许继续 |
| 无法识别的 schema/损坏记录 | 保留原数据并返回可诊断错误，不能当作空列表覆盖保存 |

可用现有失败状态加原因表达“需重新预览”；若引入新状态，还需更新 Zod、RPC、Client 与列表状态穷举。不要只在一处返回未声明的新字符串。

既有 marker 需要同时校验 source 和业务身份。涉及正式引用的迁移不得只用文本相似度或“最近 assistant”猜测原文；拿不到稳定证据就要求用户重新选择。

### 10.3 验证用的旧数据样本

至少保存脱敏 fixture：v1 空列表、active 普通 SideChat、不同 Seed、prepared Fold、pending Fold、committed Fold、多 revision、pending/committed Cite、pending withdrawal、orphaned、run_code 权限快照和未知 schema。另提供“日志被 DSH 迁移、插件记录尚未转换”的组合。

迁移执行两次应得到同样的业务结果；冷重启后结果应一致。检查不只比较 JSON shape，还应验证父日志的追加次数、正文和 marker、旧 history/provenance 未丢失，以及不可靠 pointer 被阻止使用。

## 11. 类型、构建与契约检查

当前本地 facade 和 Vitest alias 会掩盖上游改动：更新 `types/dsh-compat.d.ts` 或让 shim 增加一个方法，并不能证明 alpha.2 真有该接口。需要同时保留快速独立测试与真实 Host 契约检查。

| 检查层 | 负责证明 | 不能单独证明 |
|---|---|---|
| 本地 typecheck / unit | 插件内部类型和业务逻辑一致 | 真正的 Host 导出、运行顺序、DI 作用域 |
| 真实导出类型 fixture | 使用目标版本的实际 packages，编译插件使用的 API；不加载本地 facade/alias | Web 加载与保存后恢复 |
| manifest / tarball smoke | 导出、资源、preset、client inject 和安装解析完整 | 模型流程及权限语义 |
| 真实 DSH 集成 | 插件在目标 Host 加载、注册、执行和恢复 | 尚未运行的模型/压力路径 |

实施要求：

1. 将 `verify-dsh-contracts.mjs` 中按所有 `@deepseek-ai/*` 统一比较版本的规则改为包名/包族映射，正确识别 vendor 版本与新增包。
2. 新增真实导出类型检查入口，固定 alpha.2 及 vendor 版本。至少覆盖 source 扩展、SessionQuery、header/offset、preset 服务、tools restrict/guard、uiWorkspace 与命令描述。
3. fixture 必须检查实际插件适配代码或共享的契约模块；不能只是自己声明一组相似接口后检查自己。
4. 更新 Host/Client shims，使失效接口不再可用。例如删除虚构的 session.events、sessions.open，description 必须实际调用；PTC restrict 模拟 reserved transport 校验。
5. 源码字符串搜索可作为辅助告警，不能作为真实类型和行为检查的替代。不要用 any、强制断言或空模块声明绕过关键错误。
6. 更新 manifest smoke 对旧 preset-root 的断言，以及 portable 检查中新 fixture 的路径规则；发布产物不得包含本机绝对路径、相邻 DSH checkout 依赖、隔离 home、token、日志或测试 runtime。

独立 clone/build 能力继续保留。若真实类型检查需要单独安装较大的 Host fixture，应在脚本与 CI 中明确入口和安装步骤，不让普通 build 暗中读取 `D:\Developing\deepseek-harness`。

> 实施状态：第 11 节已实施——`check:plugin-alpha2` 已加入 `pnpm verify` 门槛链，并以 Host / Client 两个真实导出工程覆盖全部 Host 与 Client 源码（Client 为独立程序，避免宿主 `dsh-session` 与客户端 `api-session-controller` 对 `ctx.sessions` 的全局增强合并冲突这一建模伪差）；shims/facade 中 `sessions.open` 与字符串 `description` 已不可用；manifest/portable 断言已按新事实更新。

## 12. 验收矩阵

**下表全部为待实施/待验收项目；本文没有把现有测试运行结果当作新版通过证据。** 测试文件列出当前最接近的覆盖位置，新用例可按职责拆分。

| 场景 | 必须观察到的结果 | 现有测试位置/新增检查 |
|---|---|---|
| 精确版本与干净安装 | alpha.2、正确 vendor 版本；tarball 可独立安装，无相邻源码依赖 | contracts、portable、manifest + 真实 Host |
| preset 注册 | registry 列出唯一 sidechat-clarifier；无 broken，四项 workflow 注入满足 | manifest + composed config |
| Client 启动 | 模块可加载、菜单描述可调用、view/Header 与原生 UI 共存 | commands.client、components.client + 浏览器 |
| 导航 | 创建进入 child、返回 parent、恢复后打开正确 Session | client-api.client、components.client |
| 普通 Session | 非 seeded/非 subagent；无父继承事件，重启仍可读 | task-create.host、remote-readiness.host |
| Seed | 各策略只取允许文本；预算和冻结 provenance 不变；创建不推进父日志 | task-seed.host、seed.unit |
| V4 source | 六个入口的消息可校验、flush、冷读取 | 新真实 Session fixture/Host 检查 |
| seq 边界 | 空日志、第一条新回复、预览后恰好一条新事件、压缩后定位均正确 | fold.unit、revision-fence.host |
| native 权限 | 父外能力被拒绝；只读 sandbox/approval 有效 | 新真实权限 Host 用例 |
| ptc 权限 | 不把 run_code 传入 restrict；终端能力和子调用不能越过快照 | 新真实 PTC Host 用例 |
| 权限异常/冷恢复 | 首问与恢复运行被阻止或保持阻断 guard；不静默变宽 | 新权限恢复用例 |
| Fold 生成/改写/提交 | 正确定位子回复；结构化预览和 revision 保留；父只追加不运行模型 | fold.unit、revision.unit + 真实模型/受控 provider |
| Cite | 引用指定 assistant 原文；无额外父 turn；失效定位不得猜测 | read.unit、safe-boundary.host |
| 压力压缩 | 正确解析 preset 服务；退出维护后压缩，再入维护复核压力和身份 | fold-pressure.host |
| 并发和停止 | idle/maintenance 顺序正确；状态变化或退出不写错会话 | safe-boundary.host、revision-fence.host |
| 三类交付幂等 | Fold/Cite/撤回均在边界内查重；普通用户 marker 不误判 | transactions.unit + 崩溃恢复 fixture |
| 旧记录 | v1→v2 可重复；无丢失/重复写入；不可靠 pointer 被阻止 | 新 record-compat 用例、relations.unit |
| V4 轨迹 | tool-role 错误、callId、attempt、PTC 与 activation 不产生错误结论 | trajectory.unit、trajectory-execution.acceptance、trajectory-panel.client |
| usage | 真实 helper 处理 attempt；精确/估算/未知区分；replace 不双计 | usage.unit + 真实 helper fixture |
| archive/restore/abandon/orphaned | 生命周期和只读历史保留；恢复先装权限 | relations.unit、remote-readiness.host |
| 打包/重启/卸载 | tarball 装入 Web；重启后关系与 pending 可恢复；卸载后普通 Session 可读 | 真实 Host 手工/集成检查 |

“真实 Host”不要求每项都消耗在线模型。注册、导航、Session 保存、限制与无回复交付可使用受控 provider 或无模型场景。真实 Fold 生成和改写如需实际 API 配置，应单独记录 provider、模型及结果，不把未执行写成通过，也不把凭证写入报告。

浏览器验收至少记录：Host 版本/提交、插件版本/commit、工具 mode、安装方式、配置差异、操作步骤和结果。Web 启动 token 应脱敏；截图或日志只能作为对应场景证据。

## 13. 实施批次与合入门槛

建议分为五批，依次实施；无需先把全部界面推倒重写。以下是交付拆分，不是已创建的分支或 PR。

| 批次 | 主要产物 | 进入下一批前的门槛 |
|---|---|---|
| A：目标环境与组装 | alpha.2 隔离 runtime、依赖/锁文件、声明式 preset、旧入口清理、真实类型入口 | Web 能加载插件与 preset；版本/注入/解析无错误；尚未具备权限门槛前不开放真实 SideChat 运行 |
| B：Host 与权限 | source、日志读取、offset、新 header、限制/guard、persona、compaction 服务解析 | 普通创建、Seed、native/PTC 权限及失败阻断通过 |
| C：数据与交付 | record v2/legacy reader、三类 marker 复核、flush 恢复、旧 pointer 失效处理 | pending/committed/revision/withdrawal 冷恢复无重复、无丢失，父模型不被启动 |
| D：Client 与轨迹 | 导航、描述、V4 结果、usage；明确 attempt/PTC 展开范围 | Client 回归与 V4 fixture 通过，实际 Web 操作无报错 |
| E：独立安装与发布 | 完整验证、tarball、迁移/回滚演练、README/测试报告 | 第 15 节发布门槛全部满足 |

A/B/C 存在交叉点，例如新记录需要新坐标、真实 smoke 需要新 source。可在同一工作分支实现后按职责提交，但发布时必须整体达到门槛；不要发布只有依赖升级而权限/交付尚未完成的中间版本。

当前不承诺工期。最需要实测的工作量来自真实 Host 类型接入、preset 作用域、PTC 权限及旧记录恢复；先做 A/B 的小范围验证，再依据结果拆分剩余工作。

## 14. 本地环境与复现步骤

### 14.1 当前已经具备的环境

| 项目 | 状态与边界 |
|---|---|
| 长期源码 | `D:\Developing\deepseek-harness` 已存在；工作区是 alpha.1，origin/master 已取得 alpha.2 |
| 安装前系统检查 | 当时未发现 PATH/global npm/default npx 缓存中的 dsh、默认 .dsh、DSH 进程或默认 3080 listener；这是当次检查结果，不代表未来系统状态 |
| alpha.1 runtime | `.smoke-dsh-0.2/runtime` 本地安装；CLI wrapper 为 `.smoke-dsh-0.2/dsh.ps1`，不注册全局命令 |
| 隔离数据 | `.smoke-dsh-0.2/home`、npm cache 和测试 workspace；不使用默认用户 home |
| 已完成 smoke | alpha.1 CLI、Web 启动、bootstrap 303、首页 200、module-loader/entry JS 200；未安装 SideChat 验证兼容 |
| alpha.2 | 已核对源码与 npm 元数据；尚未另行安装、构建或运行 smoke |
| 运行成本 | 先前 smoke 未填 API key、未运行模型；结束后已清理所启动的 DSH 进程 |

现有 wrapper 和 `smoke.mjs` 明确属于 alpha.1，不能换一个报告标题就当作 alpha.2 结果。ignored 目录中的源码摘录仅帮助本次核对，不是构建依赖，也不应打入发布包。

### 14.2 实施时的准备顺序

1. 固定上述目标提交并确认长期源码的实际 checkout；当前 checkout 尚未切到 alpha.2。fetch 使用了浅历史，不能假定两个浅提交之间已具备可 fast-forward 的完整祖先关系。保留任何本地修改后再选择 checkout/独立 worktree 方式。
2. 在新的 ignored 隔离目录中安装精确 `@deepseek-ai/dsh@0.2.1-alpha.2`，保留 alpha.1 环境用于对照；分别记录 lockfile、Node/npm 版本、native addon 构建情况和最终 CLI version。
3. alpha.2 使用独立 `DSH_HOME`、测试 workspace 和未占用的回环端口。PowerShell wrapper 应在 finally 中恢复调用前环境；启动的后台进程应有确定的清理方式。
4. 如从上游源码构建，先按上游 packageManager 准备 pnpm 11.28.5。安装 npm 发布包与构建整个上游仓库是两条不同路径；前者足以开展大量插件兼容验证。
5. 先不装 SideChat 跑原生 Host smoke，再安装已构建插件 tarball，检查 composed config、模块加载和真实操作。这样能定位错误来自 Host 环境还是插件适配。
6. 旧数据恢复演练使用副本；不要让两个不同版本的进程同时打开同一测试 home。

安装过程中若需要批准 native addon build，核对本次精确依赖后决定。先前 alpha.1 的 node-pty/koffi 批准记录不能自动证明 alpha.2 安装时所有脚本都相同。

### 14.3 适配完成后的验证命令

以下命令是实施完成后的检查入口，**本次文档工作没有执行它们来宣称 alpha.2 兼容**。当前契约脚本仍固定旧版本，必须先按第 11 节更新。

```powershell
# 在插件仓库中，完成代码和锁文件更新之后
pnpm install --frozen-lockfile
pnpm verify

# 还需执行新增的真实类型/Host 检查入口，脚本名在实施时定稿
# 通过后生成并检查发布包
npm pack --dry-run --json
npm pack --json
```

在隔离 alpha.2 的 CLI wrapper 环境中，按 `npm pack` 实际返回的 tgz 路径安装：

```powershell
# dsh 必须实际解析为隔离 alpha.2 CLI；先核对 dsh --version 和 DSH_HOME
dsh plugin --profile web add <本次生成的插件tgz绝对路径> --force
dsh --profile web --dump-config
dsh --profile web
```

占位符需替换为真实值。安装到源码目录只适合开发反馈，最终必须再测 tarball。`--dump-config` 应看到声明式 preset 与 sidechat 服务，不能再把旧 `sidechat-preset-root` 的存在作为成功标准。

## 15. 发布、备份与回滚

### 15.1 发布门槛

- 所有 P0/P1 适用场景通过，未覆盖的新轨迹展开能力明确写入范围；无权限失败后继续运行的路径。
- 真实目标 alpha.2 的安装、Client、普通创建、权限、V4 消息、Fold/Cite/撤回和重启恢复都有证据。
- 旧数据 fixture 与实际数据副本演练通过；原 provenance、committed history、revision 链保留，pending 不重复交付。
- 完整 verify、真实导出类型检查、独立 tarball 安装通过；没有依靠 facade/shim 掩盖的目标 API 差异。
- npm 包文件列表检查通过，不含测试 home、日志、token、临时快照或本机路径；对已有 `docs/**` 打包规则检查文档内容。
- README 中的支持版本、安装与 dump-config 说明更新；测试报告区分源码核对、受控测试与实际模型操作。
- 插件新版本号与 peer 范围按已验证范围确定，不擅自声明兼容所有 `0.2.x` 或旧 Host。

### 15.2 备份与恢复边界

升级前停止相关 DSH 进程，确认没有写入者，再一致备份 DSH Session 数据、SideChat storageDomain 数据、profile/配置和运行版本信息。备份应保留原样，并先验证副本能够读取。只备份插件 JSON，无法保证它保存的坐标仍与 Session 日志一致。

上游日志迁到 V4 后，不能把同一 home 直接交给旧 DSH 并认为降级安全。恢复方案应是**匹配的 Host、插件和升级前完整数据副本**；新旧 home 分开，避免并行写入。若没有完整备份，应优先在新版修复或导出数据，而不是盲目 npm 降级。

升级后产生的新对话/交付不会自动出现在升级前备份中。回滚演练要明确这部分如何保留或导出；未设计双向合并时，不承诺无损逆向迁移。卸载插件可保留普通 Session，但旧 Host 是否能读新版日志是另一个问题。

## 16. 尚待实测的结论与文档维护

源码已经确认的硬性改动包括：包名/版本与 preset 声明、V4 source、异步日志读取与 offset、uiWorkspace 导航、命令描述回调、V4 tool-role 结果，以及 alpha.2 的 tools mode / workflow 注入 / subagent 配置变化。

以下内容必须在实施时进一步证明，本文未将其写成通过结果：

1. 插件声明式 preset 在实际安装包中的完整解析来源、隔离 group 与各服务可达性。
2. native/PTC 下 restriction、guard、sandbox、approval 和子任务的实际权限边界，以及冷恢复入口顺序。
3. 异步精确日志读取与 maintenance/压缩组合，在并发和关闭时的行为。
4. 旧记录中哪些 pointer 能凭稳定锚点保留，哪些必须重新预览；以及实际迁移日志后的交付恢复。
5. activation、attempt、PTC dispatch 在真实持久日志中的组合与 usage，不能只由运行时接口推断。
6. alpha.2 原生 Web smoke、安装 SideChat 后的集成测试、实际模型 Fold 生成与发布包重启测试。

每完成一批，在独立测试报告中补充运行命令、精确版本、fixture/操作场景和结果，并在本文件标记相应需求已实现的 commit。保留本文目标提交作为历史证据；若目标升级，新增差异记录，不把尚未验证的新版本自动计入“已支持”。
