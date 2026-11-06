# cline 借鉴技术方案

来源：对 `D:\code\github\cline`（新 SDK 架构，v3.0.x monorepo）的四份深度分析（架构 / agent 循环 / 特色功能 / CLI 产品面），与本 fork（`dev`，2.2.0-fork.10）的逐项对照。
本文只收录**确认本 fork 尚未具备**且**性价比达标**的项；fork 已有的能力（事件溯源 session core、权限 risk 升级、steering、压缩预算、MCP stdio+OAuth、Snapshot/Revert）不在范围内。

每项按统一结构给出：目标 / 现状 / 设计 / 实施步骤 / 测试 / 文档同步 / 工作量。文末是里程碑与开放决策点。

## 通用执行规范（每一项都适用）

- 分支：≤3 个词、连字符、无类型前缀，基于 `origin/dev`，PR 回 `dev`，diff 对 `origin/dev`。
- 提交：conventional commit（`feat(core): ...` / `fix(tui): ...`）。
- 验证：改完后仓库根 `bun run check`；迭代期在受影响包目录 `bun typecheck`；不直接跑 `tsc`。
- 测试：从包目录运行（不在根目录跑）；写测试前先读 `.opencode/skills/unit-tests` 对应 skill；避免 mock。
- 文档同步是完成定义的一部分，按 `doc/conventions.md` 的 change map 在**同一 diff**内完成；用户可见改动进 `CHANGELOG.md`。
- 引用 cline 代码只作实现参照；**不要照搬弱于本 fork 的机制**（如 JSON 文件转录、per-tool approve 模型）。cline 许可证与代码引入兼容性在动手前单独确认（见开放决策点）。

## 方案总览

| # | 项目 | 优先级 | 分支名 | 工作量 | 主要落点 |
|---|---|---|---|---|---|
| 1 | 工具循环失控防护 | P0 | `loop-guard` | 0.5–1 天 | `packages/core/src/plugin/` |
| 2 | Plan 模式命令硬后盾 | P0 | `plan-command-guard` | 0.5–1 天 | `packages/core/src/tool/plugin/shell.ts` |
| 3 | 模型→工具路由 | P0 | `model-tool-routing` | 1 天 | `packages/core/src/config` + runner |
| 4 | 拒绝反馈措辞 | P0 | `rejection-notice` | 0.5 天 | 权限拒绝消息生成处 |
| 5 | TUI 细节对齐 | P0 | `tui-polish` | 1–2 天 | `packages/tui/src/` |
| 6 | 定时任务子系统 | P1 | `schedule-routines` | 1.5–2 周 | `packages/core/src/schedule/` + schema |
| 7 | 结果缓存 URI | P1 | `result-cache-uri` | 2–3 天 | `packages/core/src/session/` |
| 8 | 插件可靠性 v1 → 沙箱 v2 | P1 | `plugin-reliability` → `plugin-worker-sandbox` | 1 周 / 2–3 周 | `packages/plugin/` |
| 9 | 压缩细节对齐 | P1 | `compaction-alignment` | 1–2 天 | `packages/core/src/session/compaction.ts` |
| 10 | 快照恢复防御细节 | P1 | `snapshot-restore-hardening` | 1 天验证 + 0–2 天 | `packages/core/src/snapshot.ts` |
| 11 | 路线图项 | P2 | — | — | 见第十一节 |

---

## 1. 工具循环失控防护（P0）

**目标**：模型陷入"连续重复同一工具调用"的循环时，在第 N 次重复处硬性打断并把纠正指令反馈给模型。这是 runaway agent 的最后防线，现有 `runner/max-steps.ts` 的步数上限只能事后兜底，无法区分"30 步正常工作"和"3 步死循环"。

**现状**：
- `packages/core/src/session/runner/max-steps.ts`：步数上限 + `MAX_STEPS_PROMPT`（到限后禁用工具要求文本总结）。
- `packages/core/src/session/runner/retry.ts`：provider 错误重试策略（`ModelRetry.policy` + `session.retry` 插件钩子），与本项正交。
- 插件系统提供 `tool.hook("execute.before")`，**抛出 `Tool.Error` 即可在工具执行前拒绝调用**（类型见 `packages/plugin/src/effect/tool.ts` 的 `ToolFailures`）。

