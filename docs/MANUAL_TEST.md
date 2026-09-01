# DSH 真实环境人工验收清单

自动化测试不会调用真实模型，也不会写入开发目录之外。完成安装后，在一个可用模型配置的 Web profile 中执行下列验收。

## 安装与加载

- `dsh --profile web --dump-config` 中存在 `sidechat-preset-root` 和 `sidechat`；
- Agent preset 列表存在 `sidechat-clarifier`；
- 浏览器无 Client bundle 加载错误；
- `/sidechat/tree` 与 `/sidechat/seedChoices` 不返回 404；页面不再请求旧的 `/api/sidechat/*`；
- 普通 Session Header 不增加 SideChat 操作按钮，并有“子会话”页签；
- B Header 只显示 SideChat badge、父 ID、状态与 revision，不出现创建、Fold、比较、归档或放弃按钮；
- slash menu 存在 `/side`、`/btw`、`/sideback`、`/sidechats`、`/sideresume`、`/sidefold`、`/sidecompare`、`/sidewithdraw`、`/sidearchive`、`/siderestore`、`/sideabandon`、`/sidecites`、`/sidecite`、`/sideusage` 和 `/sidecite-cross`；
- 普通 A 不显示只适用于 B 的命令；B 身份加载后按状态显示 Fold、usage 和生命周期命令；
- assistant 回复下方没有插件新增的 Cite 按钮。
- 创建、Cite、软撤回、结果通知和 stale Fold 二次确认全部位于 DSH 页面内，不出现浏览器原生 `prompt`、`confirm` 或 `alert`。

## 创建与 Seed

- `/side` 和 `/btw` 的第一个高亮选项都是 `tail:1`；未显式选择的文本 fallback 也默认为 `tail:1`；
- 选择 Seed 后出现第二个 DSH 内嵌权限选择框，默认高亮“只读模式”；↑/↓ 可切换“只读模式/继承”，Enter 确认，Esc 取消；
- 选择 Seed 后，创建弹窗自动把焦点从父 composer 移到澄清问题输入框；不使用鼠标即可输入；
- 澄清问题输入框 Enter 创建、Shift+Enter 换行、Esc 取消；右下角按钮为浅灰金属质感、无边框；
- 创建弹窗不显示模型策略，B 自动继承父会话最近模型；创建后可用 B 的 DSH 原生模型选择器切换；
- 分别以 `tail:1`、`task`、`none`、`tail:2`、`tail:4`、`pick:1`、`pick:many`、`turn`、`selection` 和 `summary` 创建 B；
- B 出现在普通 Session 列表，同时出现在 A 的“子会话”页签；
- 创建后自动进入 B 的完整 Session 页面；
- B Header 显示 SideChat badge、父 ID、状态与 revision；运行 `/sideback` 可返回父会话；
- 检查 B 的首条 user message：只含选定的直接 user/assistant 文本，不含 reasoning、tool call/result；
- 检查 B Session header：没有 `origin: subagent`、`parentSession` 和 fork seed；
- 关闭并重启 DSH，B 可以恢复并继续多轮输入。
- `selection` provenance 保存固定 start/end 和截取文本；父消息后续变化不改变 snapshot；
- `summary` 创建前明确提示额外模型调用与预算，provenance 同时保留 source message IDs 和生成摘要；
- `task` 创建前明确提示额外父模型调用；调用使用 A 最近实际 route，request 没有 tools，最大输出 500 token，A 的事件数和 turn 数不变；
- `task` provenance 保存完整窗口消息快照、来源 ID、生成文本、父 route、provider usage、生成时间和丢弃的旧消息数；B 首问只包含生成上下文，不复制原窗口；
- 让 `task` 模型调用失败，确认没有创建或遗留 B；在生成过程中替换父 Session lifecycle identity，确认创建被拒绝；
- 父会话没有直接文本时 `tail:1` 仍允许创建，provenance 中模式为 `tail:1` 且 messages 为空；
- 让最新单条直接文本超过 12,000 字符，确认 `task` 拒绝并提示使用 selection/pick/summary，不做静默截断；
- 超过 Seed 字符/token 预算时创建被拒绝且不复制完整 transcript。

## 模型与 preset

- `/side`、`/btw` 创建的 B 与父会话最后实际 route 一致；父会话没有实际 route 时回退其 Agent 默认 route；
- 旧 provenance 中的 `default`/`custom` 模型策略保持可读，Host API schema 继续兼容，但命令创建 UI 不再暴露这些选项；
- 创建后使用 B 的 DSH 原生模型选择器可以切换后续模型；
- 只读模式只显示父会话也拥有的 `read`、`glob`、`grep`、平台 Shell、`web_search/web_fetch`、plan、`ask_user_question`、subagent 与 `workflow`；不显示 `write`、`edit`、jobs、skill、goal、todo 或 ralph；
- 只读模式 Session 日志持久化 `sandbox/mode = read-only` 与 `approval/policy = never`；尝试用 Shell 写文件或让子代理/workflow 绕过边界必须失败；
- 继承模式与父会话当前 preset、可见工具、sandbox 和 approval 一致；先在父会话隐藏/移除某工具后创建 B，该工具不能在 B 出现；
- B Header 显示“只读权限”或“继承权限”，重启 Host 后限制仍然生效。

