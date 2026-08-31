# SideChat 审查问题待修改清单

- 文档状态：待实施方案
- 文档版本：v0.1
- 评审对象：SideChat 插件 `0.3.4`
- 设计基线：DSH `0.1.2-alpha.1`，提交 `cd5ef81481`
- 评审依据：产品需求与技术设计、`docs/M0_API_VERIFICATION.md`、`docs/M2_API_VERIFICATION.md`、`docs/MANUAL_TEST.md`、当前源码与测试
- 本文目的：记录后续需要修改、验证或补充的内容

> 本文只记录待办和目标行为。本次只新增文档，不执行本文中的代码、测试、配置或 DSH 集成修改。

---

## 1. 总体判断

当前版本已经实现了普通 SideChat Session、Seed、权限快照、子会话树、Fold、Cite、revision、精确 recall、usage 和命令式 Web UX 的主要功能面。

但当前证据主要来自纯逻辑测试、shim Host 测试和局部 jsdom 测试。完整的真实 DSH Host 集成、崩溃恢复、模型调用、插件卸载和浏览器 E2E 尚未形成可审计的通过记录。因此当前状态应描述为：

```text
实现范围：较完整
纯逻辑验证：较充分
真实运行时验证：局部完成
M1/M2 整体验收：未完成
发布判断：No-Go，先完成 P0/P1 修复和真实链路验证
```

---

## 2. 里程碑状态

| 里程碑 | 当前状态 | 待处理事项 |
|---|---|---|
| M0 技术 Spike | 基本完成 | 将 M0 中过时的外部 Typert Remote 结论标记为 superseded，以 M2 的 `/sidechat` Connection RPC 结论为准；补充模型选择副作用的真实记录。 |
| M1 核心闭环 | 代码面大部分完成，整体验收未完成 | 补齐真实 create/Fold/Cite/lifecycle/restart/卸载测试，并修复事务、权限和客户端状态问题。 |
| M2 渐进式记忆 | 主要逻辑已实现，整体验收未完成 | 验证 exact read、pointer、revision、递归树和跨父 Cite 的真实 Host 行为；完成 token benchmark。普通列表隐藏按设计不实现。 |
| M3 命令式 UX | 功能面已实现，验证不完整 | 补齐所有命令选项与可见性测试、错误恢复、焦点行为、英文文案和真实 Web smoke。 |

---

## 3. P0：发布前必须修复

### R-01 Revision fencing

- 优先级：P0
- 位置：`src/service.ts:603`、`src/transactions.ts:58`
- 问题：旧的 prepared revision 在新的 revision 已经提交后，仍可能再次被提交并提升为 current。
- 影响：`latestFoldRevision` 的语义可能回退，父会话中的最新 Fold 与 SideChat domain 的 current 状态不一致。
- 修改目标：提交时验证 revision generation、当前 revision 和预览基线；旧 revision 不能抢占较新的 current。需要区分“同一 foldId 的幂等重试”和“过期 revision 的提交”。
- 验收标准：
  - rev-2 提交后提交 rev-1 被拒绝或保持 superseded；
  - 相同 foldId 重试仍然幂等；
  - 并发两个 Fold 时 current 结果稳定且可解释；
  - 旧 Fold 的审计内容不被修改。

### R-02 pending 投递失败后的恢复

- 优先级：P0
- 位置：`src/service.ts:617`、`src/service.ts:745`、`src/service.ts:1179`
- 问题：父会话空闲时直接投递失败，操作可能保持 pending；当前主要依赖 Host 重启时的 pending 扫描恢复。
- 影响：用户收到失败，但不重启 Host 就无法继续；客户端可能无法区分等待、失败和可重试。
- 修改目标：统一 Fold/Cite/withdrawal 的投递调度、失败状态、重试和退避；网络超时不能导致静默 pending。保留唯一 marker 和查询状态的幂等语义。
- 验收标准：
  - append 失败、flush 失败和 domain 更新失败均进入可观察状态；
  - 可通过查询或显式重试恢复，不需要重启 Host；
  - 重启后 pending 只投递一次；
  - 同一操作不会产生重复父消息。

