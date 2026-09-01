# DeepSeek Harness SideChat

为 DeepSeek Harness 提供普通、持久化、可恢复的 SideChat 澄清会话。

SideChat 不是临时浮层，也不是 subagent 或 fork。每个 SideChat 都是一个正常的 DSH Session：拥有完整会话页面、原生模型选择器、多轮对话和持久化 transcript；即使卸载插件，历史 Session 仍能作为普通会话读取。

当前版本：`0.3.4`  
已核验 DSH 基线：`0.1.2-alpha.1`，提交 `cd5ef81481`

## 主要能力

- 在任意 Session 中使用 `/side` 创建独立 SideChat，并自动进入新会话；
- 默认使用最近一条直接 user/assistant 文本作为最小 Seed；
- 支持 `tail:1`、`task`、`none`、`tail:2`、`tail:4`、`pick:1`、`pick:many`、`turn`、`selection` 和 `summary` Seed；
- Seed 只保存直接文本，不复制 reasoning、工具调用、工具结果或完整父 transcript；
- Seed 内容与来源消息保存为不可变 provenance；
- 可选择“只读模式”或“继承”权限；
- 父 Session 中提供与“对话”“轨迹”并列的“子会话”视图；
- SideChat 使用完整 DSH Session 页面，可恢复并继续多轮对话；
- 支持模型生成、预览、编辑和提交结构化 Fold；
- 支持 revision、增量 Fold、对比和软撤回；
- 支持把指定 assistant 回复无回复引用到父会话；
- 支持 archive、restore、abandon 和 orphaned 状态；
- `/sideusage` 展示可验证的 token 用量，不用估算值冒充精确值；
- 创建、Fold、Cite 和生命周期操作均通过 slash 命令完成，Header 只保留身份与父会话导航。

## 权限模式

创建 SideChat 时，在 Seed 策略之后选择权限模式。

| 模式 | 行为 |
|---|---|
| 只读模式（推荐） | 候选能力为 `read`、`glob`、`grep`、Shell、Web、Plan、用户提问、子代理和 workflow；最终工具是候选集合与父会话实际可见工具的交集。沙箱固定为 `read-only`，审批固定为 `never`。 |
| 继承 | 继承父会话创建时的 Agent preset、有效 sandbox、approval 和可见工具上限。 |

所有权限都由 Host 重新计算。浏览器提交的模式、Session ID 或工具名称不能直接获得授权。权限快照保存在 `storageDomain`，DSH 重启后会重新应用限制。

## 环境要求

| 依赖 | 版本 |
|---|---|
| DeepSeek Harness | `0.1.2-alpha.1` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| pnpm | `>=10.0.0 <12.0.0` |

仓库不依赖相邻的 DSH 或 OpenCode 源码目录。DSH 的运行时包由 DSH Host 提供；仓库内的 [`types/dsh-compat.d.ts`](types/dsh-compat.d.ts) 仅描述本插件使用的已核验公共接口，使全新 clone 可以独立 typecheck 和 build，它不包含或替代 DSH 运行时实现。

## 从源码构建

从 GitHub 克隆或下载仓库，进入仓库根目录后执行：

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` 会依次执行：

- Host 与 Client TypeScript 检查；
- ESLint；
- Unit、Host 和 Client 测试；
- DSH 公共契约版本检查；
- 独立仓库与跨目录依赖检查；
- Host/Client bundle 构建；
- manifest、Client handoff、preset 和禁止架构路径 smoke test。

构建结果生成在 `lib/`：

```text
lib/index.js          Host 插件
lib/client.js         Web Client 插件
lib/preset-root.js    SideChat preset root
lib/types/            TypeScript 声明
```

只构建、不运行完整验证时使用：

```powershell
pnpm build
```

## 安装到 DSH

已经安装独立 `dsh` CLI 时，在本仓库根目录执行：

```powershell
dsh plugin --profile web add . --force
dsh --profile web --dump-config
dsh --profile web
```

`--dump-config` 输出中应包含 `sidechat-preset-root` 和 `sidechat`。

如果从 DSH 源码运行 CLI，可在 DSH 源码根目录执行：

```powershell
pnpm dsh plugin --profile web add <sidechat-repository-path> --force
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

