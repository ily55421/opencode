# 借鉴技术方案（cline + gemini-cli + goose + aider + codewhale 合并稿）

合并六份输入为**唯一执行清单**：`cline-借鉴技术方案.md`（11 项）、`gemini-cli-技术方案.md`（G1–G5）、`goose-借鉴技术方案.md`（P0 六 + P1 七 + 实践六）、`aider-借鉴技术方案.md`（P0 四 + P1 五 + 实践七）、`codewhale-借鉴技术方案.md`（P0 五 + P1 八 + P2 七 + 已有等价物十三），以及 `doc/context-economics.md`（上下文经济学活文档，本稿用它**裁决**方案，见 §0.2）。

- 生成日期：2026-10-31（并入 codewhale 轮）。基线：分支 `loop-reliability-docs`，HEAD `81738639df`，`2.2.0-fork.10`。文件名仍叫 `cline-gemini` 是历史遗留，改名见 §8 决策点 8。
- **本稿只做方案，未改任何代码。** 每个里程碑独立 PR 粒度，含测试与 doc 同步要求。**本稿自足**：任何一项的判据、落点、测试、doc 归属都在这里，不引用任何已失效的版本。
- 证据分级沿用 `优势对比清单.md`：`实测` = 本工作树跑命令核对；`对方实测` = 直接读过对方文件；`对方实测（X 轮）`= 那一轮作者核对、本轮我只核了我方侧；`子代理` = 未复核；`UNVERIFIED` = 范围不足。
- 亲测的对方承重符号：goose 四个（`DEFAULT_STOP_HOOK_BLOCK_CAP = 8`、`MAX_EMPTY_RESPONSE_RETRIES = 3`、`collapse_const_unions`、"Stable tool ordering" 注释）、aider 四个（`AIDER_DOCKER`、`num_malformed_responses`/`max_reflections`/`reflected_message`、`auto_env_var_prefix`/`MarkdownHelpFormatter`）、codewhale 八个文件存在 + 四个符号命中（`ApprovalDecider`、`DEFAULT_SCOPE_BUDGET*`、`feature_registry_checks_catch_drift`、`undeclared_drift_never_moves_the_pin`）。**cline / aider / codewhale 的实现体未逐行读**，只核了文件与符号存在；§10 末尾列明需精读处。
- 合并共 **25 条裁决**：**6 处推翻原稿前提**（C5、C6、C9、C17、C18、C22）、**2 处推翻本稿自己早先的判断**（C21 的 L17 第二维、C24 的「manifest 保鲜已立项」）、**2 处把 UNVERIFIED settled**（C13、C23）、**4 处把两份以上原稿的同域项并成一项**（C8/C20、C10、C16、C26）。

一条贯穿性纪律：**「未知必须具名」**——三个来源独立给出同一形状：codex 的 `TurnCriticalPath::{Disabled, Incomplete, Complete}`「宁标 Incomplete 不编 0」、本仓 `doc/usage-stats.md` 把无日期的 compaction 用量**排除在日聚合外**而不是摊派、codewhale 的 `Known<T> = Known | Unknown(not_recorded | not_applicable | redacted)` 且 DTO 永不用默认值冒充事实。本稿凡涉及"记不到"的路径（L31 回执、L25 保活、L26 验证回喂、L34 归因）都按这条写。

---

## 0. 合并规则

### 0.1 五份原稿的处置

本稿取代五者作为执行入口。**原稿暂不删除**（不是我建的，删除不可逆且会丢掉对方侧的路径证据）；确认可删后再删，或在五份原稿顶部各加一行指向本稿。

### 0.2 `doc/context-economics.md` 不被并进本稿

它是 `doc/` 的**活文档**（`doc/conventions.md`：活文档随行为改写，records/方案是历史记录、永不改写），并被根 `AGENTS.md` 索引。并进方案会同时踩三条线：改掉活文档的归属、让 `bun script/doc-refs.ts` 报 orphan、把"当前机制"和"待办"混在一份文件里。

方向是反过来的：**每个动到上下文/裁剪/压缩/缓存/预算的项，落地时在 `doc/context-economics.md` 同 diff 内补一节 + 一条 `Decisions`**。本稿 §5（L6）、§3.4（L32）、§4（L25/L28/L29/L34）都这么规定，并逐条标明与文档里**已写下的否决**是否冲突——这是合并最有价值的产出：五份原稿各自至少有 2 项在重新提出已被否决的设计（C5、C6、C14、C19），3 项把"已存在但没接线"读成"不存在"（C9、C17、C21）。

goose、aider、codewhale 三轮已自带「相撞检查」与「已有等价物」清单，本稿把它升格为**跨源裁决**：同一条否决，一份原稿撞上可能是误读，五份都绕开才算真约束。

---

## 1. 冲突裁决（必须先读）

| # | 冲突 | 裁决 | 依据 |
| --- | --- | --- | --- |
| **C1** | 循环/熔断状态存哪：cline #1 进程内 `Map`；gemini G1 环形缓冲 | **取 durable fold** | `doc/session-loop.md` 的 `Decisions` 已点名否决 `Map<SessionID, number>`（"a location reload or restart clears it and the loop loses its own limit, which turns a bounded retry into an unbounded spend"）；`doc/records/2026-10-todo-completion-nudge.md` 同样否决。kimi 是进程内 `Map` 且 key 无 `.replayable(...)`。**goose、aider、codewhale 都站对了边**：阻断计数进消息 metadata（`DENIED`）、畸形计数进结果文件、审批两阶段进 JSONL——六个来源三错三对 |
| **C2** | 打断反应：#1 在 `execute.before` 拒绝；G1 发 synthetic notice | **取 #1 的拒绝形状 + G1 的升级收束** | `实测` `packages/plugin/src/effect/tool.ts`「Only execute.before may fail: a Tool.Error rejects the call before the tool runs」；`plugin/plan.ts` 有 `BlockedError → ToolFailure` 先例；`tool-input-repair.ts` 已在用同一 seam |
| **C3** | 判据强度：#1 连击 vs gemini 周期 `k ∈ 1..5` | **取周期判据**，连击是 `k=1` 特例 | `对方实测` `TOOL_CALL_LOOP_THRESHOLD = 5`、`maxRequiredLength = 5*5 = 25`、`slice(-k)`/`expectedKey = cycle[i % k]` |
| **C4** | **两来源同一缺陷**：键里没有结果 | **新增要求：结果参与键** | gemini 的 prompt 原文承认「only a loop if the arguments **and outcomes** are substantively identical」，确定性层键却是 `sha256(name+args)`；cline #1 文案自称 "returned the same result"，signature 里没有。三家说要做、两家没做。不补必然误伤轮询 |
| **C5** | cline #7 写「超限部分直接丢失（模型只能重跑工具）」 | **撤下 #7 实现，需求由 L6.2 满足** | `实测` `tool-output.ts` 的 `DIRECTORY`/`RETENTION = 7 天`/`RECORD` 记 `{truncated, outputPath}`。goose 轮独立佐证（其 `DEFAULT_LARGE_TEXT_THRESHOLD = 200_000` 只溢写）、codewhale 轮第三次佐证（§6 把"大输出落盘 + head/tail + 7 天修剪"列为我方已有）。#7 的 16 MB / 5 step 内存缓存严格弱于既有磁盘 spill |
| **C6** | cline #9「估算器兜底 `max(估算, 实报)`」 | **无操作，撤下** | `doc/context-economics.md`：measured anchor 前缀 + estimated 尾；历史单调增长 ⇒ 上次实报必然更小 ⇒ `max()` 恒取估算。该文档已否决邻近想法（"a scale would only sharpen the tail — the part that is short by construction"）。codewhale §6 又把"实报账单 + 增量估算双轨"列为我方已有——同一结论三个来源 |
| **C7** | 开关：#1 不加配置默认开 vs G1 `experimental.loop_guard` 默认关 | **决策点 §8.1**，建议常量阈值 + 保留开关**默认开**，前提 `poll-is-not-a-loop` 同 PR | `AGENTS.md` 反投机 flag；系列惯例要求高风险默认值先有量具。风险由 C4 的键形状消解 |
| **C8** | cline §11 pass^k/熵值 与 gemini G4 | **合并为 L7** | goose 轮补对照组事实（`evals/harbor/` 把 opencode 当 benchmark）；aider 轮补最后一跳（C20） |
| **C9** | **goose §3.1 高估我方缺口**（"未见等价归一化"） | **范围收窄**：inlining 已做，缺 const-union → enum 折叠 | `实测` `tool/runtime.ts` 注释「emit `$ref` plus root `$defs`; inline acyclic local references so providers receive the full nested schema directly, then remove unused `$defs`. Recursive references stay intact」 |
| **C10** | **同一子系统两份设计**：cline #6 定时任务 vs goose §4.6 recipes+cron | **并项 L9**：架构取 cline，作者面与防篡改取 goose。**拒绝 goose 的「执行时强制 Auto」** | goose §4.6/§4.2 原文；`优势对比清单.md` §3.1 实测的 `escalation outranks every allow rule, a saved "always allow" included`。codewhale §5 的 QuickJS 工作流（覆盖 `Date`/`Math.random` 以保重放）记入 L9 的机制约束，不另立项 |
| **C11** | goose §4.7 与 L1 同域 | **并入 L1 作第三类计数器** + 单列 L22；`DEFAULT_STOP_HOOK_BLOCK_CAP = 8` 为 `实测` | goose `ops_stop_hook.rs`/`services.rs` |
| **C12** | goose §3.6 cache 确定性纪律 vs §5 的 cache 论证 | **升格为 L6 与 L25 的共同前置（L17）**，立可测纪律「同一 turn 内两次请求前缀字节必须一致」 | `实测` `model-request.ts` 无 `Date.now`/`toISOString`。codewhale 的 `prefix_cache.rs`（C21/C34）给这条纪律配上**归因**，两者是一对象的两半 |
| **C13** | goose §3.3 空响应重试标 `UNVERIFIED` | **settled：缺口真实**，我方只覆盖「finish reason 未知」 | `实测` `runner/step.ts` 构造 `InvalidProviderOutputError({message: "The provider response ended with an unknown finish reason.", classification: "incomplete-stream"})`，`llm.ts` 的续跑只由该 classification 触发 |
| **C14** | goose 的 `never > always > ask` 折叠 | **折叠语义不抄**，只借存储粒度 | goose 自标相撞，引 `doc/records/2026-10-permission-fold-ordering.md`。与 C1 是同一纪律的两例 |
| **C15** | cline #2 与 codex M1 的威胁模型口径 | **对齐 codex M1**：权限层是**行为护栏不是安全边界**，别顺手加安全假设 | `codex-技术方案.md` M1/M3 + `SECURITY.md` 的 No Sandbox。goose 轮补：goose 本身无 OS 沙箱；aider 轮补：aider 的 `.env` 保护只在提交侧，读侧保护反而我方有（`RISKY_READS = ["*.env*"]`，auto 下 `read *.env*` 仍 `ask`）；codewhale 轮第三证：其沙箱**仅 macOS/Linux**，Windows 上 `is_available()` 返回 false 且**有测试断言不宣称**——可学的是"探测不过就如实报 none"，不是沙箱本体 |
| **C16** | aider §3.3「畸形产出计数」与 L1 同域但判据不同 | **并入 L1 作第四类计数器**，共用 fold 骨架与「上限必须可见」纪律，不分叉实现 | `实测` 格式判定很硬但无计数：`runner/publish-llm-event.ts` 有 `InputFailureReason`、`failMalformedToolInput`、`INPUT_EXCERPT_LIMIT`（8 处命中），`grep -rn "malformedCount" packages/core/src` 零命中。aider 自己写了"两者应共用同一个 fold 骨架"。codewhale §6 再补印证（幻觉调用"具名失败、绝不合成调用"我方已有）——**计数要有具名事件可数**，否则只能数文案 |
| **C17** | **aider §3.4 前提错**：称 `config.json` "找不到生成器"，列为头号立即项 | **结论保留、事实修正、成本从"写"降为"接线 + 加闸门"**：生成器存在但**没有仓库级脚本或 workflow 调它** | `实测` `packages/schema/script/config-schema.ts`（从 `Config.Info` 生成、`$id: "https://opencode.ai/config.json"`、V1/V2 合并、重名即 `throw`）；`实测` 唯一引用点是 `packages/console/app/package.json` 的 `build`，产物写进站点目录。`实测` `config.mdx` 至今未收录 `compaction.keep.tokens`——漂移有实物 |
| **C18** | **aider §4.1 前提部分错**：称「侧任务全部跟主模型」 | **修正后收窄起步点**：标题已走 small model，缺的是 `compaction` 等用途维度；aider 的"先做 title 验证形状"已被现状取代 | `实测` `session/context.ts` 调 `model.small(primary.ref.providerID)`（符号在 `model.ts` 的 `Model.small`）；`实测` `compaction.ts` 的 `selectModel` 走 `.resolve({ ...context.session, model: agent.model }, ...)` |
| **C19** | aider §4.3 建议用预算二分**替换** `SHRINK_STEPS` | **不替换，两者不是同一问题**：`SHRINK_STEPS` 是被拒之后往下缩（输入"被拒字节数"），二分是事前按预算逼近（输入"有序条目 + 预算"）。正确客户见 L32/L18/L9 | `doc/context-economics.md` 的 `SHRINK_STEPS` 定义与"学习比率"否决记录 |
| **C20** | aider §4.5「结论编译回行为位」接手 goose §7.5「台账值得记住但不算行动项」 | **接手立项，并入 L7 第二阶段**，附硬约束：**不执行未经审的 LLM 产出物**（aider 的 `benchmark.py` 无 `AIDER_DOCKER` 时**拒绝运行**，`实测`） | `实测` 行为位载体已存在：`packages/schema/src/model-compatibility.ts`（`reasoningField`/`requireReasoning`/`maxTokensField`/`requireFinishReason`/`requireAssistantAfterTool`/`supportsPromptCacheKey`/`cacheFormat`/`mediaInput`）。加字段便宜，**贵的是产生填它的证据** |
| **C21** | **本稿自己的 L17 第二维判断不成立**：原写「工具序是否跨请求稳定未做专项核对」 | **自我更正：那一维已有**。L17 收窄为「时间戳/前缀字节维度 + 建立可测断言」，另一半交给 L34 | `实测` `packages/core/src/tool.ts` 的 `Array.from(direct).sort(([l],[r]) => …)`——snapshot 的工具定义**按名排序**；`实测` `runner/llm.ts` 注释原文 "Keep tool definitions on the final Step to preserve the provider's cached prefix." 与 `toolChoice: stepLimitReached ? "none" : undefined` 同处。codewhale §6 两条都列为我方已有，核对无误 |
| **C22** | **codewhale §3.4 是真缺口，且 C21 的"已有"恰好掩盖了它**：数组序稳 ≠ 每个 schema 内部键序稳 | **新增 L30（成本最低）**：MCP 的 `inputSchema` 裸透传，server 升级/重连即字节漂移 | `实测` `packages/core/src/tool/mcp.ts`：`input: (tool.inputSchema ?? {…}) as JsonSchema.JsonSchema`，无排序。对方形状 `crates/models/src/schema_canonicalize.rs` 的 `canonicalize_schema` 递归排序 `required`/`dependentRequired`/所有对象键（`对方实测`） |
| **C23** | **codewhale §3.1 审批决定不落盘**，与 Session Core「durable events 最小化」相撞 | **settled 缺口真实，且推荐不动事件词汇的实现路**：permission 在决策点直写专用投影表，而不是把 `permission.asked/replied` 升级为 durable 事件 | `实测` `packages/schema/src/permission.ts` 的 `Asked`/`Replied` 均 `ephemeral(...)`；`实测` `grep -rn -i receipt packages/core/src` 零命中。审批决定确属"不可再生的基本事实"，但事件词汇与投影表是两条路——后者与 `SessionEvent` 解耦，不需给每条决定新增聚合语义 |
| **C24** | **本稿原先「manifest 保鲜已归 kimi 第 6 项」的撤下理由过粗**：一次撤掉了三个不同产出物 | **自我更正并分层**：防腐是三层工作流，互不覆盖——① 配置 schema **接线**（L27）；② 协议**路由清单快照**（kimi 第 6 项第二条：我方有 2.3 万行 `openapi.json` 但没钉住路由集合本身）；③ **特性注册表 + 元测试**（新 L33）。三层合成一个 PR 组 | kimi 清单第四章 §4.3 的**反面证据**是关键：kimi 自己的 `check-service-naming.mjs` 全仓零引用、目标目录 `packages/services` 已删——**没被测试的检查器会腐化**。codewhale 的 `feature_registry_checks_catch_drift`（坏 fixture 验证检查器没退化）正是对那条腐化的免疫，所以元测试不是锦上添花而是入场券 |
| **C25** | codewhale §5 的 steering 中途抢占（`select!` 抢 open 阶段）与「边界等待」 | **不改设计**。我方「steer 在安全 step 边界交付」是写下的决定，不是缺失；对方自己也承认中途抢占烧已流出 token、要保留 partial text 并丢弃 reasoning | `AGENTS.md` 的「Keep delivery vocabulary explicit」+ `doc/session-loop.md` 的 delivery 节。若要改必须走 `doc/session-loop.md` 的 Decisions 流程，且只有当"边界等待"成为实测痛点 |