### R-03 权限安装必须 fail closed

- 优先级：P0
- 位置：`src/service.ts:1005`
- 问题：`tools.restrict()` 或 SideChat persona 安装失败后仅记录日志，创建流程仍可能成功。
- 影响：只读 SideChat 可能在未完成工具限制的情况下运行，破坏设计中的权限边界。
- 修改目标：只读和继承权限的安装必须作为创建/恢复的前置条件；任何限制安装失败都应阻止创建或将 Session 标记为不可用，不得继续暴露未验证的 Agent。
- 验收标准：
  - restriction、sandbox、approval、persona 任一安装失败时创建失败或进入明确 blocked 状态；
  - 不产生可继续使用的半配置 B；
  - 重启恢复时同样 fail closed；
  - 只读模式不能通过 Shell、子代理或 workflow 绕过限制。

### R-04 创建事务与失败补偿

- 优先级：P0
- 位置：`src/service.ts:832-910`
- 问题：普通 Session 创建和 domain 登记之后，模型选择、summary、rename 或首问仍可能失败，缺少统一补偿和重试入口。
- 影响：可能出现已创建但用户不知道的 B、未登记 B 或重复创建多个 B。
- 修改目标：为创建流程定义明确状态，例如 `creating`、`ready`、`initial-prompt-failed`、`abandoned`；返回稳定的 child ID 和可恢复状态。首问失败时保留 B，并提供重试或放弃，而不是让客户端重新创建。
- 验收标准：
  - Task/summary 模型调用失败时不创建 B；
  - B 创建成功但首问失败时，B 可从 catalog 恢复并重试；
  - Client 重试不会创建第二个 B；
  - domain 和普通 Session 的状态可在重启后恢复。

### R-05 Cite、Seed、Recall 的不可信边界一致化

- 优先级：P0
- 位置：`src/fold.ts:129-135`、`src/seed.ts:166-181`、`src/read.ts:53-65`
- 问题：Seed 和 Recall 明确声明不可信背景，Cite 直接拼接 assistant 文本，安全语义不一致。
- 影响：被引用的模型生成内容可能被父 Agent 误认为当前指令或权限来源。
- 修改目标：所有回流 A 或注入 B 的外部内容都使用统一的不可信背景标头、来源和边界说明；不因用户点击 Cite 就改变工具授权。
- 验收标准：
  - Cite 文本包含来源、不可变快照和不可信背景说明；
  - 工具请求、权限声明和嵌套 Session reference 不产生授权效果；
  - 单元、Host 和 E2E 均验证 prompt-injection 边界。

---

## 4. P1：功能完成前必须处理

### R-06 Fold 生成绑定具体 turn

- 位置：`src/service.ts:1145-1158`
- 问题：Fold 通过 baseline 后的最后一条 assistant 文本推断生成结果，并未绑定具体 Fold request/turn。
- 修改目标：保存 Fold request 的 turn/event identity，只接受该请求对应的 assistant 结果；并发用户输入不能被误认成 Fold 或 rewrite 结果。
- 验收标准：并发发送普通消息、Fold rewrite 和停止操作时，Fold 仍只能绑定自己的生成 turn。

### R-07 marker 真实性与幂等校验

- 位置：`src/service.ts:204`
- 问题：只根据 user/message 文本是否包含 marker 判断父消息已经投递，普通用户文本理论上可以伪造 marker。
- 修改目标：同时验证 plugin source、form、marker 类型、完整操作 ID、child ID 和目标关系；必要时保存父 event seq。
- 验收标准：伪造普通消息不能使 domain 错误标记为 committed；真实消息重试仍不重复。

### R-08 生命周期和 orphan 状态机