**设计**：
- 新内置插件 `packages/core/src/plugin/loop-guard.ts`，`define()` 模式与 `plugin/plan.ts` 相同，注册进 `packages/core/src/plugin/internal.ts`。
- 状态：进程内 `Map<SessionID, { last: string; count: number }>`。signature = `tool` + 输入的 canonical JSON（键排序后 `JSON.stringify`）。Map 设上限（如 512 会话，满则逐出最旧），signature 变化即重置计数。
- `tool.hook("execute.before")`：signature 与上次相同则 `count++`；`count >= 3` 时抛 `Tool.Error`，消息模板（此文本是 model-visible token，按 change map 写进 topic doc，字面保留）：

  ```
  Loop guard: this exact tool call has already been made N times in a row with identical
  arguments and returned the same result. Repeating it will not help. Either change the
  arguments to get new information, use a different approach, or ask the user.
  ```

- 拒绝本身就是软反馈（模型看到错误即可自纠）；不引入"先警告再拦截"两阶段——`execute.before` 只有放行/拒绝两种结果，两阶段等于把同一条信息发两遍。此取舍记入 doc 的 `Decisions`。
- 不加配置项（默认开启、阈值 3 为常量）。有真实需求再加，避免投机配置。

**实施步骤**：
1. 读 `packages/core/src/plugin/plan.ts` 与 `internal.ts`，确认内置插件的注册方式与命名约定。
2. 写 `loop-guard.ts`（纯函数 `signatureOf(tool, input)` 独立导出以便测试）。
3. 在 `internal.ts` 注册。
4. `bun typecheck`（`packages/core`）。

**测试**：包目录跑。用例：同参连续调用第 3 次被拒且错误消息含 "Loop guard"；改参数后计数重置；不同工具互不触发；512 会话逐出不崩。

**文档同步**：`doc/session-loop.md` 新增小节（工具级循环防护、阈值、消息 token 字面值）+ `Decisions` 记"单阶段拒绝"取舍；`CHANGELOG.md` 用户可见行。

---

## 2. Plan 模式命令硬后盾（P0）

**目标**：plan agent 现在只 deny `edit/write/patch` 权限，但 `rm -rf`、`git reset --hard`、`npm install` 这类 shell 命令照样能执行。在 plan 模式下把文件变异类 shell 命令**在执行前拒绝**。

**现状**：
- `packages/core/src/plugin/plan.ts`：plan agent 的权限注入与 `execute.after` 错误改写。
- `packages/core/src/tool/plugin/shell.ts`：shell 工具内部已经用 `ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })` 把命令解析成结构——**不要**在插件钩子里用正则重新解析，直接复用这个解析结果。

**设计**：
- 纯函数判定器 `packages/core/src/tool/plan-guard.ts`：`isMutatingCommand(command: string, shell?, target?): { mutating: boolean; reason?: string }`，内部调 `ShellParse.scan`。判定器保持纯函数、独立可测。
- 接入点二选一，**实施第一步先验证**：`execute.before` 钩子事件确认携带 `agent: Agent.ID`（`packages/plugin/src/effect/tool.ts`），但只有原始命令字符串（shell/target 取默认值）；工具内部（`shell.ts` 解析后）上下文更准，但需确认执行器能拿到当前 agent。**取舍规则：工具执行器有 agent 上下文则选工具内部（解析零重复），否则选钩子（agent 可靠，判定器用默认 shell/cwd 自解析）。** 拿不准时选钩子——plan agent 身份判断错了守卫就失效，宁可多解析一次。
- 判定类别（deny list，参照 cline `command-guard.ts` 分类）：
  - 文件变异：`rm/mv/cp/mkdir/rmdir/touch/chmod/chown/ln`、`sed -i`、`tee` 写文件。
  - 重定向：`>`、`>>` 指向文件。
  - git 变异：`commit/push/pull/merge/rebase/reset/checkout/restore/clean/stash`（`status/diff/log/show/grep` 放行）。
  - 包管理写操作：`install/add/remove/uninstall/update`（npm/bun/pnpm/pip/…）。
  - **不可判定 → 拒绝**（fail closed）：管道/命令串里含无法归类的非白名单命令时拒绝。这与 `doc/permissions.md` 的 `risk: "unanalyzable"` 升级原则同构。
  - 放行白名单：读类（`ls/cat/head/tail/grep/rg/find/wc/du`）、只读 git、`node -e`/`bun -e` 之外的一切先归入不可判定。