**另有四处同源并项**：goose §4.5 摘要格式并入 **L8**；goose §4.1 子代理五件套与 codex M4 同域列为 **L20**；codewhale §4.3/§4.4（mid-turn 偏序、`SafetyLevel` 分级）与 goose §4.3 的存储粒度并成 **L21 权限演进包**；codewhale §6 的十三项「已有等价物」与 aider/goose 的撤下项一并收进 §9，作用是**阻止后续轮次把它们当缺口重提**。

---

## 2. 统一总览

| ID | 项 | 优先级 | 分支名 | 工作量 | 来源 | 主要落点 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | 循环失控防护（周期判据 + 结果参与键 + durable fold + 拒绝式反应 + 四类计数器） | P0 | `loop-guard` | 1 天 | #1+G1+goose §4.7+aider §3.3 | `packages/core/src/session/runner/` |
| L2 | Plan 模式 shell 硬后盾 | P0 | `plan-command-guard` | 0.5–1 天 | cline #2（**实测确认洞存在**） | `tool/plan-guard.ts` + `tool/plugin/shell.ts` |
| L3 | 拒绝反馈措辞 | P0 | `rejection-notice` | 0.5 天 | cline #4 | `Permission.BlockedError` 消息生成处 |
| L4 | 模型→工具路由 | P0 | `model-tool-routing` | 1 天 | cline #3 | `config` + runner 请求组装 |
| L5 | TUI 四小件 | P0 | `tui-polish` | 1–2 天 | cline #5 | `packages/tui/src/` |
| L17 | prompt cache 确定性纪律（时间戳维度；第二维已由 C21 确认已有） | P0 | `cache-determinism` | 0.5 天验证 + 小改 | goose §3.6 + C21 | `session/model-request.ts`、`doc/context-economics.md` |
| L30 | MCP schema 字节确定化（canonicalize） | P0，**成本最低** | `mcp-schema-canonicalize` | 0.5 天 | codewhale §3.4（C22） | `packages/core/src/tool/mcp.ts` |
| L31 | 审批决定落盘 + 回执 builder（权限闭环最后一环） | P0 | `permission-receipts` | 2–3 天 | codewhale §3.1（C23） | `permission.ts` 决策点 + 新投影表、`shell/scan.ts` |
| L32 | 指令预算 + 技能清单预算与冲突可见性 | P0 | `context-budgets` | 1–2 天 | codewhale §3.2/§3.3 | `session/context.ts`、`instructions/`、`config/plugin/skill-scan.ts`、`skill/instructions.ts` |
| L13 | 幻觉工具自愈两件（名字修复 + 错误附清单） | P0 | `tool-name-repair` | 0.5 天 | goose §3.2 + C2 + codewhale §6 三证 | `plugin/tool-input-repair.ts` 同型插件、`runner/publish-llm-event.ts` |
| L14 | 空响应重试 | P0 | `empty-response-retry` | 0.5 天 | goose §3.3（C13 settled） | `runner/step.ts`、`runner/llm.ts` |
| L15 | Windows 进程树 Job Object 治理 | P0 | `win-job-object` | 1 天 | goose §3.4（aider 确认无新证据，仍立项） | `packages/util/src/cross-spawn-spawner.ts` |
| L16 | MCP 子进程卫生（env **注入向量**黑名单、OSV、进程组） | P0 | `mcp-spawn-hygiene` | 1 天 | goose §3.5 + aider 补实测 | `packages/core/src/mcp/stdio.ts` |
| L25 | prompt cache 保活 ping（把缓存当有 TTL 的资源） | P0，先量再定默认 | `cache-keepalive` | 1–2 天 | aider §3.1 | `session/runner` 空闲边界、`packages/ai/src/cache-policy.ts`、`session/usage.ts` |
| L26 | 编辑后验证结果回喂下一次推理 | P0，需共识（§8.9） | `post-edit-feedback` | 1 天 | aider §3.2 | `formatter.ts` 调用点、`tool/plugin/edit.ts`、`execute.after` |
| L27 | 配置面 codegen 接线 + docs 选项表生成 | P0 | `config-codegen-check` | 1 天 | aider §3.4（C17）+ C24 分层 | `packages/schema/script/config-schema.ts` 脚本对、`packages/web/src/content/docs/` |
| L33 | 特性注册表 + 漂移测试（含元测试） | P1 | `feature-registry` | 2–3 天 | codewhale §3.5（C24） | 新 `script/feature-registry.ts` + `doc/features.toml` + `doc/conventions.md` |
| L34 | cache 漂移归因层（指纹 + 具名 miss，不改 prompt 组织） | P1 | `cache-attribution` | 2–3 天 | codewhale §4.2 | `session/model-request.ts`、`doc/context-economics.md` 新增「cache 归因」节 |
| L6 | 上下文回收三件套（反膨胀闩锁 / 旧工具结果占位 / 旧附件占位） | P1 | `context-reclaim` | 2–3 天 | G3+G2 §4.1+#9+#7 合并 | `session/compaction.ts`、`tool-output.ts`、`runner/to-llm-message.ts` |
| L18 | 工具 schema const-union 折叠（收窄版） | P1 | `schema-collapse` | 1 天含测量 | goose §3.1（C9 收窄） | `tool/runtime.ts` 之后、协议层之前；超预算交 L29 |
| L29 | 结构化块预算二分纯函数 + 缓存损坏降级 | P1 | `budget-bisect` | 1 天 | aider §4.3（C19 已改客户） | `packages/core/src/session/` 内纯函数；客户 = **L32（第一个）**、L18、L9、未来 LSP |
| L7 | 行为评测 + 分级 + pass^k + 台账 + 行为位 | P1（第二阶段 P2） | `agent-evals` | 1 周 | G4+cline §11+goose §7.5+aider §4.5（C8/C20） | 仓库根 `evals/`、`packages/schema/src/model-compatibility.ts` |
| L19 | 审批安全三规则 | P1 | `approval-safety` | 1 天 | goose §4.2（与 L31 同一证据面） | `packages/tui` 审批 UI、headless 路径、审批序列化处 |
| L20 | 子代理收口五件套 | P1 | `subagent-closure` | 2–3 天 | goose §4.1，与 codex M4 同 PR 组 | `tool/plugin/subagent.ts`、`session/subagent-job.ts` |
| L24 | 工程实践包（MCP 录制回放、对抗 fixture、conformance 门禁、docs-map、reviewer 沉默清单 + aider 五条 + codewhale 三条） | P1 | 各项独立 | 每项 ≤0.5 天 | goose §7 + aider §7 + codewhale §1/§7 | `packages/core/test`、`.github/workflows`、`script/` |
| L35 | 主题对比度审计（时机：Indigo 刚落地） | P1 | `theme-contrast` | 0.5–1 天 | codewhale §4.1（`实测` 无 contrast 概念） | `packages/tui/src/theme/` 审计测试 + 命名豁免 |
| L36 | 子进程 env 白名单（管凭据**泄出**，与 L16 反向互补） | P1，默认关 experimental | `child-env-allowlist` | 1 周含观察 | codewhale §4.5（`实测` 全量继承） | `cross-spawn-spawner.ts` + 显式 `shell_env` 逃生口 |
| L37 | 双策略脱敏（日志宁可误杀 / 模型文本只杀凭证形状） | P1 | `dual-redaction` | 1 天 | codewhale §4.6 | 新 `packages/util` 纯函数；首个消费者是 L31 回执 |
| L38 | 错误字符串兜底分类决策表 | P1，小 | `error-fallback-taxonomy` | 0.5 天 | codewhale §4.7 | `session/to-session-error.ts` 的 fallthrough 前一层 |
| L39 | 自更新：后台下载 + 下次启动应用 + 回滚 | P1 | `updater-rollback` | 1 周 | codewhale §4.8（`实测` 现前台升级、无回滚） | `packages/cli/src/services/updater.ts`、`AGENTS.md` 的 Local Release Builds |
| L9 | 定时任务 + recipes | P1 | `schedule-routines` | 1.5–2 周 | cline #6 + goose §4.6（C10）+ codewhale §5 的去时间约束 | `packages/core/src/schedule/` + `packages/schema` |
| L10 | 插件可靠性 v1 → 沙箱 v2 | P1 | `plugin-reliability` → `plugin-worker-sandbox` | 1 周 / 2–3 周 | cline #8 | `packages/plugin/` |
| L11 | 快照恢复防御验证 + path-scoped 撤销 | P1 | `snapshot-restore-hardening` | 1 天验证 + 0–2 天 | cline #10 + codewhale §5 | `snapshot.ts`、`session/revert.ts` |
| L8 | 摘要质量量具与格式层 | P2 | `compaction-fidelity` | 0.5 天 + 依赖 L7 | G2 §4.2/4.3 + goose §4.5 | `session/compaction.ts`、`plugin/agent.ts` |
| L28 | 用途维度模型路由（`compaction` / `title` / 未来 `commit-message`） | P1 | `side-task-routing` | 1–2 天 | aider §4.1（C18）+ G2 §4.3 | `compaction.ts`、`model.ts` 的 `Model.small`、`config/plugin/agent.ts` |
| L21 | 权限演进包：参数级 allow + 过期 / `SafetyLevel` 分级 / mid-turn 收窄偏序 | P2 | `permission-algebra` | 一 PR 组 | goose §4.3 + codewhale §4.3/§4.4 + C14（与 codex M1 合并讨论） | `permission/saved.ts`、`shell/danger.ts`、`packages/tui/src/context/permission.tsx`（`实测` 现为 `"prompt" \| "autoaccept"` 二值） |
| L22 | turn-budget 软预算提示 | P2 | `turn-budget-hint` | 0.5 天 | goose §4.7 后半（C11/C13） | 请求组装的注入通道 |
| L23 | inspector 管线过渡形态 | P2 | `tool-inspector` | 设计先于实现 | goose §4.4（C14） | `permission.ts` 外围，**不动折叠** |
| L12 | 路线图项（Hub 生命周期、Zen、NDJSON、MCP 进阶、Code Mode、`AI!`/`AI?`、脏工作区待核、shell 语义展开、Guardian 熔断三件套、记忆面、Fleet 身份分离） | P2 | — | — | cline §11 + goose §5 + aider §4.2/§4.4 + codewhale §5 | `process-daemon`、`protocol`、`shell/`、`filesystem/`、`worktree/` |

依赖：**cache 轴是一条台阶 L30 → L17 → L34 → L25**（字节确定 → 纪律与断言 → 归因 → 保活；L25 在 L30 之前做等于反复给已脏的前缀付钱）；L29 纯函数先落、**L32 是它的第一个客户**（指令/技能是零预算的真缺陷，比 L18 更早）；L31 与 L37 同批（回执是脱敏器的第一个消费者）；L33 与 L27 组成一个防腐 PR 组（C24）；L1/L13/L14 同改 step 边界，顺序 L1 → L14 → L13；L28 与 L8 同 PR；L21/L23 与 codex M1 合并讨论；L36 与 L16 分清（注入进 vs 凭据出），可共用 spawn 层测试；L6 在 L17+L34 之后（§5 的回收会改前缀字节）。

---

## 3. P0 项

### 3.1 L1 循环失控防护

**目标**：模型原地打转时硬性打断，并把纠正指令挂在**那次调用**上。`runner/max-steps.ts` 的步数上限分不清"30 步正常工作"和"3 步死循环"；`runner/unfinished.ts` 判的是"没产生副作用"。