更新插件源码后重新执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add . --force
```

然后重启 DSH。浏览器仍显示旧 Client bundle 时使用 `Ctrl+F5` 强制刷新。

卸载：

```powershell
dsh plugin --profile web remove dsh-sidechat-plugin
```

卸载只移除插件 UI、Host service 和 SideChat 关系解释能力，不会删除已经创建的普通 Session 或 transcript。

## 快速使用

1. 在父 Session 的输入框中输入 `/side`。
2. 用方向键选择 Seed，按 Enter 确认。
3. 选择“只读模式”或“继承”，按 Enter 确认。
4. 输入澄清问题：Enter 创建，Shift+Enter 换行，Esc 取消。
5. 在完整 SideChat 页面继续多轮对话。
6. 使用 `/sidefold` 生成 Fold；预览中 Enter 提交、Shift+Enter 换行、Esc 取消。
7. Fold 提交成功后自动返回父 Session。

插件内包含确认和取消的对话框遵循同一套键盘约定：Enter 确认、Esc 取消；文本框使用 Shift+Enter 换行。

## Slash 命令

| 命令 | 作用 |
|---|---|
| `/side`、`/btw` | 创建普通持久化 SideChat；默认 Seed 为 `tail:1` |
| `/sidechats` | 列出当前工作区 SideChat，当前 Session 的直接子会话优先 |
| `/sideresume` | 打开已有 SideChat 并继续原 transcript |
| `/sideback` | 从 SideChat 返回直接父 Session |
| `/sidefold` | 生成完整或增量 Fold，预览编辑后提交到父会话 |
| `/sidecite` | 选择 assistant 回复并引用到父会话 |
| `/sideusage` | 查看 SideChat、父会话增量和额外 Seed 调用的 token 用量 |
| `/sidecompare` | 比较两个 committed Fold revision |
| `/sidewithdraw` | 软撤回指定 revision，保留审计历史 |
| `/sidearchive` | 归档当前 SideChat |
| `/siderestore` | 恢复 archived SideChat |
| `/sideabandon` | 放弃当前 SideChat，但保留 Session 和 transcript |
| `/sidecites` | 查看 Cite 记录并打开目标 Session |
| `/sidecite-cross` | 显式跨父 Cite；Host 默认关闭 |

## Seed 策略

| Seed | 说明 |
|---|---|
| `tail:1` | 默认；最后一条直接 user 或最终 assistant 文本 |
| `task` | 使用父会话最近模型 route 做一次无工具调用，生成不超过 500 token 的任务式最小上下文 |
| `none` | 不带父上下文，只发送澄清问题 |
| `tail:2` / `tail:4` | 最近两条或四条直接文本 |
| `pick:1` / `pick:many` | 选择一条或多条直接文本 |
| `turn` | 冻结指定 turn 的直接文本 |
| `selection` | 冻结一条消息中的指定字符区间 |
| `summary` | 对用户明确选择的消息做一次独立 bounded summary |

`task` 和 `summary` 会产生一次额外模型调用。`task` 不写入、不唤醒、不推进父 Session；失败时不会遗留半创建的 SideChat。

## 架构与安全

- SideChat 是普通 Session，不使用 `origin: subagent`、continuable lifecycle、settlement 或 fork；
- A/B 关系、Seed provenance、状态、权限快照、Fold revision 和幂等状态只保存在 `storageDomain`；
- Session log 不写入 `sidechat/*` 自定义事件；
- 持久化 SideChat 内容只使用 DSH 已知 `user/message` 和正常 `assistant/message`；
- Fold/Cite 通过 `Agent.runMaintenance()` 等待父会话真正 idle 后 no-reply append；
- Fold/Cite 投递本身不创建父 turn、不 followup、不 steer；Fold 追加后若将达到配置的上下文占用阈值，会先退出 maintenance、显式压缩父会话旧历史、重新测量，再完整追加 Fold。该压缩通常会产生一次独立的压缩模型调用；Cite/撤回不走此压力保护；
- Host 重新验证 parent、child、workspace、lifecycle identity、message ID 和 revision；
- Seed、Recall、Cite 与 Fold 内容始终按不可信背景处理；
- orphaned SideChat 可以读取，但不能再向不存在的原父会话 Fold 或 Cite。

Fold/Cite 使用 domain pending → 安全 append/flush → domain committed 三阶段事务。消息带不可变 marker；如果 Host 在 append 后、状态提交前崩溃，恢复逻辑只补状态，不重复写入消息。

## 配置

默认 bundle 配置位于 [`cordis.patch.yml`](cordis.patch.yml)：

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `foldMaxTokens` | `500` | Fold 最大输出预算 |
| `foldAppendThresholdRatio` | `0.8` | Fold 完整追加后的父上下文占用阈值；达到阈值时先压缩旧历史并重测，仍超阈值则不追加 |
| `citeMaxTokens` | `500` | Cite 最大文本预算 |
| `readMaxMessages` | `5` | 一次精确 Recall 最大消息数 |
| `readMaxChars` | `20000` | 一次精确 Recall 最大字符数 |
| `seedSummaryMaxTokens` | `500` | summary Seed 输出预算 |
| `seedTaskMaxTokens` | `500` | task Seed 输出预算 |
| `allowCrossParentCite` | `false` | 是否允许同工作区显式跨父 Cite |
| `preset` | `sidechat-clarifier` | 只读 SideChat preset |

## 打包发布

生成 npm tarball：

```powershell
pnpm pack
```

`prepack` 会重新构建并执行 manifest smoke。tarball 只包含运行所需 bundle、声明、preset、配置、文档和许可证，不包含 `src/`、测试、`node_modules/`、本地 pnpm store 或历史 tarball。

## 可选的 DSH 源码契约复核

普通构建不需要 DSH 源码。如果维护者恰好有 DSH checkout，可额外验证实际源码锚点：

```powershell
$env:DSH_SOURCE_DIR = '<dsh-source-path>'
pnpm verify:contracts
```

该变量只用于维护期核验，不是安装或构建依赖。

## 已知限制

1. 当前只对 DSH `0.1.2-alpha.1` 做过完整核验；升级 DSH 前应重新运行源码契约复核和真实 Web smoke。
2. DSH 的公开 `SessionController.selectModel()` 会保存全局默认，创建 UI 因此固定继承父会话最近模型；进入 SideChat 后仍可使用原生模型选择器切换。
3. DSH `header.lineage` 是 single slot，SideChat breadcrumb 使用不冲突的 Header actions slot。
4. 外部 bundle 无法进入当前 DSH 的 generated Remote assembly，插件使用公开、认证的 `connection.rpc.handle('/sidechat')` 通道。
5. archive 和 abandon 是插件组织状态；SideChat 仍保留在普通 Session 列表中。
6. `/sideusage` 只展示 provider 已持久化且能组成完整 turn 的 usage；证据不完整时显示“不可得/不完整”。
7. “继承”通过父 preset ID 创建，并以父会话当时实际可见工具为 Host allowlist；preset 恰在创建窗口热更新时，子会话可能装载同 ID 的新 generation，但不会突破父工具上限。

## 项目结构

```text
src/                    Host、Client 与共享业务源码
presets/                sidechat-clarifier Agent preset
types/dsh-compat.d.ts   独立构建用的 DSH 公共契约声明
tests/                  Unit、Host 与 Client 测试
scripts/                构建、契约、可移植性与 manifest 检查
docs/                   API Spike、设计偏差与人工验收清单
cordis.patch.yml        DSH bundle composition
```

## 文档

- [M0 API 核验与设计偏差](docs/M0_API_VERIFICATION.md)
- [M2 API 核验与设计偏差](docs/M2_API_VERIFICATION.md)
- [真实环境人工验收清单](docs/MANUAL_TEST.md)
- [产品需求与技术设计](DeepSeek%20Harness%20SideChat%20插件产品需求与技术设计.md)

## License

[MIT](LICENSE)