**实施步骤**：
1. 读 `ShellParse` 的输出结构（`packages/core/src/session/shell.ts` 附近），确认能区分命令、参数、重定向、管道段。
2. 写 `plan-guard.ts` 判定器 + 表驱动测试。
3. 在 `shell.ts` 执行前调用：`agent === plan && mutating` → 抛 `Tool.Error`，消息 `Plan mode is read-only: <reason>. Switch agents to modify files.`
4. 确认 plan agent 之外不受影响（guard 只对 plan agent 生效）。

**测试**：判定器表驱动（每类别正反例至少 2 条；`sed -i` vs `sed`；`git log` vs `git commit`；含引号/ heredoc 的命令不被误判）；工具级集成测试验证 plan agent 命中被拒、build agent 同命令放行。

**文档同步**：`doc/session-loop.md`（工具侧规则一行 + 指向判定器）；`packages/core/src/plugin/plan.ts` doc comment 补一句"shell 命令由 plan-guard 硬拒"；产品文档 plan 模式页。

---

## 3. 模型→工具路由（P0）

**目标**：按模型启用/禁用工具。cline 用它让 codex/gpt 系模型走 `apply_patch` 而非 `editor`（`model-tool-routing.ts`）；我们落地为通用机制，首版只配已知有收益的规则。

**现状**：工具集对所有模型一致。工具列表按请求组装，落点在 runner 的请求组装路径（实施第一步定位：从 `packages/core/src/session/runner/step.ts` 与 `runner/prompt/` 找"工具清单过滤进请求"的具体符号；`packages/core/src/generate.ts` 也可能参与）。

**设计**：
- 配置键 `tool_routing`（数组，`packages/core/src/config` 走 `config/normalize.ts` 既有模式，doc comments 写清键名与默认值）：

  ```jsonc
  "tool_routing": [
    { "model": "gpt-*", "disable": ["edit", "write"], "enable": ["patch"] }
  ]
  ```

  匹配维度：`model`（glob，对 `provider/model` 全名匹配）、可选 `provider`。多条规则按序叠加，`disable` 后 `enable`。
- 请求组装处应用：拿到本次 session 的模型 ref → 依序应用规则 → 传过滤后的工具清单。不匹配任何规则的模型行为完全不变。

**实施步骤**：
1. 定位每请求工具清单组装符号；确认模型 ref 在该处可用。
2. `packages/schema`（若类型放 schema 层）+ `config/` 定义键与归一化。
3. 组装处应用路由；config 变更的热生效沿用现有 config watcher 行为（下一请求自然生效）。
4. 首版规则：按团队实际用的模型定，起步可只放一条占位规则证明机制。

**测试**：路由匹配单测（glob、规则叠加顺序、无规则零影响）。

**文档同步**：change map 行 "Config keys and defaults" → `packages/core/src/config/**` doc comments + 产品文档 config 页；`CHANGELOG.md`。

---

## 4. 拒绝反馈措辞（P0）

**目标**：用户在权限提示里拒绝工具后，给模型的错误里明确"这是用户决定，不是系统故障"，防止模型把拒绝当瞬时错误重试。cline 的对应常量：`TOOL_REJECTION_SUFFIX`。

**现状**：权限拒绝以 `Permission.BlockedError` 冒泡，`plugin/plan.ts` 已展示如何把 `BlockedError` 改写成 `ToolFailure` 消息。真正把"用户拒绝"与"内部失败"区分措辞的位置需定位（实施第一步：grep `BlockedError` 的 message 生成处）。

**设计**：
- 常量（model-visible token，写入 doc）：

  ```
  This was a user decision, NOT a tool or system failure. Do not retry the same call.
  Clarify with the user or adjust your approach.
  ```