**判据（取 G1 + C3 + C4）**

- 新模块 `core/src/session/runner/loop.ts`，用 `makeLocationNode`（`packages/util/src/effect/app-node.ts`）建 Location 作用域服务。
- **窗口从 durable 历史折叠**（C1）：数据源 `session.tool.success` / `session.tool.failed` 投影行，turn 边界沿用 `unfinished.ts` 已有的 `idle` marker 作用域。不新建 durable 事件、不新建内存 Map。
- 键 = `effectiveName`（`packages/core/src/tool/runtime.ts`）+ **持久化的** input（规范化键序后 SHA-256 前 12 hex）+ **结果摘要**（C4：该 tool part 的输出文本按 `packages/util/src/token.ts` 的字符算术取哈希；provider-executed 无本地输出时退化为 status）。用持久化副本而非内存对象，否则重启后同一次调用算出不同的键。
- 匹配：窗口 25、周期 `k ∈ 1..5`、同周期连续 `R = 5` 次。阈值全部为模块常量，不加配置（采纳 #1 的反投机立场）。

**四类计数器（C11 + C16 的合并结果：共用同一 fold 骨架，不分叉实现）**

| 类别 | 数什么 | 上限 | 现状 |
| --- | --- | --- | --- |
| ① 同键重复 | 同一 (工具, 参数, 结果) 的周期重复 | `R = 5` 触发，`LOOP_REJECT_LIMIT = 3` 收束 | **无**（`实测` 相关 grep 零命中） |
| ② 无副作用步 | 本轮没有真实副作用 | `STALL_LIMIT = 3` / `MAX_NUDGES = 10` | 已有 `unfinished.ts` |
| ③ 外部拒绝 | 同一 (工具, 参数) 被权限规则连续拒绝 | `DECLINE_LIMIT = 8`（goose `DEFAULT_STOP_HOOK_BLOCK_CAP = 8`，`实测`） | **无** |
| ④ 畸形产出 | 同一 turn 内模型未按格式产出的次数 | 上限必须**对用户可见**（aider 原文 `Only 3 reflections allowed, stopping.`） | **无**（判定有、计数无） |

四类各自病因、各自文案，**共享同一条收束**：拒绝下一次工具执行 + 追加一个 `toolChoice: "none"` 的纯文本收尾步（与 `max-steps.ts` 同形）。**不新增 `DrainResult` 变体**——`doc/records/2026-10-todo-completion-nudge.md` 已论证重跑 drain 会重复 `settleStaleCompactions`/`settleStaleToolCalls` 等入口工作。收束**不是 session error**（理由同 `todo-residue-stopped`：错误读起来像会话坏了，真相是模型在原地打转）。前进定义：出现未见过的键，或同键但结果变了（C4 推论）——`unfinished.ts` 的"真实副作用"在这里不够用，重复的 `edit` 也是副作用。

第③类的**归主四分**取自 codewhale 的 `ApprovalDecider::{User, SessionRule, Posture, Host}`：`host`（"没人可问"）**永远不算"用户拒绝"**。这一条错了，L31 的回执就写不出 blocked ≠ failed ≠ not-run，L3 的措辞也会指错人。

**反应形状（取 #1 + C2）**：命中后，下一次同键调用在 `execute.before` 被拒，`Tool.Error` → 挂成 `ToolFailure`。消息是 model-visible 契约 token，字面写进 topic doc：

```
Loop guard: this exact tool call (same arguments, same result) has been made N times in
a row. Repeating it will not help. Change the arguments to get new information, use a
different approach, or ask the user.
```

（相对 #1 原稿改两处：显式写 "same result" 兑现 C4，删掉 "already been made" 的歧义。）不做"先警告再拦截"两阶段——`execute.before` 只有放行/拒绝两种结果，两阶段等于把同一条信息发两遍（取舍进 `Decisions`）。第④类额外借 aider 的定向修复：能给出 "did you mean" 候选时给候选，不要只说"重来"。

**测试**（`packages/core/test/session-runner-loop.test.ts`，用 `packages/core/test/session-runner.test.ts` 的 `TestLLM` seam；不 `sleep`，用 `it.effect` 的 `TestClock`，按 `.opencode/skills/unit-tests`）：5 次同参同结果被拒且含 "Loop guard"；改参重置；不同工具互不触发；**`A B A B` 交替打断**（#1 原设计做不到，本次合并的净增益）；**同参不同结果的轮询不打断**（C4）；同一被拒权限连撞 8 次收束且文案是"用户决定"不是"空转"（③、L3）；畸形产出第 N 次停止且提示语含上限数字（④）；四类计数重启后都不归零（C1）；收束是 idle 不是 error；开关关时零行为变化。512 会话上限的逐出（#1 顾虑）在本设计下不需要——状态从历史折叠。

**doc 同步**：`doc/session-loop.md` 的 "Stopping, continuing, and nudging" 表加三类行 + `Decisions` 记四件事（durable fold 而非内存 Map，六个来源；结果参与键且三家原文都漏，C4；四类计数器分病因共享收束，C11/C16；上限必须对用户可见，C16）。消息 token 字面保留；`CHANGELOG.md` 记默认开启那一刻。**④ 的计数同时是 L7 的一个指标**（C20：同一个数既是熔断阈值又是评测口径，不分叉）。

### 3.2 L30 MCP schema 字节确定化

**本稿成本最低、确定性最高的一项。** `实测` `packages/core/src/tool/mcp.ts` 是 `input: (tool.inputSchema ?? { type: "object", properties: {} }) as JsonSchema.JsonSchema` 裸透传。C21 已确认**数组顺序**我方是稳的（`tool.ts` snapshot 按名排序），所以缺口精确地只在**单个 schema 内部的键序**：MCP server 重连或升级后返回语义等价但键序不同的 schema，前缀字节即变、KV cache 全灭，而且这类 miss 无具名（要等 L34 才归因得出来）。

落点：`tool/mcp.ts` 的 schema 接收边界一个递归排序纯函数（`required`、`dependentRequired`、所有对象键），加一条测试：同一 schema 的两份乱序输入产出**字节恒等**的输出。**只做字节确定，不做语义折叠**（那是 L18）。

判定它成立与否不需要外部证据——写一条测试即可（见 §12.10），所以它排 W1 第一个 PR。

### 3.3 L31 审批决定落盘 + 回执

`实测` `packages/schema/src/permission.ts` 的 `Asked`/`Replied` 都是 `ephemeral(...)`，`permission/saved.ts` 只持久化「always 存下的规则」，不留决定史；`grep -rn -i receipt packages/core/src` 零命中。所以**权限闭环缺最后一环**：升级优先于任何 allow 是我方唯一性优势（`优势对比清单.md` §3.1 实测），但它是**安全声明**，没有可审计性。

按 C23 走投影表路线（不动事件词汇）。三小块，各自可独立合入：

1. **落盘**：在 `permission.ts` 的 ask/reply 决策点写一条专用投影记录，带 `decided_by` 四分归主（User / SessionRule / Posture / Host）。「没人可问」不得记成「用户拒绝」。
2. **回执 builder（纯函数）**：输入投影记录，输出按序动作清单——改了哪些文件（±行数）、跑了哪些命令（exit code）、web/MCP 调用、`ran_without_asking` 计数（并标注当时哪种 posture）、以及 **blocked ≠ failed ≠ not-run 三分**。blocked 的识别复用 `实测` `packages/core/src/shell/scan.ts` 已有的拒绝标记。
3. **一个 surface 起步**：先只做 TUI 命令，不上 CLI 子命令与 HTTP 端点。对方是三 surface 共享一个 builder——那个 builder 本来就该是纯函数，第一个面就按这个约束写，后两个面才是加法而不是重写。

自声明边界照抄：对方输出带 `claim_ceiling`（"这是本地记录，不是安全认证"）。我方同理——回执不进 `doc/permissions.md` 的威胁模型承诺，它不是认证。记不到的进 `not_recorded`。

测试：四分归主各一条；`host` 不落成 `user denied`；缺记录进 `not_recorded` 而不是被省略；builder 可脱离会话上下文直接测（纯函数）。doc：`doc/permissions.md` 加一节 + `Decisions`（记"投影表而非事件词汇"这条取舍及其相撞检查）。

### 3.4 L32 指令预算 + 技能预算与冲突可见性

`实测` 两处零命中：`grep -rn -i budget packages/core/src/instructions/ packages/core/src/session/context.ts` → 0；`grep -rn -i "shadow\|conflict\|duplicate" packages/core/src/config/plugin/skill-scan.ts packages/core/src/skill/instructions.ts` → 0。含义：**AGENTS.md 类文件多大都全量进 prompt**，且**多根同名技能静默择一**（用户看不见自己被 shadow 了）。

对方的形状（`对方实测`）值得抄三件事：

- **预算参数**：`DEFAULT_SCOPE_BUDGET_TOKENS = 100_000` + `DEFAULT_SCOPE_BUDGET_PERCENT = 25`（各 scope 不超过可用窗口 25%）+ `DEFAULT_STATIC_PREFIX_GUARD_PERCENT = 80` + `refuse` 语义（超预算直接不发请求）。**全局与项目分开核算**，不是一个总池子。
- **裁剪必须可见**：每一次 trim / skip / refusal 都到达模型与 `/context report`，不是静默切。做成 instruction 里的一段话，不是日志行。
- **冲突不合并**：技能审计把 shadowed / duplicate / conflict **全部列出**而非"聪明择一"；`listing_budget_fraction`（默认路由窗口 5%）+ `listing_max_description_chars`（默认 400）超限即**缩短并告知**；`invocation: explicit-only` 的技能零 ambient 占用；目录矩阵 fixture 与 `BUNDLED_SKILLS` 双射测试，把「用户技能永不被静默挤掉」做成**可断言不变量**。

落点与归属：预算核算在 `session/context.ts` 的指令汇集处与 `skill/instructions.ts` 的清单渲染处，**归 `doc/context-economics.md`**——它拥有 token 预算主题，但当前**完全没有"注入块预算"这一节**，这是文档缺口不只是代码缺口。裁剪算法直接用 L29 的二分纯函数，不在这里另写一套比例阶梯（C19）。成本低，收益是一条现在完全没人守的轴。

### 3.5 L13 / L14 / L15 / L16 / L17

- **L13 幻觉工具自愈**（goose §3.2 + C2 + codewhale §6 三证）：我方已有 1.5/3——`model-request.ts` 的 `Prepared.executeTool` 已限定在本请求 advertise 的工具上执行，另有 goose 没有的**输入值**修复（`实测` `plugin/tool-input-repair.ts` 按 schema 做 coercion 与 oneOf 试探，注释逐条列明字符串化对象、closed object、nullable、tuple、嵌套 `$ref`）。缺**名字**与**自愈回路**：① `recover_mangled_tool_name` 等价物（`developer.shell`、`functions.x`、namespace/下划线变体折回 `effectiveName`；`runtime.ts` 已有 `normalizedName`/`effectiveName` 两个清洗函数作对齐点）；② Unknown tool 的兜底响应附**当前可用工具清单**（`实测` `runner/publish-llm-event.ts` 对 `Unknown tool: ${name}` 已有专门处理，是接入点）。**形状复用 `tool-input-repair.ts` 的内置插件模式与注册位置**，不新开 seam。测试含常见 mangle 形态表驱动、修复后仍需真匹配 advertise 集（不可借名字修复复活已下线工具）。
- **L14 空响应重试**（goose §3.3，C13 已 settled）：取 `MAX_EMPTY_RESPONSE_RETRIES = 3`（`对方实测`）。判据是「本步无任何可见输出 **且** 上一轮没有成功的 tool response」——后半条缺了就会把"工具跑完、模型只回了个 ok"误判成空响应而白白重试。仍空则落一条**隐藏标记消息**保历史完整，我方对应实现是 `SessionEvent.Synthetic`（模型可见、非用户消息），**不是**新事件类型。测试：三种组合各一条；不得与 `unfinished.ts` 的 nudge 叠成双份提示（同一 turn 内只应有一个东西在说话）。
- **L15 Windows 进程树治理**（goose §3.4）：`实测` `packages/util/src/cross-spawn-spawner.ts` 用 `taskkill /pid <pid> /T /F`；`grep JobObject|CREATE_SUSPENDED` **零命中**（aider §5 也确认它自己在这个维度不提供新证据）。taskkill /T 的已知盲区：孙进程脱离、PID 复用竞态、树枚举瞬时不一致。Job Object 的 kill-on-close 是内核级保证：`CREATE_SUSPENDED` → `AssignProcessToJobObject`（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）→ `NtResumeProcess`，终止走 `TerminateJobObject`；配套 `CREATE_NO_WINDOW`。**行为级改动、上游行为天天在用**（shell、MCP 子进程、desktop 后端），落地先写"父进程被杀 ⇒ 孙进程也必须死"的用例，关停超时值不变；Windows-only 失败单列，不用 `skipIf(win32)` 掩盖。
- **L16 MCP 子进程卫生**（goose §3.5 + aider 补实测）：`实测` `packages/core/src/mcp/stdio.ts` 是 `extendEnv: true` + `env: options.environment`，**无任何 denylist**——缺口由两轮独立确认。三小件：① env 黑名单（goose 31 键：`PATH`、`LD_PRELOAD`、`DYLD_INSERT_LIBRARIES`、`PYTHONPATH`、`NODE_OPTIONS`…）；② 启动 `npx`/`uvx` 前查 OSV，**语义照 goose 的 fail-open**（离线即放行，只拦已知恶意；这条口径必须写进 doc，否则会被误读成供应链门禁）；③ Unix `process_group(0)`（Ctrl+C 不误杀宿主）+ `PR_SET_PDEATHSIG` + Windows `CREATE_NO_WINDOW`——与 L15 同属 spawn 层，**同 PR 做**。**与 L36 的分工写进 doc**：本项管注入向量进入，L36 管凭据泄出。
- **L17 prompt cache 确定性纪律**（goose §3.6 + C21 自我更正）：三条实践在对方全部有注释或测试承重（`实测` "Stable tool ordering is important for multi session prompt caching"）。我方现状按 C21 更正：**工具数组排序那一维已有**（`tool.ts` 的 `Array.from(direct).sort(...)`，且 `llm.ts` 明确为保前缀而不撤工具定义），`model-request.ts` 也无 `Date.now`/`toISOString`（`实测`）。所以本项收窄为两件事：① 建立可测断言 **「同一 turn 内两次请求的前缀字节必须一致」**（对已组装请求做 hash 比较，不需要 provider），进 `packages/core/test`；② 核对剩余可疑源（per-request 时间注入、媒体绑定、`gatewayPolicy` 分支）。它是 §5 回收与 L25 保活的共同守门人，落 `doc/context-economics.md` 的 `Decisions`。

