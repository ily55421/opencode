# Codewhale 借鉴技术方案(第 6 轮)

> 分析对象:`D:\code\github\Codewhale`(v0.10.2;原 deepseek-tui 自 v0.8.41 改名,社区项目;2026-01-20 起 13,812 提交,43 个 crate、1,488 个 `.rs` 文件,docs/ 80+ 篇)。
> 我方基线:工作树 `loop-reliability-docs`,`2.2.0-fork.10`。前五轮对象:codex / kimi / ZCode / adm(见 `优势对比清单.md`)/ goose(见 `goose-借鉴技术方案.md`)。
>
> **证据分级**:`实测` = 本轮我在我方树上跑命令核对;`对方实测` = 本轮针对 Codewhale 仓库读码核对(运行时/安全/扩展三个子系统分头读,承重符号逐个 grep 复核);`UNVERIFIED` = 搜索范围不足以断言。引用一律 `路径` + `符号名`,不写行号(纪律见 `doc/conventions.md`)。
>
> **本轮只做增量**:我方已有等价物的不推荐(§6 一次列清)、前五轮已推荐/已否决的不换皮重提(只做「相互印证」标注)。每项落地建议标注了与既有否决记录的相撞检查。

## 1. 先纠正四个想当然(对方实测)

| 想当然 | 实测结果 | 证据 |
| --- | --- | --- |
| Codewhale 是 DeepSeek 官方 CLI,代表 DeepSeek 的工程能力 | **不是**。社区单维护者项目(HunterBown),`deepseek-tui` 改名而来,与 DeepSeek 公司无关,只保留 DeepSeek 默认 provider 与 Harness 集成。看它的工程结论不需要给 DeepSeek 记功 | `docs/REBRAND.md`(TL;DR 给的是 `npm uninstall -g deepseek-tui`)、winget id `HunterBown.CodeWhale` |
| 它有 OS 级沙箱,我们要学 | **仅 macOS/Linux**(seatbelt / bubblewrap);Windows 上 `is_available()` 返回 false 且**有测试断言不宣称**(`assert!(!is_available())`)。对我们这条 Windows 日常树,沙箱本体依旧不学(第 5 轮已定),可学的是「不宣称」本身 | `crates/sandbox/src/windows.rs` 的 `is_available` + 测试;`crates/sandbox/src/policy.rs` 的 `get_writable_roots` |
| 80+ 篇文档是画饼蓝图 | **多数是实现**,且这个仓库会主动声明哪些没做:WORKROOM 两篇自述「持久化/端点/token 作用域未开始」并给 Phase 表;Model Lab、Skill Evaluation 自标 roadmap/方法论。文档自标成熟度是它最值得学的习惯之一 | `docs/WORKROOM_ARCHITECTURE.md`、`docs/MODEL_LAB.md`、`docs/SKILL_EVALUATION.md` 自述段 |
| Fleet 多代理是文档概念 | **真实且巨大**:`crates/tui/src/fleet/` 37,688 行租约/心跳/事件溯源;`crates/lane` 持久化运行实例 | `crates/tui/src/fleet/manager.rs` 的 `FleetManager`、`fleet/ledger.rs` 的 `FleetLedger`、`crates/lane/src/registry.rs` 的 `LaneRecord` |

一个背景事实:13,812 提交 ≈ 10 个月日均 45+,`docs/AGENT_ETHOS.md` + `docs/ISSUE_TRIAGE.md` 是一份完整的「用 agent 维护 agent 项目」治理规则(社区 PR 由 agent 预审但人保留合并权、贡献者信用机读化、`needs-info` 陈旧清理)。它同时也是 `优势对比清单.md` §3.3 里「文档与代码互相咬合」这条轴上目前最强的一个样本(回归测试名直接写进 `docs/AUTHORIZATION_ORDER.md`)。

## 2. 一句话结论