- **只对权限拒绝类**追加，不碰真实内部错误（保持错误信息可诊断）。
- 顺带检查：`question` 工具被拒、`subagent` 被拒、MCP 工具被拒是否都经过同一消息生成点；是则一处改动全覆盖。

**实施步骤**：定位 → 加常量与分支 → 观察一次真实拒绝的 tool result 文本。

**测试**：权限拒绝路径的单测断言消息含该后缀；非权限错误不含。

**文档同步**：`doc/permissions.md`（拒绝消息措辞一行，contract token 字面保留）。

---

## 5. TUI 细节对齐（P0，逐项验证后做）

cline CLI 与本 fork TUI **同栈**（`@opentui/core` + `@opentui/react`），对照实现可直接移植。每小项先确认 fork 现状再动手，避免重复建设：

| 子项 | cline 参照 | 验证点 | 工作量 |
|---|---|---|---|
| 5a 启动预绘背景 | `apps/cli/src/tui/index.tsx`：`renderer.getPalette({ timeout: 150 })` 探测前景/背景色，先绘主题背景再渲染，消除启动闪色 | `packages/tui/src/runtime.tsx` renderer 初始化处是否已有 | 0.5 天 |
| 5b stdio 捕获 | `apps/cli/src/tui/stdio-capture.ts`：截获 core 侧 `console.log`，防打花 TUI | fork 的 cli→server→tui 架构下 server 日志是否可能污染 TUI stdout；`packages/cli` 入口检查 | 0.5 天 |
| 5c OSC52 剪贴板复制 | 选择复制走 OSC52 | TUI 选择/copy 处理现状 | 0.5 天 |
| 5d 终端标题 | `apps/cli/src/utils/terminal-title.ts`：标题随应用状态（运行中会话标题）变化 | 现状是否有 | 0.5 天 |

**实施步骤**：按表逐项验证 → 做缺的 → 每小项独立 commit（`feat(tui): ...`）。

**测试**：5a/5b 需真终端验证（`bun run dev:live`）；5c/5d 手动 + 现有 TUI 渲染测试（读 `.opencode/skills/tui-tests` 后补）。

**文档同步**：产品文档 tui 页；无 topic doc 变更。

---

## 6. 定时任务子系统（P1，本 fork 最大空白）

**目标**：让 agent（和用户）能把任务按 cron/一次性时间自动执行：`~/.opencode/schedule/*.md` 与工作区 `.opencode/schedule/*.md` 写规格，常驻服务按期启动真实 session 跑 prompt，结果通知用户。cline 的参照：`sdk/packages/core/src/cron/`（Markdown+SQLite 对账）与 `schedule` 工具。

**现状**：
- `packages/core/src/job.ts` 是后台 shell/subagent 的**通知**机制（`notificationID`、`Background` schema），不是调度器——cron 完全空白。
- 已有可复用地基：`Session.prompt(...)` 的 admit-only（`resume: false`）与正常投递、`Bus` 事件、Location-scoped service 模式（`location-service-map.ts`）、`opencode service` 常驻进程、`runner/max-steps` 与权限体系约束无人值守运行的爆炸半径。

**设计**：

*规格文件（用户可编辑的真源之一）*：
- `<workspace>/.opencode/schedule/*.md` + 全局目录，YAML frontmatter：

  ```markdown
  ---
  schedule:
    cron: "0 9 * * 1-5"        # 或 run_at: 2026-11-05T09:00:00+08:00（一次性）
    timezone: Asia/Shanghai
  agent: build                  # 无人值守建议配 deny-* 或专用 agent
  model: anthropic/claude-...   # 可选
  ---
  每天 9 点检查 CI 失败的 PR 并总结原因。
  ```

- 文件 watcher（沿用 `config/watch.ts` 的既有 watcher 模式）→ **reconciler 单向同步进 DB**。watcher 永不直接执行；执行只读 DB。解析失败的文件**记录状态、不抛异常**（坏文件不拖垮 sweep），UI/工具可列出无效规格。