### 3.6 L25 prompt cache 保活 ping

**缺口 settled 且具体**：`实测` 我方缓存策略链齐全——`packages/ai/src/cache-policy.ts` 的 `applyCachePolicy`（`AUTO = {tools, system, messages:{tail:1}}`、`BREAKPOINT_CAP = 4`、`RESPECTS_INLINE_HINTS`、per-model `gatewayPolicy`）、`protocols/anthropic-messages.ts` 的 `cacheControl()`、`session/model-request.ts` 的 `promptCacheKey` 与 `cache: {ttl}`（`boundImages` 甚至专门为"切图时保持前缀字节不变"写了注释）、`session/usage.ts` 按 `cache.read`/`cache.write` 计价、`session/stats.ts` 把 `$.tokens.cache.read` 折进用量页。**但没有任何主动保活**：`grep warm_cache|keepalive packages/{ai,core}/src` 只命中入站 SSE keepalive。

为什么我方比 aider 更需要：审批等待、用户在读 diff、shell 工具跑长任务——这些间隙里前缀被逐字复用而一次请求都不发；TTL 过期的直接后果是下一个请求**全价重推整个前缀**。这条同时打在成本与 tok/s 上，而 tok/s 与缓存命中是必须保留的展示项。

**形状（aider `对方实测`）**：`warm_cache(chunks)` 在请求组装完成后调用，`max_tokens=1` 的**非流式** ping，消息体只取带断点的那段前缀（`cacheable_messages()`），间隔 `5*60-5` 秒（Anthropic 5 分钟 TTL 前 5 秒），成功则汇报 "Warmed N cached tokens"，`warming_pings_left` 递减到 0 停。

**两处必须改**：

1. **不起线程**。挂 `packages/core/src/session/runner` 的**空闲边界**（等待审批 / 等待下一条 inbox），不是 daemon `Timer`——我方续跑与中断语义都以 drain 为单位，异步线程会绕过 `Fiber.interruptAll` 与写前置认领。ping 必须走**同一个 `promptCacheKey` 与同一份前缀字节**（L17 的断言就是它的守门人），否则是自己把缓存打脏。
2. **记账口径先定再写码**。ping 是真实 API 调用，`doc/usage-stats.md` 的原则是"不虚构归属"，它已把 `source: "compaction"` 排除在日聚合外；保活 ping 需要显式归类（建议 `source: "cache-warm"`，**计入 tokens 不计入日活**），否则用量页会出现"没人提问却花了钱"的无法解释条目。与代码同批提交。

**默认值**：aider 把它做成显式 opt-in（`--cache-prompts` 默认 `False`、`--cache-keepalive-pings` 默认 `0`，`实测`），这本身是"这笔账不一定划算"的信号。**先量再定**：用 `script/session-efficiency.ts --json` 拆出真实会话里"间隙导致的 TTL 过期"占多少成本。红线：没有可比数据就不许开默认。**前置：L30**——schema 字节不稳时，ping 只是反复给一个已经脏了的前缀付钱。

测试：ping 与主请求的 `promptCacheKey` 一致；空闲边界进入/退出时计时起止正确（`TestClock`，不 sleep）；用户中断时 ping 一起停；`cache-warm` 用量落库且被日聚合排除；关闭时零请求。doc：`doc/context-economics.md`（TTL 与保活归属）+ `doc/usage-stats.md`（`cache-warm` 口径）。

### 3.7 L26 编辑后验证结果回喂

`实测` 我方写工具后**只有 formatter，而且失败被主动丢掉**：`packages/core/src/formatter.ts` 把子进程 `stdin/stdout/stderr` 设为 `"ignore"`，命令抛错走 `Effect.logError` 后 `Effect.as(undefined)`，退出码非 0 只记日志并 `return false`；调用点 `tool/plugin/edit.ts` 拿到 `false` 后**直接回读原文**（`formatted ? syncTextBom(...) : readText(...).text`）——**模型收到的 diff 里没有任何"格式化失败"的痕迹**。`write.ts`、`patch.ts` 同型。`edit.ts` 里还留着两条 TODO（watcher 事件后发布、LSP 运行时后通知诊断）。可承载验证的钩子存在：`tool.hook("execute.after")`（但只有 `before` 能否绝调用）。

aider 的对应闭环（`对方实测`）：`apply_updates` 尾部 `edited → lint_edited → auto_commit(context="Ran the linter") → reflected_message = lint_errors → 下一轮 LLM 输入`，受 `max_reflections = 3` 约束，且**格式修复优先于验证**；`auto_test` 同型。

**借的是通道，不是 lint 本体**。把"验证失败"变成下一次推理的输入，走我方已有的注入通道（durable 合成项或 notice token），**不能**用 `reflected_message` 那种"伪装成模型自己刚说的话"（前五轮否决记录）。判据从最便宜的开始：formatter 失败、`tsc`/项目自带 check、patch 后语法可解析。上限复用 §3.1 的计数器位（它是"验证失败"病因，文案与"空转"不同，故是第五个位置或并入④——**实现时按病因分文案、按骨架共用计数**）。

**立项前提是一个共识**（§8.9）：**验证属于循环还是属于模型？** 现在的答案偏后者（模型自己跑 shell）。本项只是补一条可选的自动反馈，不是撤掉模型侧的 shell 工具。共识未达之前不写码；若共识是"归模型"，本项收缩成「formatter 失败不能再被静默丢掉」这一小半（已核实的静默数据丢失，无论如何都该修）。

另借一件更硬的东西、但放错层就废：`benchmark/refactor_tools.py` 用 AST 判"假重构"（目标函数仍在顶层、子节点数偏差 `< 10%`）——这是把"模型偷工减料"变成**可断言判据**，属 L7 的指标层，不进循环。

### 3.8 L27 配置面 codegen 接线 + docs 选项表

按 C17：生成器已有、没人调。三件事，都很小；与 L33 组成一个**防腐 PR 组**（C24）：

1. 给 `packages/schema/script/config-schema.ts` 补一对 `generate` / `check:generated` 脚本，形状照 `packages/protocol/script/generate-openapi.ts`（我方已有 `check:generated` = `generate && git diff --exit-code` 的先例）。
2. 把 `check:generated` 进 `bun run lint`——与 `script/doc-refs.ts`、`script/sdk-docs.ts` 同批。这一步把「配置加字段忘了发 schema」从人眼 review 变成 PR 变红。
3. 文档选项表从生成的 schema 渲染，而不是手写 mdx。`实测` `packages/web/src/content/docs/config.mdx` 未收录 `compaction.keep.tokens` 这类已有键——漂移的实物证据。范围先只做 config 一页；**不要顺手做全站 docs-map**（那是 L24 第 4 条的另一件产出物，两份原稿均已声明不重复）。

第三层（C24 的路由清单快照）：协议 `HttpApi` 有 2.3 万行 `openapi.json`，但没有把**路由集合本身**钉住的评审物；补一个排序后的 METHOD+path 清单快照测试。落点：`packages/schema`（脚本对 + `package.json`）、`packages/web/src/content/docs/`、协议包测试。

### 3.9 L2 / L3 / L4 / L5

- **L2 Plan 模式 shell 硬后盾**：`实测` 洞存在——`plugin/plan.ts` 对 plan agent 只 push 了 `{action:"question", …allow}`、`{action:"edit", resource:"*", effect:"deny"}` 与 plan 目录 allow；`shell` 是**独立 action**（`tool/plugin/shell.ts` 的 `export const name = "shell"`），plan 模式没有 deny 它，且它的 `execute.after` 只改写 edit/write/patch 三类 `BlockedError`。所以 plan 下 `rm -rf`、`git reset --hard`、`npm install` 照样执行。设计照 #2：**不要用正则重新解析**，复用 `shell.ts` 已有的 `ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })`；接入点取舍规则照 #2（执行器有 agent 上下文则在工具内，否则在钩子，拿不准选钩子，因为 plan 身份判错守卫就完全失效）。判定表照 #2（文件变异 `rm/mv/cp/mkdir/rmdir/touch/chmod/chown/ln`、`sed -i`、`tee` 写文件；重定向 `>`/`>>`；git 变异 `commit/push/pull/merge/rebase/reset/checkout/restore/clean/stash`，`status/diff/log/show/grep` 放行；包管理 `install/add/remove/uninstall/update`；只读白名单 `ls/cat/head/tail/grep/rg/find/wc/du`）。**不可判定 → 拒绝**（fail closed），与 `doc/permissions.md` 的 `risk: "unanalyzable"` 同构；按 C15 **不加 basename 白名单之类的安全假设**。测试：判定器表驱动正反例（`sed -i` vs `sed`、`git log` vs `git commit`、引号与 heredoc 不误判）+ 工具级集成（plan agent 命中被拒、build agent 同命令放行）。doc：`doc/session-loop.md` 一行 + `plan.ts` doc comment 一句 + 产品文档 plan 页。
- **L3 拒绝反馈措辞**（cline #4）：常量（model-visible token）

  ```
  This was a user decision, NOT a tool or system failure. Do not retry the same call.
  Clarify with the user or adjust your approach.
  ```

  只对权限拒绝类追加，不碰真实内部错误。**与 L1 的分工写进 doc**：L1 的 "Repeating it will not help"（系统判定空转）与 L3 的 "Do not retry the same call"（用户决定）是两种来源，措辞不能合并，否则模型分不清谁拒的；L1 第③类的 `DECLINE_LIMIT` 正好消耗 L3 这条提示。落地先 `grep BlockedError` 的消息生成处；顺带确认 `question`/`subagent`/MCP 被拒是否同一出口（#4 已提出这个检查点）。doc 进 `doc/permissions.md`，contract token 字面保留。
- **L4 模型→工具路由**（cline #3）：`tool_routing` 配置键（glob 匹配 `provider/model` 全名，可选 `provider` 维度，`disable` 后 `enable`，多条按序叠加；归一化沿用 `config/normalize.ts` 既有模式），落点在每请求工具清单组装处——**实施第一步先定位该符号**（#3 给的候选是 `runner/step.ts`、`runner/prompt/`、`generate.ts`）。不匹配任何规则的模型行为完全不变；热生效沿用现有 config watcher。**与 L17 相互作用**：路由过滤会改变工具集合，同 turn 内变动即破坏前缀稳定——两条同 PR 时以 L17 的断言为准。测试：glob、叠加顺序、无规则零影响。doc：change map 的 "Config keys and defaults" 行 + 产品文档 config 页 + `CHANGELOG.md`。
- **L5 TUI 四小件**（cline #5，与 cline 栈同：`@opentui/core` + `@opentui/solid`，catalog 锁 0.7.0）：5a 启动预绘背景（`renderer.getPalette({timeout:150})` 探测前景/背景色，先绘主题背景再渲染，消启动闪色）；5b stdio 捕获（截获 core 侧 `console.log` 防打花 TUI——我方是 cli→server→tui 架构，需先确认 server 日志是否会污染 stdout）；5c OSC52 剪贴板复制；5d 终端标题随会话状态变化。**每小项先验证 fork 现状再做**，各自独立 commit（`feat(tui): …`）；5a/5b 需 `bun run dev:live` 真终端验证；写测试前读 `.opencode/skills/tui-tests`。doc：产品文档 tui 页。

---

## 4. P1 项

### 4.1 L33 特性注册表 + 元测试（C24 第三层）

`对方实测`：`docs/features.toml`（918 行）是唯一手工维护的用户特性清单，字段 `id`（**永不复用**）/ `status`（stable|experimental|flagged|planned）/ `surfaces` / `since` / `flag` / `docs` / `owner`；`crates/tui/tests/feature_registry.rs` 双向校验——每个 runtime feature flag 恰好一行、行状态与 flag 默认值一致、`docs`/`owner` 路径存在、`since` 必须是 CHANGELOG 标题；再加 `feature_registry_checks_catch_drift` **用坏 fixture 验证检查器本身没退化**。

我方现状（`实测`）：`script/doc-refs.ts` 管「引用不能烂」（31 文档 / 158 路径 / 0 problems，进 `bun run lint`），`script/sdk-docs.ts` 管 SDK 注释与 README 源码块；但「功能 ↔ flag ↔ 文档 ↔ CHANGELOG」的**存在性**没有登记面——功能删了文档成孤儿、flag 加了文档不知道，`doc-refs` 测不出来（它只解析路径与符号）。两者互补。

**元测试是入场券而非锦上添花**：kimi 就是反面教材——`scripts/check-service-naming.mjs` 全仓零引用、它约束的 `packages/services` 目录已删（`优势对比清单.md` §3.3 实测）。写进文档的规则不会自愈，没被测试的检查器一定会腐化。**所以落点必须包含一条故意造坏的 fixture 测试，否则本项不立项。**

落点：新 `script/feature-registry.ts` + `doc/features.toml`（倾向独立脚本而非并入 `doc-refs.ts`：职责不同、失败信息也不同）；进根 `package.json` 的 lint 链；按 `AGENTS.md` 索引纪律，新约定写进 `doc/conventions.md` 的 change map 并只加一行索引。第一个绑定对象是 `packages/schema/src/config/experimental.ts` 的 `experimental.*` 面——**L1 若保留开关，它就是注册表的第一行**。建议采纳 codewhale §7.12 的纪律，字段里加一列 **test 名**（回归由哪条测试守着，写进文档）。

### 4.2 L34 cache 漂移归因

`实测`：cacheRead tokens 在记（`session_usage` + `doc/usage-stats.md` 折叠口径），但**miss 发生了不知道是哪段变的**——`doc/context-economics.md` 只有估算与压缩预算，没有归因。

对方的形状（`对方实测`）是三个可分离动作：`PrefixStabilityManager.check()` 返回 `{Stable, Repinned, Drift}`，tools 按 **provider wire 序**序列化后 SHA-256；**声明式**变更记 `change:<what>` 并 re-pin；**未声明**的 drift 记 `drift:<component>` 但**保持原 pin**（测试名直接是 `undeclared_drift_never_moves_the_pin`，`实测` 符号存在）；另有一条有界 delta 通道（`<context_update>` 以 user 消息 append，80 行 / 6KB 上限）替代改历史。