- 位置：`src/service.ts:755-769`、`src/service.ts:1359-1373`
- 问题：状态转换限制不完整；任意关系检查异常都可能永久写成 orphaned。
- 修改目标：明确允许的状态转换；区分 Session 不存在、identity 改变、临时读取失败和存储失败。瞬时错误不得永久改变生命周期状态。
- 验收标准：
  - `abandoned` 不能无条件恢复为 open；
  - orphaned 的读取、归档和恢复行为符合设计；
  - 临时 inspect/storage 故障可重试；
  - 父 Session 被删除后的行为可审计。

### R-09 domain schema 与运行时策略一致

- 位置：`src/types.ts:34`、`types/dsh-compat.d.ts:212`
- 问题：兼容声明允许 approval `always`，SideChat domain schema 只允许 `ask|never`。
- 修改目标：确认 DSH 实际策略枚举，补齐 schema 或明确拒绝不支持的策略；同时将 read 数量限制拆为安全硬上限和可配置默认值。
- 验收标准：所有支持的 approval policy 均可持久化、冷恢复和显示；超出硬上限的 recall 请求始终拒绝。

### R-10 客户端 pending、错误和确认状态

- 位置：`src/client/components.tsx:129-140`、`src/client/index.ts:407-415`
- 问题：pending Fold 跳转后反馈丢失；B 内 `/sidecite` 绕过统一确认工作流；Cite pending 复用了 Fold 文案。
- 修改目标：建立操作结果页或父会话持久通知；B/A 两种 Cite 入口统一使用确认、取消、pending、failed 状态；补充错误重试。
- 验收标准：所有确认型操作支持 Enter、Shift+Enter、Esc；pending/failed 状态在跳转后仍可见；文案准确区分 Fold、Cite 和 withdrawal。

### R-11 客户端数据刷新与信息完整性

- 位置：`src/client/components.tsx:84-100`、`src/client/components.tsx:269-329`
- 问题：Remote 错误可能被当作普通 Session；子会话树错误会同时显示空态和错误；树缺少主动刷新；列表缺少 Seed 类型、运行状态和生命周期操作。
- 修改目标：区分 `not-sidechat`、network、schema 和 Host business error；树、Header 和操作完成后刷新；补齐设计文档规定的列表信息。
- 验收标准：错误不伪装成空列表；刷新、重试、归档、恢复和放弃后 UI 状态一致；移动端不发生内容遮挡。

### R-12 模型选择副作用显式化

- 位置：`src/service.ts:914`、`src/client/workflow-dialogs.tsx:267-274`
- 问题：Host 返回 `modelSelectionChangesGlobalDefault`，Client 未向用户披露。
- 修改目标：创建前明确说明 DSH 当前公开 API 可能同步更新全局默认；保留当前设计的回退策略，不复制 DSH 私有实现。
- 验收标准：用户能在创建前看到副作用说明；创建结果和 SideChat Header 显示实际模型；真实 Web 测试确认 B 后续模型可切换。

### R-13 UI、locale 和可访问性收尾

- 位置：`src/client/locales.ts`、`src/client/workflow-dialogs.tsx:346-574`、`src/client/styles.ts:46`
- 问题：大量文案硬编码中文；comparison/usage 弹窗的 Esc 行为不完整；dialog focus trap 和焦点恢复缺失；声明的 metal button 没有对应样式。
- 修改目标：统一 locale key、弹窗行为和样式；所有图标按钮提供 aria-label/tooltip；不改变 Header 只承载身份信息的设计。
- 验收标准：中英文完整切换；键盘和屏幕阅读器流程可用；桌面和移动端无溢出或重叠。

---

## 5. 验证建设

### R-14 真实 DSH Host 集成测试

- 当前问题：测试主要使用 `tests/shims/dsh-runtime.ts`，不能证明真实 Session replay、domain 原子性、Agent 生命周期和安全边界。
- 待增加：
  - 普通 B create、冷恢复和首问顺序；
  - Fold/Cite/withdrawal 的 prepare、append、flush、commit 故障矩阵；
  - A running 时安全边界；
  - revision fencing 和并发幂等；
  - 权限 fail closed；
  - native subagent 隔离；
  - 插件卸载后普通 Session fallback。