六个对象里与我方工程重心**同轴度最高**的一个(prompt-cache 经济学、错误归因、权限闭环、审计),但好消息是我方底子比预期好——第一轮候选里近一半实测后确认已有等价物(§6)。真正的缺口收敛为三组:**①权限闭环缺最后一环**(审批决定不留痕,审计回执无从谈起;指令零预算;技能列表零预算零冲突可见性);**②cache 只有读数没有归因**(cacheRead tokens 在记,但 miss 无具名、无漂移守卫);**③一揽子 UX 级小件**(MCP schema 确定化、对比度执法、自更新回滚等)。Meta 层最大资产不是某个机制而是两条纪律:**fail-closed 文化**(动态命令不匹配就拒、宪法解析不了就全 hold、探测不过就如实报 none、回执记不到就写 `not_recorded`)和 **「未知必须具名」**(`Known<T>` = Known \| Unknown(not_recorded|not_applicable|redacted),DTO 永不用默认值冒充事实)。

## 3. P0:低成本、本轮已核实我方确实没有

### 3.1 审批决定落盘 → /receipts 审计回执(权限闭环的最后一环)

- **对方**(对方实测):`crates/tui/src/approval_log.rs` 把每次审批写成两阶段(`Asked`/`Decided`)JSONL,记录 `decided_by: Option<ApprovalDecider>`;`ApprovalDecider::{User, SessionRule, Posture, Host}` 定义在 `crates/command-contract/src/facets/debug_receipts.rs`——**「没人可问」(`host`)永远不算「用户拒绝」**,四分归主。消费端 `crates/tui/src/receipts.rs` 的 `session_receipt()`/`classify()`/`tally()` 从既有记录确定性重建按序动作清单:改了哪些文件(±行数)、跑了哪些命令(exit code)、web/MCP 调用、`ran_without_asking` 计数(在哪种 posture 下)、**blocked ≠ failed ≠ not-run** 三分;渲染层 `crates/commands/src/diagnostics_reports/receipts.rs` 的 `render_markdown()`/`render_json_block()` 是纯函数,输出带 `codewhale.receipt/v1` schema 与 `claim_ceiling`(自声明「这是本地记录,不是安全认证」),记不到的进 `not_recorded`。三个 surface 共享一个 builder:`/receipts [json] [turn]`、`codewhale receipts <id|--last>`、`GET /v1/threads/{id}/receipt`。
- **我方**(实测):`packages/schema/src/permission.ts` 的 `Permission.Asked`/`Permission.Replied` 是 `ephemeral(...)`——**审批决定不落盘**;`packages/core/src/permission/saved.ts` 只持久化「always 存下的规则」,不留决定史。日志/usage 均无审批维度。`grep -rni receipt packages/core/src` 零命中。
- **落点**:①在 `packages/core/src/permission.ts` 的 ask/reply 路径落一条持久记录。相撞检查:Session Core 规则「durable events 最小化」——审批决定是**不可再生的基本事实**,但有两条实现路:把 `permission.asked/replied` 升级为 durable 事件(改事件词汇表),或由 permission 模块在决策点直写一张专用投影表(不动事件词汇)。**推荐后者**,与 `SessionEvent` 词汇解耦。②回执 builder 写成纯函数(输入投影记录,输出 markdown/JSON),先做 TUI 命令一个面。③「blocked」识别复用 `packages/core/src/shell/scan.ts` 已有的拒绝标记。④与既有优势的关系:这是我方唯一性优势「**升级优先于任何 allow**」(`packages/core/src/permission.ts` 注释)的自然证据面——升级规则是安全声明,回执是它的可审计性;`doc/permissions.md` 增补 Decisions。
- 与第 5 轮关系:goose 清单无此项。成本:中(投影 + builder 是纯函数;审批四分归主要在 reply 路径带上 decided_by)。

### 3.2 指令预算(全局/项目分开,trim 可见)