三条裁决：

1. **先落指纹 + 归因，不动 prompt 组织方式**。这与 codex 轮 M6（`WorldStateSection`/`render_diff`/`Placement`，全节 diff）是同一主题的两个深度：对方这半是轻的、不改架构，可与 M6 并行且不冲突。归本稿与 codex 方案共同协调（§8.6 同理）。
2. **有界 append 的形状不可直接借**：它以 **user 消息** append，撞我方「伪装用户轮」否决（C13、L22、aider §3.2 三处同判）。内容走已有合成注入通道，核对不触发 promotion/inbox 语义。**「未声明的 drift 不动 pin」这条纪律要照抄**——它是"未知必须具名"在 cache 轴上的形态。
3. **wire 序指纹是关键细节**：指纹必须打在**发给 provider 的那份序列化**上，不是打在内部 snapshot 上，否则 L30 这类修复在指纹里看不出来，归因就是假的。

落点：`session/model-request.ts` 组装请求处；`doc/context-economics.md` 新增「cache 归因」节。成本中。前置：L30。

### 4.3 L8 与 L6 之外的上下文项：L28 / L29 / L18

- **L8 摘要质量量具与格式层**（G2 §4.2/§4.3 + goose §4.5）：格式层借四件实测出来的细节（`对方实测`，落地前先读对方 `structured.rs` 与 `prompts/compaction.md`）——① `<analysis>` **丢弃式草稿区**（先推理再出 JSON，草稿不进历史）；② **括号平衡**的 JSON 提取而非靠代码 fence（`json_candidates`，只认 `</analysis>` 之后锚定的候选）；③ `lenient_string_list` **宽松反序列化**（对象/数字强转字符串，而不是丢掉整个摘要）；④ 解析失败**保留模型原文**做 fallback，绝不返回空摘要。再加压缩后续接三连：摘要（user）+ 固定续接指令（assistant，明确要求"不要提你读过摘要"）+ **把用户最后一条真实消息重放到尾部**。本稿对它的态度与 C6/C19 一致：**只借格式，不借机制**——`TRANSCRIPT_LEVELS` 的分级撤下已经否决了"一次性摘要"这个形状（见 §9），所以这些是摘要 prompt 与后处理的改进，不是压缩策略的改动。G2 §4.2 的自校验探针（`compaction.verify`，默认关）与 §4.3 的档位问题分别落在这里与 L28，量具都是 `compaction-recall`（§6）。
- **L28 用途维度模型路由**（aider §4.1 + G2 §4.3，按 C18 修正）：`Model.small` 已在**标题**上跑着，缺的是「这个**用途**用这个模型」的路由维度。落点：`compaction` / `title` / 未来 `commit-message` 各自 model override，缺省继承会话模型——**用途维度，不是会话维度**，与 `config/plugin/agent.ts` 已有的 agent 级 `model = {id, providerID, variant}` 是两个正交轴，不要塞进同一张表。价值与风险都在 `compaction`：真实成本、真实延迟，且压在 tok/s 关键路径上；而 `TRANSCRIPT_LEVELS` 分级与模板校验说明这条链路产出格式固定、可降级。⚠️ 换模型 = 换 cache 前缀，逐用途实测（归属 `doc/context-economics.md`）；⚠️ 小模型跑摘要会影响压缩质量判据（`SHRINK_STEPS` 百分比与模板校验都按现模型调）。因此与 L8 **同一个 PR**：先有判据再换模型；本稿只交付可配置 + 量具，**不设默认值**。副产物提交信息生成器：若做，署名策略按 aider §7.7 写成表格进 `doc/session-rail.md` 的 `Decisions`，且**不得传 `--no-verify`**（我方 rail 现在不传，比 aider 多一层尊重用户 hook 的纪律，值得守）。
- **L29 预算二分 + 缓存损坏降级**（aider §4.3，按 C19 改客户）：做成 `packages/core/src/session/` 内的纯函数——输入有序条目 + 预算 → 输出可容纳的最大前缀。**不替换 `SHRINK_STEPS`**。第一客户是 **L32**（指令/技能块装填），第二是 L18（schema 面超预算时按字节逼近而不是硬截），第三是 L9 的 recipe/AGENTS.md 集合，第四是客户还不存在的 LSP diagnostics。第二条纪律：外部缓存损坏时**降级为内存缓存并告警**而不是崩（`对方实测` `tags_cache_error()`）；`待核` 我方 `kv.ts` 与 cassette 的损坏路径现怎么走，大概率已有，核完记结论。顺带事实：`web-tree-sitter` 已在树里（`shell/parse.ts` + `parser-wasm.{bun,node,workerd}.ts`），未来做符号级检索的依赖成本比外部想象低——**这不是本项的行动内容**。
- **L18 工具 schema const-union 折叠**（goose §3.1，按 C9 收窄）：inlining 已有，缺的是把 `$ref → $defs → oneOf(const string…)` 折叠成 `{type:"string", enum:[...]}` 并合并 variant 描述。**先测再改**：统计进请求的 schema 里 `oneOf`/`anyOf`/`const`/`$defs` 的占比与总字节；接近零则本项作废并在 doc 记"已折叠过一轮"（aider 轮撤下本项的理由是"aider 自己不涉及 schema 膨胀"——**那不是我们的判据**）。谨慎度照 goose 清单抄：尊重 `$schema` 方言（draft-04 的 `const` 语义不同）、不碰 `default`/`examples`、不碰带 `$id`/`$anchor` 的 def、nullable `anyOf` **不折叠**。落点在 `runtime.ts` 的 inlining **之后**、协议适配 **之前**（`实测` 另有 `packages/ai/src/protocols/utils/gemini-json-schema.ts`、`packages/ai/src/tool.ts`，两处折叠不能互相掩盖，第一步一并查）。归属：codex M7 P5「工具表面预算」的第一步，比 `tool_search`/BM25 便宜一个数量级；若解决了膨胀，M7 P5 第 1 项的四级 lossy 压缩可能不再需要——**排期时通知 M7 负责人**。

### 4.4 L35 / L36 / L37 / L38 / L39

- **L35 主题对比度审计**（codewhale §4.1）：`实测` `packages/tui/src/theme/` 内 `contrast` 零命中，而最近三个提交恰好是 `feat(ui): add the Indigo theme` + `feat(app): add a theme switch to the workspaces rail`——新增自定义主题正是对比度回归的高发区；我方主题纪律目前只守语义角色（`AGENTS.md` 的 Theme Tokens 节），不守可读性。对方是双重执法：绘制时 `enforce_contrast` 把文本 cell 拉到 4.5:1，另有逐主题审计 `theme_contrast_violations`；社区主题被**显式点名豁免**（`theme_uses_terminal_owned_surfaces`），豁免必须带命名理由。**我方先只做审计测试那一半**（离线、不接绘制 clamp）：clamp 会改变可见结果、属行为级改动，而审计能在不动渲染的前提下把回归钉住。豁免纪律照抄——不达标必须点名，不允许静默通过；这与 `doc-refs` 的"别靠删句子让检查通过"是同一条。
- **L36 子进程 env 白名单**（codewhale §4.5）：`对方实测` `sanitized_child_env()`——本地 shell 子进程**不继承环境**，只取白名单（PATH/HOME/TERM/代理/工具链），Windows 另走注册表补全；凭据注入走显式 `shell_env` 钩子且审计只记键名；**MCP 用另一套更宽的白名单**，文件注释写明两套契约。`实测` 我方 `cross-spawn-spawner.ts` 是 `opts.extendEnv ? { ...globalThis.process.env, ...opts.env } : opts.env`——默认全量继承，终端里 export 的 key 会进 agent 跑的每条命令。**与 L16 分工**：L16 管注入向量进入，本项管凭据泄出。⚠️ 行为级风险如实说：Windows 用户可能依赖终端 env 里的工具链配置，对方敢默认开是因为有 `shell_env` 显式逃生口。**建议**：先做 L37 的脱敏面，白名单做成默认关的 experimental 跑一个版本再定默认（§8.12）。
- **L37 双策略脱敏**（codewhale §4.6）：`对方实测` `RedactionPolicy::KeyBased`（日志/导出：敏感键整行抹）vs `CredentialShaped`（模型绑定文本：只抹 `sk-`/`ghp_`/`xoxb-`、JWT、Bearer、PEM 这类形状；`password: credentials?.password` 这种**代码**必须逐字节可引用，否则模型做不了精确匹配编辑）。`实测` 我方只有导出面脱敏（`session/transfer.ts` 的 `sanitize()` 抹 title/metadata），凭证形状脱敏零实现。**第二个策略才是有价值的半边**——它承认"对模型隐藏"与"对人隐藏"是两个目标，与 `doc/usage-stats.md` 的"不虚构归属"是同一类区分。落 `packages/util` 纯函数；第一个消费者是 L31 的回执与工具输出落盘路径。
- **L38 错误兜底分类决策表**（codewhale §4.7）：`对方实测` rate-limit 词**胜过** auth 词（429 正文带 "Invalid API key" 必须判 RateLimit，否则重试语义错）、`mentions_http_status` 只认独立 "HTTP 429" token（URL/ID 里的数字不误判）、402 → RateLimit 但 `recoverable=false`、504 → Timeout 而非 Network，且 typed 优先（先 downcast 保原文，防字符串二次分类降级）。`实测` 我方 `to-session-error.ts` 是 typed-first `_tag` switch、设计同构，未知落 generic providerError、无兜底表。**最便宜的拿法是先搬它的反误判测试用例**（429-in-URL、402、504）当我方测试数据，再决定要不要加那一层保守分类（只影响重试延迟与展示，不改 typed 路径）。
- **L39 自更新后台下载 + 下次启动应用 + 回滚**（codewhale §4.8）：`对方实测` 永不 session 中途应用、`previous_dir()` 保留被替换的二进制、`update --rollback` 换回、未签名 release 需确认而签名版自动应用。`实测` 我方 `packages/cli/src/services/updater.ts` 是前台升级（method 检测 + spinner），**无后台、无回滚**。这条对 fork 是**真实刚需**：`AGENTS.md` 的 Version Numbers 与 Local Release Builds 明确「fork 后缀永不等于上游 latest ⇒ 默认 `notify` 每次都报更新、`auto` 会被上游二进制替换 ⇒ 分发前设 `"update": "disable"`」——也就是说我方现在是用"关掉更新"换"不被上游覆盖"，而回滚能力才是让自动档可用的前提。同一条还接住暂存 CLI 复用那个坑（同版本桌面构建复用旧暂存 CLI，覆盖安装后后端不更新）。归属：`AGENTS.md` 的 Local Release Builds 约定随之更新。

---

## 5. L6 上下文回收三件套

一项之内三个子目标，**全部挂在压缩重建上下文的那条路径上**，不挂在每个 step。这不是偏好，是仓库已有的不变量：`doc/session-loop.md` 写「One drain freezes the instruction prefix (`InstructionBaseline`)… **Compaction rebuilds the prompt, so it is the one thing allowed to clear the baseline**」；`plugin/plan.ts` 的 context 钩子注释也在刻意 "append near the tail so the cached prefix stays warm"。**任何每步生效的回收/置换都会持续丢 provider cache 命中。** L17 把这条从"论证"升级成"可测断言"，L34 给它配归因，所以排期是 L30 → L17 → L34 → L6 → L25。

### 5.1 反膨胀闩锁

现状：`due` + `SHRINK_STEPS` + `MAX_COMPACTIONS_PER_TURN`（`实测` = 4，且 `compaction.ts` 在 `trigger.reason !== "manual"` 时用 `summarizedThisTurn` 比较该值——manual `/compact` 豁免）管的是"请求被 provider 拒"和"一轮别压五次"。**没有任何一处检查这次压缩到底省没省。**

适配做法（不新增持久字段，遵守 C6 引的那条否决）：`due` 在同 turn 已有 checkpoint 时再次命中 ⇒ 视为上一次没省够 ⇒ 本轮不再排新摘要，直接走截断兜底。与 `compaction.stalled` 的区别：后者到 4 次才收束，本守卫在**第一次**没省够就降级，省下 3 次 summarizer 开销。

gemini 的对应实现（`COMPRESSION_FAILED_INFLATED_TOKEN_COUNT` 丢弃 + `hasFailedCompressionAttempt` 闩锁）标 `子代理`：**落地前先逐行读** `gemini-cli/packages/core/src/context/chatCompressionService.ts`。若"第一次没省够"无法从现有 fold 得到，就退回成在 compaction 行上记一个已存在的 size 字段，并补一份 `doc/records/` 计划。

### 5.2 旧工具结果 → 一行占位

**缺口不是裁剪不够狠，而是没有第二次机会**：`MAX_LINES = 2_000` / `MAX_BYTES = 50 * 1024` 之后（`实测`），二十条各自合规的结果仍是二十条 × 最多约 12k token。C5 已三次确认磁盘 spill 存在——所以**不新建缓存、不加 URI scheme、不动 `read` 协议面**，只置换文本：落在 `compaction.keep.tokens`（默认 15 000）之外的工具结果，在压缩重建时置换为

```
[read output omitted; N lines at <outputPath> — use read with that path if needed.]
```

文本要保留**区间**（`doc/context-economics.md` 已写标记报告两个区间，如 `lines 1-1000 and 4001-5000 of 5000`），别退化成只给路径。

- **摊平阈值**：可回收总量超过 `PRUNE_MIN_STALE_TOKENS`（起步 30 000 token）才做，取 gemini `DEFAULT_MIN_PRUNABLE_TOKENS_THRESHOLD = 30000` 同义值（`对方实测`）。
- **配对不变量**：`call` 在保留窗口内的结果永不回收；绝不留下找不到配对的结果或反之；违例返回**未回收**上下文（防 provider 400）。
- 采纳 #7 想清楚的那半句：省略提示要显式写"重跑只读工具是安全的，**不要**为找回输出去重复有副作用的动作"——这句同时是 L1 的减压阀。
- 度量：回收 token 数记在摘要结果旁。
- 与 L1 的交叉：被置换的结果仍带工具名，重复调用的键不变。在 `session-runner-loop.test.ts` 加"既循环又压缩"的会话验证。