*存储*：
- 跟随 Schema→Core 依赖方向：类型进 `packages/schema`（schedule schema），表进 core。
- 表 `schedule`（snake_case 列名，按 Drizzle 规范）：`id`, `location_id`, `name`, `cron`, `run_at`(nullable), `timezone`, `prompt`, `agent`, `model_ref`(nullable), `enabled`, `status`(live/paused/expired), `next_run_at`, `last_run_at`, `claim_until`, `claim_owner`, `created_at`, `updated_at`。
- 运行记录表 `schedule_run`：`schedule_id`, `session_id`, `started_at`, `finished_at`, `status`, `error`。DB 即真源；不另做 Markdown 报告文件（v1 通知走 `Job` 的 notification 通道，比 cline 的报告文件更贴合本 fork 的通知体系）。

*执行循环*：
- `Schedule.Service`（Location-scoped，自导出模式 `export * as Schedule from "./schedule/index.js"`）+ 全局 sweep：常驻服务（`opencode service` 进程）内每 30s 扫 `next_run_at <= now`。
- 认领：单条 SQLite 事务 `UPDATE schedule SET claim_until = now + 5min, claim_owner = <pid> WHERE id = ? AND (claim_until IS NULL OR claim_until < now)`，写影响行数为 0 即跳过——多进程/重启下不重跑。
- 执行：认领成功 → 计算下次 `next_run_at`（一次性则置 `expired`）→ `Session.prompt(...)` 创建并投递 session（agent 权限由规格指定；文档明确警示无人值守 + 全权限的组合）。
- 崩溃恢复：`claim_until` 过期即视为可重跑（at-least-once；prompt 幂等性由 prompt 内容决定，doc 写明这是语义而非 exactly-once 保证）。

*agent 工具*：
- `schedule` 工具（`packages/core/src/tool/plugin/schedule.ts`）：`create/list/pause/resume/delete/run_now`。入参 zod schema；`run_now` 立即触发一次。
- 新权限 action `schedule`，默认 `ask`——agent 不能未经允许给自己建定时任务。进 `doc/permissions.md` action 清单。

**实施步骤**：
1. schema：`packages/schema` 加 schedule/run 类型；core 加表（`session/sql.ts` 同款 Drizzle 风格；注意迁移脚本位置沿用现有迁移机制）。
2. `packages/core/src/schedule/`：`spec.ts`（Markdown 解析，纯函数）、`store.ts`（DB 读写）、`reconcile.ts`（文件→DB）、`sweep.ts`（认领+触发）、`service.ts`（组装，Layer 模式照抄邻近模块）。
3. watcher 接入 `config/watch.ts` 模式；sweep 挂到常驻服务启动路径。
4. `schedule` 工具 + 权限 action。
5. e2e：真时间轮转用假时钟（`Clock` test layer，Effect 自带），不 sleep。

**测试**：spec 解析（BOM/CRLF/坏 frontmatter 不抛）；认领竞态（并发 sweep 单测：同 id 只成功一次）；cron 计算（DST 边界、`run_at` 过去时间）；`run_now`；工具权限默认 ask。

**文档同步**：新增 `doc/schedule.md` topic doc（机制、认领语义、at-least-once 决策、失效恢复），`doc/conventions.md` change map 加一行 "A schedule spec, sweep, or claim | `doc/schedule.md`"；产品文档新页；`doc/permissions.md` action 清单加 `schedule`；`CHANGELOG.md`。

---

## 7. 结果缓存 URI（P1）

**目标**：超大工具结果不占转录——截断点把全文存入会话级易失缓存，转录里只留短引用 URI；模型可用普通读取手段**惰性重取**。cline 参照：`session/services/tool-result-cache.ts`。

**现状**：`doc/context-economics.md` 管工具输出裁剪，超限部分直接丢失（模型只能重跑工具）。

**设计**：
- 新模块 `packages/core/src/session/result-cache.ts`：`Map<sessionID, Map<cacheID, { text, lastTouchedStep }>>`；容量上限 16 MB，会话内空闲 5 step 驱逐；跨 step 的"空闲"计数挂在 runner step 位置（实施时挂在 `runner/step.ts` 的收尾处）。
- 写侧：在现有裁剪发生处（实施第一步：从 `doc/context-economics.md` 记录的裁剪点定位，大概率 `runner/to-llm-message.ts`）改为：超阈值 → 全文入缓存，转录里放引用块：

  ```
  [Tool result too large to include: N chars. Re-fetch with read tool using path
  opencode://result-cache/<cacheID> if you need it again.]
  ```