- **对方**(对方实测):`crates/config/src/instruction_budget.rs` —— `DEFAULT_SCOPE_BUDGET_TOKENS = 100_000`、`DEFAULT_SCOPE_BUDGET_PERCENT = 25`(各自不超过可用窗口 25%)、`DEFAULT_STATIC_PREFIX_GUARD_PERCENT = 80`、`InstructionBudgetPolicy`(含 `refuse`:超预算直接不发请求);每一次 trim/skip/refusal 都到达模型与 `/context report`,不是静默截断。
- **我方**(实测):`packages/core/src/instructions/`(builtins.ts + index.ts)与 `packages/core/src/session/context.ts` 的指令加载**零预算**——`grep -rni budget` 在 instructions/ 与 context.ts 均空。AGENTS.md 类文件多大都全量进 prompt,且「prompt 不是数据」(codex 轮 P1)意味着连裁剪的机制位置都没有。
- **落点**:`session/context.ts` 的 instructions 汇集处加预算核算;拒绝/裁剪要**让模型和用户都看得见**(对方把它做成 instruction 文件,而非静默切)。归属 `doc/context-economics.md`(它拥有 token 预算主题)。成本:低中。

### 3.3 技能列表预算 + 目录审计「不合并」

- **对方**(对方实测):预算侧 `crates/skills/src/lib.rs` 读 `listing_budget_fraction`(默认 5% 路由窗口)与 `listing_max_description_chars`(默认 400),共享父/子目录超出即缩短并告知;可见性侧 `crates/skills/src/audit.rs` 的 scan/precedence 状态机把 shadowed/duplicate/conflict **全部列出而非聪明合并**;`invocation: explicit-only` 技能零 ambient prompt 占用(`crates/skill-install/src/frontmatter.rs`);目录矩阵 fixture(`crates/skills/assets/skills-catalog-matrix.json`)与 `BUNDLED_SKILLS` 双射测试,自带包渲染不超预算是**可断言不变量**(「用户技能永不被静默挤掉」)。
- **我方**(实测):`packages/core/src/skill.ts` + `packages/core/src/config/plugin/skill-scan.ts` 有完整的技能系统与 `.claude`/`.agents` 兼容根(`compatibility.ts`),但 skill-scan 与 skill/instructions.ts 里 shadow/conflict/duplicate/precedence **零命中**——多根同名技能静默择一;技能清单无预算上限。
- **落点**:`skill/instructions.ts` 的清单渲染处加预算与超限披露;`skill-scan.ts` 输出 shadowing/duplicate 报告(至少进日志与 `/skills` 类查询)。成本低。归属:预算部分并入 `doc/context-economics.md`,盘点行为写进工具子树 `AGENTS.md`。
- 与第 5 轮关系:goose 清单没碰技能;不算重复。

### 3.4 MCP schema 字节确定化(canonicalize)

- **对方**(对方实测):`crates/models/src/schema_canonicalize.rs` 的 `canonicalize_schema` 递归排序 `required`/`dependentRequired`/所有对象键,使 MCP 重连后等价 schema 产出**字节恒等**——KV cache 杀手里最便宜的一个,「多数 agent 完全没做」。
- **我方**(实测):`packages/core/src/tool/mcp.ts` 把 `tool.inputSchema` 直接透传(`as JsonSchema.JsonSchema`),无排序。工具**数组**顺序我方是稳的(`packages/core/src/tool.ts` snapshot 里 definitions 按名排序——这条已有,§6),但每个 schema **内部**键序取决于 server 每次返回,server 升级/重连即漂移。
- **落点**:`tool/mcp.ts` 的 schema 接收边界处一个递归排序纯函数 + 测试。成本:极低。

### 3.5 特性注册表(features.toml 式)+ 漂移测试(含元测试)