### 5.3 旧附件占位

`packages/core/src/session/runner/to-llm-message.ts`（`实测` 存在）里，非最后一条 user 消息的 file/image part 是否原样进请求？**待验证**（#9 自己也标"验证后补"）。是则同样置换为路径占位，与 5.2 同一装配点、同一配对纪律。省的是 `IMAGE_TOKEN_ESTIMATE` / `PDF_TOKEN_ESTIMATE` 这两笔 flat charge。

### 5.4 测试与 doc

测试扩到 `packages/core/test/session-compaction.test.ts`（该文件的 ASCII 精确 token 断言正是"只有该动的动了"的证明；Han 会话跨 ceiling 与 `compaction.stalled` 钉住的用例不得回归）。doc：`doc/context-economics.md` 新增一节 + 若干 `Decisions`，必须写清 **5.2 与该文档已否决的"对一条结果的中间段做 LLM 摘要"不是同一件事**（界限：零请求、只留路标、完整字节在盘），否则六个月后的读者会以为我们反悔了。同时并入 #9 与 goose 轮同判定的结论：前缀 hash 失效校验在我方"架构已解决"（事件 append-only + 投影重建）。**新前置**：本项会改前缀字节，与 L17/L34 的次序不是可选项——**先有归因再动历史**，否则回收本身会被计入一条 `drift:`，量不出谁动了命中率。

---

## 6. L7 行为评测 + 可信度分级 + pass^k + 台账 + 行为位

**为什么值得做**：五家对比里只有 gemini-cli 有 live-model 评测（`实测` 本仓根目录无 `evals/`）；**goose 的 `evals/harbor/` 已经把 opencode 当对照组跑**（快照一行 `opencode-sonnet46-full 52.8%`）；aider 的 `benchmark/` 给出最后一跳——**跑分决定默认行为**。外部已经在替我们测了，缺的是自己的量具。

**断言源是 durable 工具记录，不是回复文本。** 走 `script/session-efficiency.ts` 已在用的端点（`/api/session`、`/api/session/:id/context`，认证沿用其 `service.json`/`service-local.json` 读法），这样读到的就是模型真正看到的投影，和 §5.2、L1 的判据同源。不依赖 telemetry 导出（`实测` 只有 opt-in 的 `packages/util/src/observability.ts`）。

**第一阶段，九条全确定性、无 judge**：

| 评测 | 断言 | 服务的项 |
| --- | --- | --- |
| `no-repeats` | 刻意造出交替循环的任务在步数预算内结束 | L1 |
| `poll-is-not-a-loop` | 同参不同结果的轮询**不得**被打断 | L1/C4 配重 |
| `declined-not-looped` | 同一被拒权限连撞 8 次收束，文案是"用户决定"而非"空转" | L1 ③、L3 |
| `stop-when-done` | 两文件小修在 N 步内 idle，无 loop 类拒绝 | L1 误打断配重 |
| `frugal-reads` | `read` 必带 offset/limit、累计行数在预算内（gemini 定量断言范本，`对方实测`） | 独立 |
| `answer-not-act` | 解释型 prompt 下无 edit/write/patch/shell 成功事件，`git status --porcelain` 干净 | 独立 |
| `compaction-recall` | 压缩后仍能答出被压掉的某个具体事实 | L8/L28 量具 |
| `well-formed-rate` | 循环内畸形产出计数直接作为指标输出（对应 aider 的 `percent_cases_well_formed`） | L1 ④、C20 |
| `refactor-is-not-hollow` | AST 不变量：目标函数仍在顶层、子节点数偏差 `< 10%` | aider §3.2 的重判据，只进评测层 |

**可信度分级**（`对方实测` `gemini-cli/evals/test-helper.ts` 的 `EvalPolicy = 'ALWAYS_PASSES' | 'USUALLY_PASSES' | 'USUALLY_FAILS'`、`it.fails`、`readToolLogs()`）：`always` 进 PR 且阻塞；`usually` 在 PR skip、只跑 nightly；`usually-fails` 登记为已知退步，可见但不挡路。晋升门槛取 `gemini-cli/scripts/get_trustworthy_evals.js` 的 `PASS_RATE_THRESHOLD = 0.6`（每日地板）与 `AGGREGATE_PASS_RATE_THRESHOLD = 0.8`（每周信号，`对方实测`）；PR 上 Best-of-N（4 中 2）。**最关键一条**：0/3 时对 `origin/dev` 重跑以区分"既有失败"与"本次回归"。缺这步，第一条 flaky 的阻塞评测就会让人开始无视 CI。

**pass^k / 熵值**（cline §11）作 nightly 聚合数学：pass^k 是 Best-of-N 的连续化形式，flakiness 熵用来排"该降级哪条"。纯函数、独立可测、不进 PR 判定路径。

**隔离纪律（先于任何代码，C20）**：aider 的 `benchmark.py` **在没有 `AIDER_DOCKER` 时拒绝运行**（`实测`）——不执行未经审的 LLM 产出物。我方评测必须在容器或 worktree 里跑；否则评测本身是 RCE 面。这是本项的第一条验收，不是最后一条。

**台账文化**（goose §7.5 + aider §4.5）：每次 run 记 pass 率 + tokens + turns + cost + 可追溯的 commit 与模型，**结果快照提交进版本库**；「贵到不能进 CI 就明说不进」写进文件（goose 的 tool-call conformance 扫描注释原文就是"刻意不是 PR 门禁"）——这条解决 `always`/`usually` 分级在文档里最难写清的部分。

**第二阶段：台账 → 行为位（P2，严格后置）**：只有台账能稳定复跑，才把结论编译进 `packages/schema/src/model-compatibility.ts`（`实测` 该文件已有 `reasoningField`/`requireReasoning`/`maxTokensField`/`requireFinishReason`/`requireAssistantAfterTool`/`supportsPromptCacheKey`/`cacheFormat`/`mediaInput`）。加字段便宜，贵的是产生填它的证据。这一跳不做，评测就只是贴给人看。

**追加两条指标**（本轮）：`ran-without-asking` 分布（L31 落盘后才有数据，同时是 L19 三条规则的验证面）与 `undeclared-drift` 计数（L34 输出，作 cache 健康度而非通过率）。两者都属"同一个数既是熔断阈值又是评测口径"（C20/C16），**不要在评测层重新计算**。

**形态**：放**仓库根 `evals/`**，不做 `packages/evals`。`实测`：`turbo.json` 定义了 `test` 任务（`"test": {"dependsOn": ["transit"], "outputs": []}`），CI 跑 `bun turbo test --affected --concurrency=3`（`.opencode/skills/unit-tests` 明写），根 `test` 脚本本身是 `do-not-run-tests-from-root` 护栏；根 `evals/` 不在 workspaces（`packages/*`、`packages/plugins/*`、`services/*`、`packages/console/*`、`packages/stats/*`）里，天然不被 turbo 采集。**落地后重跑 `bun turbo run test --affected --dry` 确认没有新任务被收进来。** workflow 用 `scheduled` + `workflow_dispatch`，PR job 只跑 `always` 档。取数复用 `script/session-efficiency.ts`，不另实现一份时间切分。

**不做 LLM-as-judge**（gemini 的 3 次并行多数表决、goose 的 SmartApprove judge 亦缓行）：它需要同一套可信度机制才可解释，且会在确定性那批还没产出信号前就继承成本。九条稳定后再评。

---

## 7. 其余 P1/P2 项

### 7.1 L9 定时任务 + recipes（C10 并项）

架构取 cline #6，作者面取 goose：

- 规格真源 `<workspace>/.opencode/schedule/*.md` + 全局目录，YAML frontmatter（`cron`/`run_at`/`timezone` + `agent` + `model`）；watcher（沿用 `config/watch.ts` 模式）→ **reconciler 单向同步进 DB**；watcher 永不执行，执行只读 DB；解析失败记录状态、不抛（坏文件不拖垮 sweep）。
- goose 补件（`对方实测`）：`instructions`（system 侧）与 `prompt`（首条消息）**分离**；typed 参数 `string|number|boolean|date|file|select` + `requirement: required|optional|user_prompt`，缺参交互补填；**`input_type: file` 不允许 default**（防导出敏感文件）；`response.json_schema` 校验最终输出；`{{recipe_dir}}` 让规格携带同目录脚本；严格模板 + 不可解析变量过滤（保护用户文本里的花括号）；模板继承限定目录内并 canonicalize + `starts_with` 校验（防路径穿越）。
- 调度侧防篡改（`对方实测`）：job 行只存 `(id, cron, recipe_path, params)`；执行时把规格**复制**进受控目录（1 MiB 上限、`O_NOFOLLOW`、0600）——防"排了一个之后被改掉的文件"；session 记 `schedule_id` 供溯源。**这两条不在 cline #6 里，是并项的净增益。**
- **编排可重放约束**（codewhale §5 的 QuickJS：覆盖 `Date`/`Math.random` 使其抛错以保重放，`VmLimits` 32MiB）：规格里凡是"取当前时间/取随机"的部分必须显式声明，否则同一次调度的两次执行不可比。
- 执行与恢复（cline #6）：常驻服务每 30s 扫 `next_run_at <= now`；单条 SQLite 事务 CAS 认领（`claim_until`/`claim_owner`，影响行数 0 即跳过）；崩溃恢复 = `claim_until` 过期可重跑，**at-least-once**，doc 写明这是语义而非 exactly-once。
- agent 工具 `schedule`（`create/list/pause/resume/delete/run_now`）+ 新权限 action `schedule` 默认 `ask`。**按 C10 拒绝「执行时强制 Auto」**：无人值守走规格指定的 agent ruleset。
- 表 `schedule` / `schedule_run`（snake_case、Drizzle 规范，类型进 `packages/schema`，遵守 Schema→Core 方向）。
- 测试：spec 解析（BOM/CRLF/坏 frontmatter 不抛）；并发 sweep 同 id 只成功一次；cron 计算含 DST 与过去的 `run_at`；`run_now`；权限默认 ask；**规格被改动后执行用的是快照不是当前文件**。时间轮转用 `Clock` test layer，不 sleep。
- doc：新 topic doc `doc/schedule.md`（机制、认领语义、at-least-once 决策、快照语义），`doc/conventions.md` 的 change map 加一行；产品文档新页；`doc/permissions.md` action 清单加 `schedule`。

### 7.2 L19 审批安全三规则（goose §4.2）

① headless + 非自动审批模式**直接报错拒绝运行**（Auto 才 auto-allow 并 warn）——"非交互不允许静默自动放行"是安全契约不是默认值；② provider 下发安全提示时**禁用 "Always Allow"**；③ 审批 JSON 逐行做**双向控制符消毒**（U+202A–202E），防终端视觉欺骗让用户批准没看到的参数。

我方三条现状均 `UNVERIFIED`，先核 `packages/tui` 审批 UI 与 headless/`run` 路径。第 3 条与 `doc/permissions.md` 威胁模型直接相关；第 1 条按 C15 是**行为护栏**级别，不要写成沙箱承诺。**与 L31 是同一证据面的两半**：没有落盘就验证不了三规则是否被绕过，所以 L19 排在 L31 之后。与 L3、L1 第③类的文案属同一契约面，协调先后（`doc/conventions.md` 的 contract token 规则）。

### 7.3 L20 子代理收口五件套（goose §4.1，与 codex M4 同 PR 组）

`嵌套委托硬阻断`、并发上限（goose 默认 5）、`子代理是完整持久会话 + parent_session_id`（可 resume 可审计；delivered note 记在消息 metadata ⇒ **父代理重启后不重跑已完成委托**）、`确认请求换 id 转发给父会话客户端`、`强制产物契约工具`（提交 `{"summary": ...}`）。

`实测` 我方 `tool/plugin/subagent.ts` 已有前台/后台/通知与 `sessionID` resume，`job.ts` 的 `Background.recovery` 有 `kind: "subagent"`，深度上限是 `experimental.subagent_depth`（默认 1）。**缺口正是"没有树预算"**——第 3 件先核对 `Background.recovery` 是否已防重跑（已防则只写 doc 结论，不重复实现）。并发上限与产物契约是纯新增。goose 把并发纪律**直接写进 delegate 工具描述**（"delegates cannot coordinate; same-file work = conflicts"）这条零成本、值得抄。codewhale §5 的 `ChildGrant::resolve`（preset 与 profile 取 min 单调收窄、新建 run 拒绝继承权限字段）记入 L12，等真有多 worker 需求再借。

### 7.4 L21 权限演进包 / L22 / L23

- **L21（三项一个 PR 组，与 codex M1/M3 合并讨论，§8.6）**：
  - **参数级 allow + 过期**（goose §4.3）：`ToolPermissionStore` 按 `tool_name + hash(arguments)` 粒度持久化并支持 `expiry`——同名工具换参数再问。`实测` 我方 `permission.ts` 的 allow + `shell/danger.ts` 的 `BANNED_SAVE` 是工具级收口，`permission/saved.ts` 无参数粒度、无过期。**按 C14 只借存储**：折叠顺序一字不动，并写一条测试证明顺序未变。
  - **`SafetyLevel` 分级**（codewhale §4.4，`对方实测`）：只有 `Safe|WorkspaceSafe` 的命令允许存为持久 allow，且强制 `command_exact=true` + workspace 限定；Critical 与 repo-law 提示**永远不给"保存 allow"**。`实测` 我方已有两道防线（`BANNED_SAVE`、`packages/tui/src/util/permission.ts` 保存前的 patterns 预览），缺口精确是**没有中间档**——不在 `BANNED_SAVE` 名单里的中危命令仍可存成通配 patterns。补一个复用现有 `ShellParse.scan` 结果的分级，把中危降到"仅 once"。
  - **mid-turn 权限收窄偏序**（codewhale §4.3，`对方实测`）：posture 是可比较偏序 `Never < Suggest < Auto < Bypass`；turn 中改模式不重启流式响应，在下一工具批/审批门生效；**已批准的调用仅在新 posture 等宽或更宽时存活**，否则以 typed 错误退回模型在新 posture 重试（注释原文 "approving must never invalidate the call it approves"）；子代理每次调用**重读实时 posture** 而非 spawn 时快照。`实测` 我方 `packages/tui/src/context/permission.tsx` 是 `"prompt" | "autoaccept"` 二值、session 级，无偏序也无 mid-turn 语义。这是本组唯一**需要先做设计**的一块：它要求把权限态收敛成可比较结构，而那个结构正是 codex M1 的决策代数——分头做会互相挡住。