- 读侧：`read` 工具（`tool/plugin/read.ts`）识别 `opencode://result-cache/` scheme → 查缓存返回原文；miss 返回：

  ```
  [Result cache miss: the cached output was evicted. Re-running read-only tools
  (read/grep/glob) is safe; DO NOT repeat side-effecting actions to recover output.]
  ```

- 权限：该 scheme 的 read 不触发 `read` 权限提示（内容本就来自本会话）；`external_directory` 语义不适用。
- 已知代价：引用块取代大文本会改变 prompt 前缀结构，可能影响 provider prompt cache 命中——但引用块只在"本来就会被截断"的结果上出现，净收益为正。记入 doc `Decisions`。

**实施步骤**：定位裁剪点 → 缓存模块（纯函数容量/驱逐逻辑独立可测）→ 写侧改接 → read 工具读侧 → token 字面值定稿。

**测试**：写-读回环；驱逐后 miss 消息；16MB 上限；跨 step 空闲驱逐；权限不弹。

**文档同步**：`doc/context-economics.md`（新小节 + URI token 字面值 + Decisions）；`CHANGELOG.md`。

---

## 8. 插件可靠性 v1 → 沙箱 v2（P1，分两个 PR）

**目标**：坏插件不能拖死服务进程。cline 参照：`extensions/plugin/plugin-sandbox.ts`（worker/subprocess 隔离、连续失败自动停用、超时、空闲回收）。

**现状**：fork 插件以 Effect 定义、**在服务进程内**执行（`packages/plugin/src/effect/*`，promise adapter 同进程）。

**v1（分支 `plugin-reliability`，约 1 周，无需沙箱）**：
- 每个 hook/工具调用包 `Effect.timeout`（超时常量起步，如 10s，注释写明为何）。
- 失败计数：per-plugin 连续失败 ≥5 → 自动停用 + 广播 `plugin.disabled` 事件 + UI 可见；调用成功清零。
- 停用状态持久到 KV（`packages/core/src/kv.ts`），重启不复活坏插件；用户显式重启用清零。

**v2（分支 `plugin-worker-sandbox`，2–3 周）**：
- Bun worker per plugin，structured-clone RPC；Effect 侧做 bridge（worker 里跑插件的 promise 形态，host 侧 Effect fiber 对接）。
- 实现前先确认 license 与借鉴深度（见开放决策点）；cline 的 bootstrap/RPC 协议设计可参照。
- 空闲回收（30min）+ 下次调用透明重启放 v2 尾部。

**测试**：v1——超时中断、连续失败停用、成功清零、重启持久；v2——崩溃隔离（worker 内死循环/抛错不影响宿主）、RPC 边界序列化。

**文档同步**：产品文档 plugins 页；`doc/conventions.md` change map 加 "Plugin host, sandboxing, failure policy" 行指向新 topic doc `doc/plugins-runtime.md`（v2 时建）。

---

## 9. 压缩细节对齐（P1，先验证后实现）

对 `session/compaction.ts` 逐项核对 cline 的四个细节，**缺才补**：

| 细节 | 验证点 | 预期结论 |
|---|---|---|
| 估算器兜底 | 触发判断是否只用字符估算；`SessionUsage` 已有上次实报 input tokens，可用 `max(估算, 实报)` 兜底防低估 | 大概率缺，补（小改） |
| 前缀 hash 失效校验 | cline 需要它是因为 JSON 转录可变；本 fork 事件 append-only + 投影重建 | **不适用**，在 doc Decisions 记"架构已解决" |
| 旧附件剥离 | 非最后 user 消息的 file/image part 是否原样进请求（`runner/to-llm-message.ts`）；是则置换为占位符，路径文本保留 | 验证后补 |
| 摘要含文件清单段 | 压缩摘要是否注入已编辑文件清单（可从 `file-mutation.ts` / git 状态取） | 验证后补 |