- **对方**(对方实测):`docs/features.toml`(918 行)是唯一手工维护的用户特性清单,字段 id(永不复用)/status(stable|experimental|flagged|planned)/surfaces/since/flag/docs/owner;`crates/tui/tests/feature_registry.rs` 双向校验:每个 runtime feature flag 必须恰好有一行、行状态与 flag 默认值一致、docs/owner 路径存在、`since` 必须是 CHANGELOG 标题;还有 `feature_registry_checks_catch_drift` **用坏 fixture 验证检查器自己没退化**。
- **我方**(实测):`script/doc-refs.ts` 管「引用不能烂」(31 文档 158 路径进 CI),但「功能 ↔ 开关 ↔ 文档 ↔ CHANGELOG」的**存在性**没有登记面——功能删除后文档变成孤儿、flag 加了文档不知道,doc-refs 都测不出来。两者互补不重复。
- **落点**:根 `package.json` 的 check 链里加一个 `script/feature-registry.ts` + `doc/features.toml`(或并入 doc-refs 的扫描面);按 `AGENTS.md` 纪律,这条新约定写进 `doc/conventions.md` 的 change map 并在索引加一行。成本:低(数天)。

## 4. P1:中成本或需要产品决策

### 4.1 主题对比度执法(时机:Indigo 刚落地)

- **对方**(对方实测):`crates/palette/src/contrast.rs` 双重执法——绘制时 `enforce_contrast` 把文本 cell 拉到 4.5:1,另有逐主题审计 `theme_contrast_violations`;社区主题被**显式点名豁免**(`theme_uses_terminal_owned_surfaces`,豁免要带命名理由)。
- **我方**(实测):`packages/tui/src/theme/`(v1/resolve/assets)无 contrast 概念;而最近三个提交恰好是 `feat(ui): add the Indigo theme` + `feat(app): add a theme switch to the workspaces rail`——自定义/新增主题正是对比度回归的高发区。
- **落点**:TUI 侧做逐主题对比度审计测试(离线,先不接绘制 clamp);按 `AGENTS.md` 主题纪律,新 token 语义角色已守,补「对比度不达标需命名豁免」一条。成本:低中。

### 4.2 cache 漂移归因(与 codex 轮 P1「prompt 不是数据」合并推进)

- **对方**(对方实测):`crates/core/src/prefix_cache.rs` 的 `PrefixStabilityManager.check()` → `PrefixCheck::{Stable, Repinned, Drift}`,tools 按 **provider wire 序**序列化后 SHA-256;声明式变更记 `change:<what>` 并 re-pin,**未声明的 drift 记 `drift:<component>` 但保持原 pin**(`undeclared_drift_never_moves_the_pin` 测试);`<context_update>` 有界 line-diff 以 user 消息 append(80 行/6KB 上限)替代改历史;`/cache stats` 有 `Context updates: N`。
- **我方**(实测):cacheRead tokens 在记(`session_usage` 迁移 + `doc/usage-stats.md` 的折叠口径),但**没有归因**——miss 发生了不知道是哪段变的;`doc/context-economics.md` 只有估算与压缩预算。codex 轮的「prompt 不是数据」(WorldStateSection/render_diff/Placement)与对方这套是同一主题的两种深度:对方轻(指纹+归因+append),codex 重(全节 diff)。**建议先落对方的指纹+归因层**,它不改 prompt 组织方式,与 codex 方案不冲突。
- **落点**:`session/model-request.ts` 组装请求处做指纹;`doc/context-economics.md` 增「cache 归因」节。成本:中。

### 4.3 mid-turn 权限收窄:等宽或更宽才存活

- **对方**(对方实测):`crates/tui/src/core/engine.rs` 的 `LiveRuntimeAuthority` + `narrows(prior)`——posture 是**可比较偏序**(Never<Suggest<Auto<Bypass);turn 运行中改模式不重启流式响应,在下一工具批/审批门生效;**已批准的调用仅在新 posture 等宽或更宽时存活**,否则以 typed 错误退回模型在新 posture 重试;`approval_survives = approval_stamp.is_some() && !narrows(posture_before_drain)` 注释原文 "approving must never invalidate the call it approves";子代理每次调用**重读实时 posture** 而非 spawn 时快照;posture 收窄时丢弃 REPL/RLM kernel。
- **我方**(实测):TUI 权限态是 `prompt | autoaccept` 二值(`packages/tui/src/context/permission.tsx`),session 级,无 mid-turn 切换与偏序语义。`doc/permissions.md` 拥有该主题,扩展是加法。
- **成本**:中。前提是把我方权限态收敛成可比较结构(与 codex 轮 P0「决策代数」天然同构,建议一个 PR 里一起设计)。