### R-15 Web E2E 与 CI

- 当前问题：没有 Playwright E2E、完整覆盖率门槛或 CI workflow。`MANUAL_TEST.md` 是待执行清单，不是通过记录。
- 待增加完整旅程：

```text
A 创建 B
→ B 两轮对话
→ Fold rev-1
→ 返回 A
→ 恢复 B 并继续对话
→ Fold rev-2
→ Cite 指定回复
→ 重启 Host
→ 恢复 A/B/revision/引用
```

- 验收标准：真实 DSH Web profile 有可审计运行记录；失败注入、重启和卸载均有结果；测试不依赖用户真实数据。

### R-16 文档证据治理

- 待处理：
  - 在 M0 文档中标记旧 Remote 结论已被 M2 修正；
  - 将 README 的“已支持”与“已真实验收”分开；
  - 为 MANUAL_TEST 增加执行日期、DSH profile、模型、结果和失败记录；
  - 为每个里程碑维护“实现、自动化验证、真实验证”三个状态。

---

## 6. 建议实施顺序

1. 修复 R-01 至 R-05，建立统一事务、权限和不可信内容边界。
2. 修复 R-06 至 R-13，收敛客户端状态和用户可见行为。
3. 完成 R-14 的真实 Host fixture 和故障注入。
4. 完成 R-15 的 Web E2E、重启和卸载验证。
5. 完成 R-16，再进入轨迹提问功能开发。

轨迹提问依赖普通 SideChat 创建、权限、provenance、safe-boundary append 和 Fold 事务的稳定语义。若 P0 问题未处理，轨迹功能会继承相同的重复提交、错误恢复和内容注入风险。

---

## 7. 完成定义

本清单不应以“代码已修改”作为完成标准。每个问题至少需要同时满足：

1. 实现行为符合本文目标；
2. 有针对性的单元或 Host 测试；
3. 涉及真实 DSH API 或用户旅程时有真实 Web/E2E 记录；
4. 设计文档、README 和人工验收清单与实际行为一致；
5. 失败、重启、卸载和权限边界都有明确结果。

---

## 8. 修复记录

### R-01 Revision fencing（已修复，2026-08-31）

- `src/service.ts` `commitFold`：新增提交栅栏——其他 fold 中 `state ∈ {pending, committed}` 且未撤回的最高 revision 构成屏障，目标 revision 更旧时返回 `failure('fold-superseded', ...)`。`allowStale` 不绕过该栅栏（内容新鲜度与版本序正交）；屏障计入 `pending` 以封住"已接受提交、尚未 promote"的竞态窗口；撤回的 revision 不计入屏障。
- `src/transactions.ts` `promoteFoldRevision`：新增 reducer 守卫——若存在 revision 更大且持有 current（含 legacy `revisionState === undefined`）的 committed fold，迟到者保持 `superseded` 审计（`committedContent` 等审计内容不变），不再无条件抢占 current。
- 幂等语义不变：同 foldId 的重试在栅栏之前早返回（`pending`/`committed` → 返回原状态），不产生副作用。
- 测试：`tests/transactions.unit.spec.ts` 新增乱序 promote 守卫与顺序 promote 回归两用例；新增 `tests/revision-fence.host.spec.ts` 覆盖：rev-2 committed 后提交 rev-1 被拒（含 allowStale）、rev-2 pending 时同样被拒、rev-2 撤回后 rev-1 放行并完整投递、同 foldId 幂等重试、顺序提交 rev-2 正常 promote。
- 验证：`pnpm test`（16 文件 62 用例）、`pnpm typecheck`、`pnpm lint` 全部通过（shim Host 测试，真实 DSH Host 验证待 R-14）。
- 客户端影响：`fold-superseded` 为新增失败码，客户端 `components.tsx` 对未知错误码按通用错误展示；针对性文案与"重新生成"引导属 R-10 客户端改造范围。