**工作量**：验证 0.5 天 + 实现 0.5–1.5 天。**文档**：`doc/context-economics.md` 逐项补记（含"不适用"结论及其原因）。

---

## 10. 快照恢复防御细节（P1，先验证后实现）

对照 cline `checkpoint-restore.ts` 的三个防御，检查 `packages/core/src/snapshot.ts`（capture/files/diff/restore）与 `session/revert.ts`：

1. **恢复事务性**：恢复动作本身失败时工作区不可丢——恢复前先捕获当前状态为回滚点。验证 fork restore 的失败路径是否有保护。
2. **HEAD 前移拒绝**：基点之后有新提交时拒绝恢复（而不是强退提交），用 `update-ref` CAS 关闭 check-then-reset 竞态。验证 fork restore 对基点漂移的行为。
3. **未跟踪文件快照成本**：cline 用持久 `GIT_INDEX_FILE` scratch index 让未跟踪文件快照 O(changed)。验证 fork capture 对大未跟踪集合的成本；可测瓶颈再做。
4. 运行编号跨压缩稳定：fork 的 revert 以 `messageID` 为界（事件溯源下 ID 稳定），**大概率已解决**，验证后记结论。

**工作量**：验证 1 天（写清每项结论）；实现 0–2 天视缺口。**文档**：结论进 `doc/session-loop.md` 或 snapshot 相关 topic doc 的 `Decisions`。

---

## 11. 路线图（P2，先立方向不展开设计）

- **Hub 生命周期**：drain（拒新工作、等 run 完成）→ upgrade（排水后重启）→ 协议版本不符时旧服务自动退役；事件流断线按单调序号续传（`replayEventsAfter`）。落点：`process-daemon` + `protocol`。
- **Zen 模式**：`-z` 派发即走（后台 session 5 秒确认后 TUI 退出，完成走 `Job` 通知）。依赖 #6 的 sweep 基建之外无新机制，纯产品化。
- **NDJSON 无头协议**：`opencode run --json` 每事件一行，文本渲染只是同事件流的另一 formatter；文档教 `jq` 取结果。落点：`packages/cli` + `protocol`。
- **MCP 进阶**：`mcp-remote` 代理自动改写原生 streamableHttp；stdio 连接双帧探测；关注 MCP Apps UI（`io.modelcontextprotocol/ui`）规范进展。落点：`packages/core/src/mcp/`。
- **Evals 指标**：pass@k / pass^k / 熵值 flakiness 纯函数计算器 + 失败模式分类。依赖真基准任务集，单独立项。

## 开放决策点（动手前需要拍板）

1. **cline 代码引入的 license 边界**：cline 仓库 LICENSE 待确认；即使兼容，也建议"机制参照、代码重写"，与本 fork 的 Effect 风格一致（本方案所有设计均按此写）。
2. **#6 的 sweep 归属**：常驻服务全局 sweep vs 每 Location 自扫。前者实现简单（单进程单 sweep），后者更贴 Location-scoped 模型。建议先全局 sweep + Location 键过滤，集群化时再拆（`session-loop` 的 process-local 先行原则同款取舍）。
3. **#6 的无人值守默认权限**：schedule 规格里 agent 权限是继承 config 默认还是强制从严。建议：规格未声明时沿用该 agent 的默认权限，但 `schedule` 工具本身默认 `ask` 已挡住 agent 自建；文档警示用户显式配 deny-*。
4. **#7 的阈值**：16 MB / 5 step 空闲是 cline 生产值，先照抄，`doc/context-economics.md` 记为可调常量而非配置。

## 里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| M1（第 1 周） | #1–#5，五个独立小 PR | 全部合入 dev，`bun run check` 绿，对应 doc 同 diff |
| M2（第 2–3 周） | #6 定时任务子系统 | 用户可用 Markdown 建 cron 任务；agent 经 `schedule` 工具（默认 ask）建任务；认领/恢复有测试 |
| M3（第 3–4 周） | #7 结果缓存 + #9/#10 验证与补齐 | 大输出会话的 context 占用下降可观测；验证结论全部落 doc |
| M4（其后） | #8 v1 → v2；P2 按需立项 | 坏插件不拖死服务；沙箱隔离有崩溃测试 |