- **L22 turn-budget 软提示**（goose §4.7 后半）：预算过半后注入 `<turn-budget>n/m used</turn-budget>` 让模型自行收敛而非硬砍。价值真实（我方 step 预算对模型完全不可见，只有到限后追加 `MAX_STEPS_PROMPT`）。**形状不可借**：对方是 **user 角色**的 agent-only 消息，我方否决过"伪装用户轮"（C13）。内容走已有合成注入通道并核对不触发 promotion/inbox。**它也是 L1 的减压阀**：预算可见后硬砍触发率应下降，用 L7 验证。（codewhale §6 另有一条反向印证：我方 `MAX_STEPS_PROMPT` + 为保 cache 前缀而保留工具定义的做法，与它的 A2 行为"一字不差同款"，无需新增。）
- **L23 inspector 管线**（goose §4.4，P2）：`ToolInspector` + `InspectionAction{Allow, Deny, RequireApproval(reason)}` + 顺序跑所有 inspector；安全命中转 `RequireApproval(原因 + finding_id)` 融入人审流而非另开 UI 通道。这是 codex 决策代数的低配先声——**先落管线形状，代数本体仍按 codex M1**。约束（C14）：新增 inspector **只能加严**，绝不引入「命中 allow 就跳过危险检查」的短路。`AdversaryInspector`（用户规则文件）与 `EgressInspector`（外带检测）作为该管线的两个首批消费者，不单独设计。

### 7.5 L10 / L11 / L24 / L12

- **L10 插件可靠性**（cline #8）：v1 = 每 hook/工具调用包 `Effect.timeout`、连续失败 ≥5 自动停用 + 广播 `plugin.disabled` + UI 可见、停用持久到 `packages/core/src/kv.ts`；v2 = Bun worker per plugin + structured-clone RPC + 空闲回收。**与 L1 的接口**：L1 的收束只管模型行为，插件停用是另一条止损，二者不共用计数器。
- **L11 快照恢复防御**（cline #10 + codewhale §5）：恢复事务性（先捕获当前态作回滚点）、HEAD 前移拒绝（`update-ref` CAS 关竞态）、未跟踪文件快照成本、运行编号跨压缩稳定（事件溯源下 messageID 稳定，**大概率已解决，验证后记结论**）。**本轮追加 path-scoped 撤销**（`对方实测` `restore_path_plan(_with_backup)`/`path_matches_snapshot`/`snapshot_owners()` 只认本会话标签/`wait_for_pending_post_turn_snapshots()`）：只恢复「该请求改的且**未被动过**的路径」（不吃掉用户手工编辑）、恢复前备份 + preflight 复验；对方那个"等待 pending post-turn 快照"的竞态修复（其事故编号 #6644）我方 L11 的时序验证应覆盖。不紧迫，排在 L11 结论之后。
- **L24 工程实践包**（13 条，各自独立、每项 ≤0.5 天）：① **MCP 录制回放**（goose §7.1）——`GOOSE_RECORD_MCP` 式环境变量切 record/playback + 提交在库真实转录；`实测` 我方 `packages/http-recorder` + `packages/core/test/session-runner-recorded.test.ts` 已是更强形式，缺的是**接到 MCP 子进程 stdio**（`mcp-import-boundary.test.ts` 只守 import 边界，`mcp/client.ts` 对真实 server 行为无回归等价物）；② **对抗性 MCP fixture server**（goose §7.2：伪造宿主保留 meta、点号名冲突、`tools/list_changed`/`late_tool`、elicitation、二进制图片），与 L16 是同一防御面的测试侧；③ **MCP conformance 进 CI**（goose §7.6：官方 conformance + expected-failures baseline），排期与 codex M2 的聚合 required job 一起（§8.7）；④ **面向 LLM 的全站文档地图生成器**（goose §7.4，与 L27 是不同产出物）；⑤ **AI reviewer 补"何时沉默"**（goose §7.3）；⑥ **外发在测试层用配置关掉而不是 mock 全局**（aider §7.1，`pytest.ini` 的 `env = AIDER_ANALYTICS=false`）——对应我方 OTLP/update check 应有配置级关闭而非 monkeypatch；⑦ **错误文案与去处同表登记**（aider §7.2 的 `urls.py`）——`实测` 我方错误文案散在 `publish-llm-event.ts`/`provider-error.ts`，且 `doc-refs.ts` **只校验仓内路径不校验外链**；这也是 L1 第④类文案的落点；⑧ **配错模型名给 "Did you mean…"**（aider §7.3）——CLI/headless 是否等价 `UNVERIFIED`，先一次 grep 定生死；⑨ **启动慢因写进注释**（aider §7.5）；⑩ 记录已有等价物防重提：**模型目录版本化磁盘缓存**（aider 轮记为 `models-dev.ts`）；⑪ **文档自标成熟度**（codewhale：80+ 篇多数是实现，且主动声明哪些没做并给 Phase 表）——与 L7 的「贵到不能进 CI 就明说不进」同一条纪律，成熟度写进文件而不是靠口头；⑫ **回归测试名写进设计文档**（codewhale 的 `AUTHORIZATION_ORDER.md` 挂着测试名）——`doc-refs` 测不到的方向（它管路径不烂，不管"决定 ↔ 测试"绑定），**建议 L33 的字段里加一列 test 名**；⑬ **agent 维护 agent 项目的治理规则成文化**（`AGENT_ETHOS.md` + `ISSUE_TRIAGE.md`：agent 预审社区 PR 但人保留合并权、贡献者信用机读化、`needs-info` 陈旧清理）——fork 若要引入 issue 自动预审，先读它而不是从零写规则。
- **L12 路线图**（P2，只记方向不设计）：Hub 生命周期（drain → upgrade → 协议不符时旧服务退役 + 断线按单调序号续传）、Zen 派发即走、NDJSON 无头协议、MCP 进阶（`mcp-remote` 改写、stdio 双帧探测、MCP Apps UI）、**Code Mode 编排对照检查**（goose：Boa 沙箱里 `tools.call()`，只暴露 `list_functions`/`get_function_details` 签名；`实测` 我方已有 `packages/codemode`，所以是"对照检查暴露面是否同样收窄"）、**文件内 `AI!`/`AI?` 协议**（aider §4.4：`@parcel/watcher` 那层我方已有且不弱——`filesystem/watcher.ts`、`location-watcher.ts` 把 watch 目标定位到 `<gitDir>/HEAD` 以感知外部分支切换、`file-watch.ts` 的 per-file 订阅/TTL/上限；缺的只是"注释是指令"这层语义。两个硬前置：投递必须是 `session.inbox.enqueued` 合成项，且**必须默认关闭**——文件注释变成可执行指令等于给任何写入文件的文本开一条注入面）、**脏工作区待核**（aider §4.2：`实测` 我方无 dirty 检测/stash/守卫，隔离哲学是**换 worktree 而不是兜底**（`worktree/strategies.ts`、`Git.worktree.create`），undo 靠 `Snapshot` + `revert.ts` 用独立 git-dir **绝不碰用户仓库历史**；aider 的 dirty commit 之所以必要正因为它的 undo 依赖提交。剩下的真收益只在非 worktree 场景，而 rail 的 `git commit --only … -- <paths>` 已限定路径集——降级为「先复核会不会混」，会混再做，且必须走 permission 通道）、**shell 语义展开**（codewhale §5：`对方实测` 2,448 行 `shell_expand.rs` 把命令展开成"shell 真会执行的每一条"逐条匹配 deny，展开不了标 `Expansion::dynamic` 并在有 deny 规则时 fail-closed；可做子集融入 `shell/`，与 codex M1 第 7 轮一起设计）、**Guardian / Auto-Review 熔断三件套**（确定性地板 + 一击式无状态复核 90s fail-closed + 拒绝阶梯用 read 内容 SHA 判"无新证据"；**前提是我方先有 Auto 档**，故在 L21 之后；对方明确不复制 transcript 重建上下文以防"模型脑补授权"，这条取向值得记）、**记忆面**（`#` 前缀快速记忆**不发模型 turn**、FTS5 可重建索引、注入块标记为不可信；`实测` 我方无用户记忆功能，做不做是产品决策）。

---

## 8. 开放决策点

1. **L1 要不要配置项、默认开还是关**（C7）。建议常量阈值 + 保留开关默认开，前提 `poll-is-not-a-loop` 同 PR；若拒绝 C4 只抄连击判据，默认必须关——**这两条取舍绑定，不能一半抄 #1 一半按 G1 的默认值**。若保留开关，L1 是 L33 注册表的第一行。
2. **L2 的接入点**：`shell.ts` 执行器能否拿到当前 agent。
3. **L9 的 sweep 归属**：全局 sweep + Location 键过滤（建议）vs 每 Location 自扫。
4. **L9 的默认权限**（C10 已定方向）：确认**不引入** goose 的强制 Auto。
5. **L8/L18 的 LLM judge 与 lossy 压缩缓行**；若 L18 实测显示折叠后仍超预算，允许 M7 P5 四级 lossy，但把「折叠是确定性、压缩是 lossy」写进同一条 doc 决策。
6. **L21（权限演进包）/ L23 与 codex M1 的排期归属**：三处都在动权限面，且 §7.4 的偏序结构**就是** M1 要产的代数。强烈建议合并成一个讨论轮。
7. **L24 第 3 条（MCP conformance 进门禁）是否与 codex M2 的聚合 required job 一起落**，避免两次改分支保护。
8. **文件名**：本稿含五份来源，文件名仍叫 `借鉴技术方案-cline-gemini.md`。是否改成 `借鉴技术方案.md` 作为唯一入口。
9. **决定 L26 生死**：**验证属于循环还是属于模型？** 若"归模型"，L26 只剩「formatter 失败不能再被静默丢掉」这一小半（`实测` 现在是 `return false` 后静默回读原文）；若"归循环"才是完整一项。共识题，未定不写码。
10. **客户端匿名遥测采样**（aider，产品决策非行动项）。`实测` 现状：本地统计无上报、外发只有默认关闭的 OTLP、`config.ts` 的 `username` 注明用于 telemetry identity 但无采样器也无本地聚合。
11. **L27 的 `config.json` 权威产物位置**：继续只由站点 build 产出，还是入库好让 `check:generated` 比对。接线的第一次设计选择。
12. **决定 L36**：env 白名单是否以"已有显式逃生口"为默认开的前提。对方敢默认开是因为有 `shell_env` 钩子；我方若无等价钩子，就先只做 L37 脱敏面，白名单挂 experimental 默认关跑一个版本。
13. **决定 L39 的优先级**：fork 是否要让 `auto` 更新档重新可用？现在的做法是分发前设 `"update": "disable"`，等于用"不能回滚"换"不被上游覆盖"。回滚落地后这个交换就不必存在——产品取向问题，不是技术问题。

---

## 9. 明确不做（五份并集，去重）

| 项 | 理由 |
| --- | --- |
| 进程内循环/熔断状态 Map | C1；`doc/session-loop.md` 已否决。六个来源里 kimi/gemini/cline 错，goose/aider/codewhale 对 |
| **steering 中途抢占 in-flight 请求** | C25：我方「steer 在安全 step 边界交付」是写下的设计决定（`doc/session-loop.md`、`AGENTS.md` delivery 词汇），不是缺失；对方自己也为此要保留 partial text、丢弃 reasoning |
| **审批决定升级为 durable 事件（改 `SessionEvent` 词汇）** | C23：走投影表。事件词汇与聚合语义是更贵的改动，收益相同 |
| **OS 级沙箱** | codex 清单已判。goose 轮：goose 本身也没有；codewhale 轮：其沙箱仅 macOS/Linux，Windows `is_available()` 返回 false **且有测试断言不宣称**。可学"探测不过就如实报 none"，不是沙箱 |
| **一次性摘要式压缩**、`REMOVAL_PERCENTAGES` 中间向外删、前缀 hash 失效校验 | 我方 `TRANSCRIPT_LEVELS` 分级撤下与 append-only 投影已覆盖（#9 与 goose 轮同判"架构已解决"）；只借 L8 的格式层 |
| 预算二分替换 `SHRINK_STEPS` | C19；`refuse`/guard 形状也不改变这一点 |
| `max(估算,实报)` 兜底；`opencode://result-cache` scheme + 16 MB 内存缓存；每步 masker | C5（三家佐证）/ C6 / §5 的 cache 论证 + L17 + L30 |
| LLM 层循环诊断、内容层 chunk-hash 检测、LLM-as-judge（gemini 多数表决、goose SmartApprove） | 与 `doc/context-economics.md` 同一取向（transcript 多是代码，重复是代码的性质；gemini 自己在围栏块/表格处重置检测并代码块内禁用）；judge 需要同一套可信度机制才可解释 |
| `never > always > ask` 折叠；`SwitchCoder(Exception)`；moim / turn context / `reflected_message` 的 user 角色注入形状；goose 的 todo 反模式提示词 | C14 / C13 / §3.7；分别见 `doc/records/2026-10-permission-fold-ordering.md`、伪装用户轮否决、与 `todo-residue` 判据相反 |
| 每请求全量 repo map / 符号索引子系统 | aider 已判（跨请求字节不稳定，直接撞 L17/L34）；codewhale 的机制层不改变结论。**只借 L29 的预算算法** |
| `/undo` = `git reset --hard` | 与 snapshot 独立 git-dir、绝不碰用户仓库历史冲突；aider 的 dirty commit 之所以必要正因为它 undo 依赖提交 |
| 运行时正则扫输出判"偷懒"；litellm 级依赖与 2 万行单包；`commands.py` 1712 行单类；`/help` 的 embedding 检索；playwright/whisper 进主包 | aider §6/§7：抄错形状就只剩正则（它的价值在**每模型数据位**）；依赖会破坏 `bunfig.toml` 的 `exact = true` + `minimumReleaseAge = 259200`；其余与自导出模式、收益成本相冲突 |
| 错误变体漂移检测（aider 23 条表 + `_load()` raise）；transcript 重放测试（`--replay`）；崩溃预填 issue；模型目录版本化磁盘缓存 | 我方有编译期等价物（`实测` `provider-error.ts` 的 `const exhaustive: never`）、更强的 HTTP 边界 cassette、`error-component.tsx` 已预填 issue 模板、`models-dev.ts` 已有 v1/v2 + versioned keys |
| **大输出落盘**、**工具目录头排序 + final step 保工具字节**、**双轨估算**、**长度截断续跑断路器**、**幻觉调用具名失败**、**保存前 patterns 预览**、**「always」批量重评 pending**、**typed-first 错误**、**`.claude`/`.agents` 兼容根** | codewhale §6 实测列清的九项「已有等价物」（排序与 cache 注释由 C21/C22 独立复核为真；`always` 批量重评我方粒度还更高——`实测` `permission.ts` 有 `pending` Map 与一次 `Effect.forEach` 重评）。**列在此处是为了阻止第 7 轮把它们当缺口重提** |
| `/doctor` 的消息双可见性字段；PET_MODE；云派发/GitHub App；IM bridge；Termux/HarmonyOS；语音；read_media；marketplace 四格式解析器 | 为一个功能加持久字段不值；其余与 fork 定位无交集 |
| 扩展 marketplace + 安装签名（HMAC + keychain）；Actions SHA 固定 / lockfile 拒 git-http / dependabot / blob-size / 截断标记带原始量 | 分发单元是代码插件（签名那一半可分离：`plugin/source.ts` 有 reload 摘要无安装期锚）；其余已由 codex M2/M7、kimi 第 6 项立项。**注意 C24 已把「manifest 保鲜」这条撤下理由收窄**为仅指 wire/state manifest 与路由快照，配置面接线（L27）与特性注册表（L33）不再被它覆盖 |
| IDE companion 以 MCP 承载 UI 状态；Clearcut；`memory-tests/` 照搬；roam/iroh P2P；Temporal 调度依赖；全屏 TUI → 行式 REPL | `gemini-cli-技术方案.md` §8 + goose §6（Temporal 是 goose 自己已弃用，反向印证 in-process cron） |
| gemini 的 `contextManager` 图流水线 | 与 measured anchor + `InstructionBaseline` 冻结是两套心智模型；L6 有效后再评估 |
| cline 的 JSON 文件转录、per-tool approve 模型 | cline 通用规范已写"不照搬弱于本 fork 的机制" |