## Fold

- 在 B 多轮讨论后运行 `/sidefold` 生成 Fold；输出是固定六项结构，默认估算不超过 500 token；
- 命令打开可编辑预览并自动聚焦编辑框；Enter 提交、Shift+Enter 换行、Esc 取消；
- 点击“提交到父会话”或按 Enter 成功提交后自动进入 A，A 增加一条正式 plugin-source `user/message`；
- Fold、Cite、软撤回及其他带确认/取消的插件弹窗均验证 Enter 确认、Esc 取消；含 textarea 的弹窗验证 Shift+Enter 换行；
- A 不出现新的 `turn/start`，模型不被调用；
- 提交后 B 仍可继续对话，再次 Fold 产生递增 revision；
- 重复提交同一 fold ID，A 不增加第二条消息；
- 预览后先在 B 发送新消息，提交时出现 stale 提示；可重新生成或明确提交旧预览；
- A 模型正在生成时提交：UI 显示 pending，A idle 后消息安全追加，不插入正在运行的 step。

## 第二阶段精确读取与 revision

- 完整 Fold 可加入由生成界面给出的 `sidechat://<B>/message/<M>` pointer；伪造 child 或 message ID 时 commit 被拒绝；
- A 存在直接 child 后，模型工具列表只有一个稳定 `sidechat_read` schema；请求 exact ID 能返回原文并显示“不可信背景”；
- 请求非直接 child、未知 ID、超过 5 条、超字符预算或 plugin/tool/reasoning 内容均被拒绝或不可见；
- 创建第二个完整 Fold 后，旧 revision 显示 `superseded`，新 revision 显示 `current`；
- 选择 base revision 生成增量 Fold，父消息显示 `mode=incremental`、base 和 supersedes 关系；
- revision 对比能显示逐行新增/删除；
- 软撤回 current revision 后，A 追加撤回通知但保留原 Fold 消息，B 中 revision 标为 `withdrawn`，最近有效旧版恢复为 `current`；
- 在 A 模型运行时软撤回，撤回通知同样等待安全边界；重启 pending 操作后只投递一次。

## 递归树

- 在 B 运行 `/side` 创建 C；A 的“子会话”树显示 B → C 层级；
- 刷新和 Host 重启后树结构与深度不变；
- A 不能用 `sidechat_read` 直接读取孙级 C；B 可以读取自己的直接 C；
- 从树中的 archived/abandoned/orphaned 节点仍可进入普通完整 Session 页面。

## Cite

- 在 B 运行 `/sidecite` 并选择自身 assistant 回复，A 收到带 child/message marker 的正式消息；
- 在 A 运行 `/sidecite`，只能选择该 A 关联的 B 和经 Host 校验的 assistant 文本；
- 重复同一 cite ID 不产生重复消息；
- 伪造其他 Session 的 message ID 被拒绝。

## 可选跨父 Cite

- 保持默认 `allowCrossParentCite: false` 时，`/sidecite-cross` 的 Host 请求明确返回 disabled；
- 在隔离 profile 将该配置设为 `true`，从目标 Session C 运行 `/sidecite-cross`，UI 明确显示来源 SideChat、原父 Session 和 workspace，并要求确认；
- 只能选择同 `cwd` 的 SideChat，跨 workspace 请求被 Host 拒绝；
- 成功后 C 收到不可变 assistant snapshot；B 运行 `/sidecites` 可查看并打开引用目标，归档 B 后已投递 snapshot 仍可读；
- 浏览器伪造 source/target/消息 ID 或 Session lifecycle identity 变化时提交被拒绝。

## 用量

- 在完成至少两个 B turn 后运行 `/sideusage`，B 累计值等于完整 turn 的 uncached input、cache read/write、output、reasoning 和 total 之和；最近 turn 单独显示；
- 使用 `task` 或 `summary` 创建时，报告单列这次额外调用的父/B route 与实际 provider usage；普通 tail/none Seed 不伪造额外调用；
- Fold 生成 turn 计入 B；Fold/Cite no-reply append 自身模型调用显示 `0`；另行确认 Fold 超阈值时可能出现父历史压缩模型调用；
- B 创建后继续在 A 对话，父会话增量只统计创建基线之后的完整 turn；
- 在 B 正在生成时查看，报告标为“不完整”；旧 `0.2.x` 记录没有基线时显示“不可得”，不能显示为零；
- provider 缺失 cache/reasoning/total 字段时，对应字段显示“不可得”，不使用字符估算冒充精确 usage。

## 生命周期与卸载

- `/sidearchive` 后可用 `/siderestore` 恢复；`/sideabandon` 后 `/sidefold` 不再提供可选项；
- 删除或移走父 Session 后，B 显示 orphaned，Fold/Cite 被拒绝；
- 卸载插件并重启，B 仍在普通 Session 列表且 transcript 可读；
- 重新安装插件后，未损坏的 `storageDomain` 关系和 committed revision 可恢复。
- 普通 Session 列表始终保留 B；DSH 0.1.2-alpha.1 无公开安全过滤 Slot，本版本不提供隐藏偏好。