### 4.4 保存 allow 规则的形状收紧

- **对方**(对方实测):`crates/tui/src/tui/approval/ask_rules.rs` 的 `build_persistent_allow_rules()`——只有 `SafetyLevel::Safe|WorkspaceSafe` 的命令允许保存为持久 allow,且强制 `command_exact=true` + workspace 限定;Critical 与 repo-law 提示**永远不给「保存 allow」**。
- **我方**(实测):已有两道防线——`packages/core/src/shell/danger.ts` 的 `BANNED_SAVE` 清空危险包装的 save 列表(清单已含解释器类);`packages/tui/src/util/permission.ts` 保存前展示 patterns 预览。缺口:**没有风险分级**——不在 BANNED_SAVE 名单里的中危命令仍可保存为通配 patterns。
- **落点**:`shell/danger.ts` 旁边补一个 `SafetyLevel` 分级(复用现有 scan 结果),BANNED_SAVE 之外的中危降到「仅 once」。成本低。归属 `doc/permissions.md`。

### 4.5 子进程环境白名单(带行为风险,需要默认开关讨论)

- **对方**(对方实测):`crates/runtime/src/child_env.rs` 的 `sanitized_child_env()`——本地 shell 子进程**不继承环境**,只取白名单(PATH/HOME/TERM/代理/工具链等,Windows 另走注册表补全),凭据注入走显式 `shell_env` 钩子且审计只记键名;MCP 启动用**更宽的**独立白名单(文件里注释写明两套契约)。
- **我方**(实测):`packages/util/src/cross-spawn-spawner.ts` 的 `opts.extendEnv ? { ...globalThis.process.env, ...opts.env } : opts.env` —— 默认全量继承。终端里 export 的 API key 会进 agent 跑的每条命令的 env(也进 MCP 子进程;第 5 轮 goose 3.5 的 MCP env 黑名单是**另一层**,管的是注入向量,这条管的是泄出)。
- **风险如实说**:这是行为级改动,Windows 用户可能依赖终端 env 里的工具链配置;对方敢默认白名单是因为有 `shell_env` 钩子做显式逃生口。我方建议:先做**审计面**(工具结果/日志里对 env 做凭证形状脱敏,见 4.6),白名单做成默认关的 experimental 开关跑一段时间再定默认。成本:中。

### 4.6 双策略脱敏(日志宁可误杀、模型文本只杀凭证形状)

- **对方**(对方实测):`crates/sanitize/src/redact.rs` 的 `RedactionPolicy::KeyBased`(日志/导出:敏感键整行抹)vs `CredentialShaped`(模型绑定文本:只抹长得像凭证的值——`sk-/ghp_/xoxb-`、JWT、Bearer、PEM;`password: credentials?.password` 这类**代码**保持逐字节可引用,因为模型要做精确匹配编辑)。
- **我方**(实测):只有导出面有脱敏(`packages/core/src/session/transfer.ts` 的 `sanitize()` 抹 title/metadata),凭证形状脱敏零实现。
- **落点**:`packages/util` 新增纯函数脱敏器;第一个消费者是 3.1 的回执 builder(对方就是这么做复用的)与工具输出落盘路径。成本低。注意与第 5 轮「MCP 子进程卫生」相互独立,不重复。

### 4.7 错误字符串兜底分类的决策表(小)