---

## 10. 复核命令

本稿的存在性判断由这些命令支撑（2026-10-31 于上述基线跑过）：

```sh
# 我方缺口
grep -rnE "repetition|loopDetect|isLoop|stuck|malformedCount" packages/core/src   # 无循环检测、无计数
grep -rn "empty response" packages/core/src/session --include=*.ts                 # 0（L14）
grep -n 'classification: "incomplete-stream"' packages/core/src/session/runner/step.ts   # C13
grep -n "InputFailureReason\|failMalformedToolInput\|INPUT_EXCERPT_LIMIT" packages/core/src/session/runner/publish-llm-event.ts  # 判定有、计数无（C16）
grep -rn "warm_cache\|keepalive" packages/ai/src packages/core/src --include=*.ts   # 只命中入站 SSE（L25）
grep -rn -i "budget" packages/core/src/instructions/ packages/core/src/session/context.ts            # 0（L32）
grep -rn -i "shadow\|conflict\|duplicate" packages/core/src/config/plugin/skill-scan.ts packages/core/src/skill/instructions.ts  # 0（L32）
grep -n "ephemeral" packages/schema/src/permission.ts                               # Asked/Replied 不落盘（L31）
grep -rn -i "receipt" packages/core/src --include=*.ts                              # 0（L31）
grep -n "inputSchema" packages/core/src/tool/mcp.ts                                  # 裸透传（L30）
grep -rn -i "contrast" packages/tui/src/theme/                                       # 0（L35）
grep -n "extendEnv" packages/util/src/cross-spawn-spawner.ts packages/core/src/mcp/stdio.ts  # 全量继承（L36/L16）
grep -rnE "Date\.now|toISOString" packages/core/src/session/model-request.ts         # 0（L17 时间维）
grep -rn "JobObject\|CREATE_SUSPENDED" packages/core/src packages/util/src           # 0（L15）
grep -rn "DISALLOWED_KEYS\|LD_PRELOAD" packages/core/src/mcp                         # 0（L16）
grep -n "PermissionMode" packages/tui/src/context/permission.tsx                     # 二值态（§7.4）

# 我方已有（C5/C6/C18/C21/C22 的实物）
grep -n -A2 "Array.from(direct)" packages/core/src/tool.ts                            # 工具按名排序（C21）
grep -n -B2 "toolChoice" packages/core/src/session/runner/llm.ts                      # "Keep tool definitions … cached prefix"
grep -n "Model.small\|small: Effect.fn" packages/core/src/model.ts packages/core/src/session/context.ts
grep -n "model: agent.model" packages/core/src/session/compaction.ts
grep -nE 'DIRECTORY|RETENTION|MAX_LINES|^export const RECORD' packages/core/src/tool-output.ts
grep -n 'inline acyclic local references\|\$defs' packages/core/src/tool/runtime.ts
grep -n "const exhaustive: never" packages/ai/src/provider-error.ts
grep -n 'Only execute.before may fail' packages/plugin/src/effect/tool.ts
grep -n '"ignore"' packages/core/src/formatter.ts                                     # L26 的静默失败
grep -nE "MAX_COMPACTIONS_PER_TURN|summarizedThisTurn|const clip" packages/core/src/session/compaction.ts
grep -n "action: "edit"\|action: "shell"\|name = "shell"" packages/core/src/plugin/plan.ts packages/core/src/tool/plugin/shell.ts
ls -d evals 2>/dev/null | wc -l ; grep -A2 '"test"' turbo.json
grep -rn "config-schema" packages/console/app/package.json ; sed -n '1,30p' packages/schema/script/config-schema.ts
bun script/doc-refs.ts | tail -1                     # 31 documents / 158 paths / 0 problems

# 对方承重符号
grep -nE "TOOL_CALL_LOOP_THRESHOLD|slice\(-k\)|expectedKey|arguments and outcomes" ../github/gemini-cli/packages/core/src/services/loopDetectionService.ts
grep -nE "ALWAYS_PASSES|USUALLY_FAILS|readToolLogs" ../github/gemini-cli/evals/test-helper.ts
grep -nE "PASS_RATE_THRESHOLD|AGGREGATE_PASS_RATE" ../github/gemini-cli/scripts/get_trustworthy_evals.js
grep -n "DEFAULT_STOP_HOOK_BLOCK_CAP" ../github/goose/crates/goose/src/agents/services.rs      # 本轮亲测 = 8
grep -n "MAX_EMPTY_RESPONSE_RETRIES" ../github/goose/crates/goose-agent/src/inference.rs       # 本轮亲测 = 3
grep -n "collapse_const_unions" ../github/goose/crates/goose/src/agents/tool_schema_normalize.rs
grep -n "Stable tool ordering" ../github/goose/crates/goose/src/agents/reply_parts.rs
grep -n "AIDER_DOCKER" ../github/aider/benchmark/benchmark.py                                  # 本轮亲测
grep -n "num_malformed_responses\|max_reflections" ../github/aider/aider/coders/base_coder.py  # 本轮亲测
grep -n "pub enum ApprovalDecider" ../github/Codewhale/crates/command-contract/src/facets/debug_receipts.rs
grep -n "DEFAULT_SCOPE_BUDGET" ../github/Codewhale/crates/config/src/instruction_budget.rs
grep -n "feature_registry_checks_catch_drift" ../github/Codewhale/crates/tui/tests/feature_registry.rs
grep -n "undeclared_drift_never_moves_the_pin\|PrefixCheck" ../github/Codewhale/crates/core/src/prefix_cache.rs
grep -n "CredentialShaped\|KeyBased" ../github/Codewhale/crates/sanitize/src/redact.rs
grep -n "previous_dir\|rollback" ../github/Codewhale/crates/release/src/autoupdate.rs
```

落地前仍需逐行读、本稿只标 `子代理` / `待验证` / `对方实测（X 轮）` 的十一处：`gemini-cli/.../chatCompressionService.ts`（§5.1）、`gemini-cli/.../toolOutputMaskingService.ts` 全文（§5.2 的配对形状）、`WriteTodosTool` 与 `llm-judge.ts`（§6 末）、`to-llm-message.ts` 的旧附件行为（§5.3）、每请求工具清单组装符号（L4/L17/L34 共用）、审批三规则的我方现状（L19）、`kv.ts`/cassette 的损坏路径（L29）、CLI/headless 的模型名纠错（L24 第 8 条）、纯 CLI 崩溃预填是否等价、**Codewhale 的 `receipts.rs` / `ask_rules.rs` / `child_env.rs` / `prefix_cache.rs` 实现体**（L31/L36/L34 的落地形状要照读，本稿只核了文件与符号存在）、**cline 与 aider 的实现体**。

---

## 11. 里程碑

| 里程碑 | 内容 | 出口标准 |
| --- | --- | --- |
| **W1（第 1 周）** | L30、L17、L1、L14、L13、L15、L16、L32、L27，各独立 PR；L2/L3/L4/L5 并行 | 合入 `dev`，`bun run check` 绿，doc 同 diff；L30 的字节恒等测试通过（它同时判定 C22 成立与否）；L17 断言跑出脏源或证明没有；L1 含"交替打断 / 轮询不误伤 / 8 次拒绝收束 / 畸形上限可见"四条；L27 的 `check:generated` 在人为漂移上一次红 |
| **W2（第 2–3 周）** | L31（落盘 + 纯函数 builder + 一个 surface）→ L37（脱敏器，第一个消费者是回执）；L7 第一阶段九条 + 隔离纪律 + 分级 + 台账；L33 注册表（**含元测试，否则不立项**）；L18 先测占比；L24 的 ①②③ | `not_recorded` 与四分归主有测试；评测在 nightly 有 ≥2 晚数据可判可信度；元测试能抓住一条人为漂移的注册表；schema 膨胀占比有数或本项作废并记 doc；MCP 回归有录像 |
| **W3（第 4–5 周）** | L29 → **L32 的裁剪改用二分** → L6 三个子 PR；L34 归因；L25（先量） | 大输出会话 context 占用下降**可量化**（回收 token 数 + `session-efficiency` 对比）；回收前缀未被打脏由 L17 + L34 双证；L25 有默认值依据或明确保持关闭 |
| **W4（第 6–8 周）** | L9、L20、L19、L35、L38、L39、**L26（若 §8.9 共识达成，否则只做 formatter 静默失败这一小半）** | cron 可建可认领可溯源且执行用快照；子代理有并发上限与产物契约；审批三规则能被 L31 的数据验证；主题对比度审计在 Indigo 上跑得出结果；更新有回滚 |
| **W5（其后）** | L28 + L8（同一 PR）、L10 v1、L11（含 path-scoped 撤销）、**L21 权限演进包与 L23（与 codex M1 合并讨论后）**、L36（观察期）、L7 第二阶段（行为位）、L12 | 摘要质量有数且换模型有实测背书；坏插件不拖死服务；折叠顺序未变的测试存在；行为位仅在台账稳定后才动 |

流程红线（沿用 `AGENTS.md` 与本系列惯例）：任何默认值变更或性能声称，先确认运行的后端 CLI 是新构建，再用 `script/session-efficiency.ts --title "<同一任务>" [--dev] --json` 做同 prompt / 同模型 / 同变体 / 同输出量的对比；没有可比数据就不许翻默认值（L25、L1 开关、L36、L39 是这条的四个落点）。Windows 行为级改动（L15/L16/L36）单列验证，不用 `skipIf(win32)` 掩盖。评测与任何执行模型产出的环节必须在容器/worktree 里（C20）。**记不到的必须写成 `not_recorded`，不许用默认值冒充。**

---

## 12. 会推翻本方案的事

1. **L30 的恒等测试失败或不需要**：若 `tool.ts` 的 snapshot 排序其实已经覆盖了 MCP schema 内部键序，C22 作废、L30 撤下。**这条不需要外部证据，W1 第一个 PR 的一条测试即可判定**——把它排最前正是为此。
2. **L1 打断了正确工作**（C4 想防的那类）。结果参与键之后仍出现，说明键太粗，修法是把作用域收到"同一 turn 内的同一键"，不是补内容层检测。
3. **L6 的占位符在后续步里被反复重读**。那意味着模型要的是上下文字节而不是路标，方向应退回 `doc/context-economics.md` 已否决的"让完整输出进历史"。
4. **L17/L30 之后 L34 显示漂移主要来自我方自己**（组装路径里有隐式非确定性，而非 provider/MCP server）。那会同时改写 §5 与 L25 的成本假设，优先级整体重排到"先修确定性"。
5. **L25 的 ping 实测不划算**（一次 ping 成本 ≥ 省下的重推，或空闲间隔本来短于 TTL）。**这是可预期结果不是失败**——aider 做成默认关的 opt-in 就是这个意思；结论若是"不开"，本项以"已实测并记 doc"收束，不留残件。
6. **L31 的投影表被发现违反 change map**：若审批决定最终必须进事件词汇（比如 UI 要跨端重放），C23 的推荐路就是错的，改走事件升级并同步 `doc/session-loop.md`。这条要早判，越晚改越贵。
7. **§8.9 的共识是"验证属于模型"**。L26 收缩成一句修复（formatter 失败必须让模型知道）——这一小半仍值得单独做，因为它是已核实的静默数据丢失。
8. **L32 的技能冲突披露引发"为什么不自动择一"的反馈**。那说明"可见但不动"的取舍是错的，需要重新设计 precedence 语义（对方是"列出不合并"，我方用户可能更想要"合并 + 告知"）。
9. **L7 的评测超过两晚仍达不到 60%/80%**。那意味着 live-model 断言在本仓不可长期维护，工作量转到 `packages/simulation` 的确定性 backend，第二阶段（行为位）直接取消。
10. **§5.1 的"压缩到底省没省"无法从现有 fold 得到**。那说明我对 `compaction.ts` 的读法不成立，先补 `doc/records/` 计划再动（参照 codex M6 的处置）。
11. **被本稿判为"前提错误"的任何一条（C5/C6/C17/C18/C21/C22/C24）是我误读**。风险最低的是 C17/C18/C21（都附可复跑命令且已跑过）；最需要盯的是 C24——它推翻的是**本稿自己**的撤下理由，若三层防腐其实可以合成一个脚本，就该合并而不是分三个 PR。