- **对方**(对方实测):`crates/error-taxonomy/src/lib.rs` 的 `classify_error_message` 是**决策表级**关键词分类器:rate-limit 词胜过 auth 词(429 正文带 "Invalid API key" → RateLimit,重试语义才正确)、`mentions_http_status` 只认独立 "HTTP 429" token(URL/ID 数字不误判)、402 → RateLimit 但 `recoverable=false`、504 → Timeout 而非 Network。typed 优先:`envelope_for_llm_error` 先 downcast 保留原文,防字符串二次分类降级。
- **我方**(实测):`packages/core/src/session/to-session-error.ts` 是 typed-first(`AIError.reason._tag` switch),与对方设计同构;未知字符串落到 generic providerError,无兜底分类表。对方那组反误判测试用例(429-in-URL、402、504)可以**直接搬走**当测试数据。
- **落点**:`to-session-error.ts` 的 fallthrough 分支前加一层保守分类(只影响重试延迟与展示,不改变 typed 路径)。成本低。

### 4.8 自更新:后台下载 + 下次启动应用 + 回滚

- **对方**(对方实测):`crates/release/src/autoupdate.rs` —— 后台下载校验、下次启动应用(永不 session 中途)、`previous_dir()` 保存被替换二进制、`codewhale update --rollback` 换回;未签名 release 下载需确认,Ed25519 签名的自动应用。
- **我方**(实测):`packages/cli/src/services/updater.ts` 是前台升级(method 检测 + spinner),无后台/无回滚。fork 已有「版本后缀永不等于上游最新」的更新信号问题,回滚能力是真实刚需(第 5 轮 goose 清单外的空白)。
- **成本**:中。归属:根 README 的 Local Release Builds 约定更新。

## 5. P2/大件:不建议本轮动手,但值得记账

| 项 | 对方证据 | 说明与相撞检查 |
| --- | --- | --- |
| **shell_expand 语义展开** | `crates/execpolicy/src/shell_expand.rs`(2,448 行):`expand_command`/`expanded_commands` 把命令展开成「shell 真会执行的每一条」(命令替换体、`bash -c` 载荷、引号剥离、链段)逐条匹配 deny;展开不了的标 `Expansion::dynamic`,配置了 deny 规则即 fail-closed | 行业通病(字符串白名单必被引号/替换绕过)的正确解。高成本,但可做子集(引号剥离 + `-c` 载荷 + 链段)融入 `packages/core/src/shell/`。与 codex 轮 P0「决策代数」同属权限轴,建议第 7 轮一起设计 |
| **Guardian/Auto-Review 熔断三件套** | `crates/tui/src/core/authority/auto_review.rs` 的确定性底线(隐藏 Unicode 拒绝、publish 词分析、`NameStakes` 工具名词干风险)+ `engine/reviewer.rs` 的 `consult_reviewer()`(无状态、只看精确调用、90s、fail-closed、3 连续/50 内 10 次熔断)+ `engine/dispatch.rs` 的 `FleetDenialGuard`(拒绝阶梯,read 内容 SHA 判「无新证据」) | 我方无 Auto 档。若 fork 要做 autoaccept 以外的自动档,这套「确定性地板先行 + 一击式模型复核 + 熔断」是现成蓝图;对方明确**不**复制 transcript 重建上下文(与 codex guardian 相反),防「模型脑补授权」 |
| **path-scoped 撤销** | `crates/snapshot/src/repo.rs` 的 `restore_path_plan(_with_backup)`/`path_matches_snapshot`、`snapshot_owners()`(只认本会话标签)、`wait_for_pending_post_turn_snapshots()`(竞态 #6644) | 我方已有消息级 revert + 快照恢复(`packages/core/src/session.ts` 的 `revert.stage({files})`,`packages/core/src/git.ts` 的 snapshot side-repo)。delta 是精细语义:只恢复「该请求改的且未被动过的路径」(不吃掉用户手工编辑)、恢复前备份 + preflight 复验。值得做但不紧迫 |
| **steering 打断 in-flight 请求** | `crates/tui/src/core/engine/handle.rs` 的 `PendingSteer`/`SteerVerdict`、`model_step.rs` 的 open 阶段 `select!` 抢占、`steered_before_stream` receipt;RUNTIME_API 的 delivered(200)/dropped(409 可重发)/pending 三态 | **相撞检查**:我方 `doc/session-loop.md` 明确「steer 在安全 step 边界交付」是设计决定,不是缺失。对方的中途抢占省等待但烧已流出 token(它自己也要保留 partial text、丢弃 reasoning)。除非实际使用中「边界等待」成为痛点,否则不改设计;若要改,需走 `doc/session-loop.md` 的 Decisions 流程 |
| **Fleet 身份/权限分离** | `crates/agent-contract/src/worker_profile.rs` 的 `ChildGrant::resolve`(角色 preset 与 profile 取 min 单调收窄)、fleet 文件里的权限字段**新建 run 时拒绝继承** | 我方子代理权限继承较简。等 fork 出现多代理/并行 worker 需求再借;现在抄是过度设计 |
| **QuickJS 确定性工作流** | `crates/workflow-js/src/vm.rs`(`VmLimits` 32MiB)、`driver.rs`;`Date`/`Math.random` 被覆盖为抛错以保重放 | 我方无工作流系统(第 5 轮 goose 也把 recipes+cron 列为空白)。只记机制:编排脚本去时间/去随机才能 diff/重放;真做工作流时借,不为本条建系统 |
| **`# ` 快速记忆 + native memory** | `crates/runtime/src/native_memory.rs` 的 `NativeMemoryStore`、`crates/tui/src/tui/ui.rs` 的 `is_memory_quick_add`(`#` 前缀拦截**不发模型 turn**)、注入块标记为不可信数据 | 我方无用户记忆功能(实测 `environment/memory.ts` 是内存 FS driver,无关)。产品空白区,借鉴点集中在三处:`#` 不烧 turn、FTS5 可重建索引、注入标记不可信。要不要做记忆是产品决策 |

## 6. 明确不推荐:本轮实测确认我方已有等价物

| 对方机制 | 我方等价物(实测) |
| --- | --- |
| 预算耗尽的「最后一轮报告」+ `tool_choice="none"` 保留工具字节(A2) | `packages/core/src/session/runner/llm.ts` 的 `MAX_STEPS_PROMPT`(要求文本-only 总结/剩余/建议)+ `toolChoice: stepLimitReached ? "none" : undefined`,旁边注释原话 "Keep tool definitions on the final Step to preserve the provider's cached prefix" —— **一字不差同款** |
| 压缩触发的「实报账单 + 增量估算」双轨(`input_token_ratio` 校准,#5577) | `packages/core/src/session/compaction.ts` 的 `Estimate = { measured: provider 实报, estimated: 其后文本 }` |
| 大输出落盘(spill + head/tail + 7 天修剪) | `packages/core/src/tool-output.ts` 的截断 + `[showing … full output saved to …]` 标记 + `FileRetention.cleanup` |
| 长度截断续跑 + 断路器(`on_output_limit`) | `runner/llm.ts` 的 `CONTINUE_AFTER_OUTPUT_LIMIT` 合成消息 + 连续 3 次 `finish === "length"` → `StepFailedError("output-limit")`;`runner/publish-llm-event.ts` 对 length 截断的工具入参有专门失败文案。对方的 `[reasoning_only] on_output_limit` 是我方已有行为的配置化子集 |
| 工具目录头排序稳定 | `packages/core/src/tool.ts` snapshot 的 definitions 按名排序(对方 invariant 同款) |
| 幻觉工具「具名失败,绝不合成调用」 | `runner/publish-llm-event.ts` 已有 Unknown tool/length 专门处理;对方 `ProviderToolCallMissing` 是**第三家**独立印证(第 5 轮 goose 3.2 的三件套推荐继续有效) |
| 保存规则前预览将保存的 patterns | `packages/tui/src/util/permission.ts` 的 "This will always allow the following patterns…" 预览 |
| 「always」批量重评并行待批 | `packages/core/src/permission.ts` reply "always" 后循环重评同 session 其余 pending,允许则批量放行(对方无此粒度) |
| 错误 typed-first | `to-session-error.ts` 的 `_tag` switch(对方 `envelope_for_llm_error` 同构) |
| 技能/指令兼容根 | `packages/core/src/config/plugin/compatibility.ts` 已读 `.claude`/`.agents` 的 skills(对方 CLAUDE_PLUGIN_COMPAT 的子集已在我方) |
| 沙箱本体 | 第 5 轮已定不学;对方 Windows 也无(本轮 `crates/sandbox/src/windows.rs` 实测再证) |
| PET_MODE、云派发/GitHub App、DingTalk bridge、HarmonyOS/Termux、语音、read_media、插件 marketplace 四格式解析器 | 产品面,与我方 fork 定位无交集;marketplace 解析器在有插件生态诉求时再看 |

## 7. 附:复核命令

我方事实(在 `D:\code\opencode`):

```sh
# 审批不留痕(3.1)
grep -n "ephemeral" packages/schema/src/permission.ts                      # Asked/Replied 均 ephemeral
grep -rn -i "receipt" packages/core/src --include=*.ts                     # 零命中
# 指令零预算(3.2)
grep -rn -i "budget" packages/core/src/instructions/ packages/core/src/session/context.ts   # 空
# 技能无冲突可见性(3.3)
grep -rn -i "shadow\|conflict\|duplicate" packages/core/src/config/plugin/skill-scan.ts packages/core/src/skill/instructions.ts   # 空
# MCP schema 透传(3.4)
grep -n "inputSchema" packages/core/src/tool/mcp.ts
# 工具定义按名排序 + final step 保字节(§6)
grep -n -A2 "Array.from(direct)" packages/core/src/tool.ts
grep -n -B1 -A2 "stepLimitReached" packages/core/src/session/runner/llm.ts
# 压缩双轨估算(§6)
sed -n '58,64p' packages/core/src/session/compaction.ts
# 主题无对比度(4.1)
grep -rn -i "contrast" packages/tui/src/theme/ | wc -l                     # 0
# 子进程 env 全量继承(4.5)
sed -n '132,134p' packages/util/src/cross-spawn-spawner.ts
# 权限二值态(4.3)
sed -n '10,21p' packages/tui/src/context/permission.tsx
```

对方事实(在 `D:\code\github\Codewhale`):

```sh
# 回执与审批归主(3.1)
grep -n "decided_by" crates/tui/src/approval_log.rs | head -3
grep -n "pub enum ApprovalDecider" crates/command-contract/src/facets/debug_receipts.rs
ls crates/tui/src/receipts.rs crates/commands/src/diagnostics_reports/receipts.rs
# 指令预算常量(3.2)
grep -n "DEFAULT_SCOPE_BUDGET_TOKENS\|DEFAULT_SCOPE_BUDGET_PERCENT\|DEFAULT_STATIC_PREFIX_GUARD" crates/config/src/instruction_budget.rs
# 技能预算与注册表测试(3.3/3.5)
grep -n "listing_budget_fraction" crates/skills/src/lib.rs | head -2
wc -l docs/features.toml && grep -n "feature_registry_matches_code\|feature_registry_checks_catch_drift" crates/tui/tests/feature_registry.rs
# MCP schema 确定化(3.4)
ls crates/models/src/schema_canonicalize.rs
# shell 展开 dynamic fail-closed(P2)
grep -n "pub fn expand_command\|pub fn expanded_commands\|pub dynamic" crates/execpolicy/src/shell_expand.rs
# Windows 沙箱不宣称(§1)
sed -n '30,62p' crates/sandbox/src/windows.rs
# 自更新回滚(4.8)
grep -n "previous_dir\|rollback" crates/release/src/autoupdate.rs | head -5
```
