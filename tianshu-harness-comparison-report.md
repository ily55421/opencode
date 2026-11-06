# 天枢 Tianshu-harness 分析与借鉴对比报告

> 分析日期：2026-11-07
> 分析对象：`D:\code\github\Tianshu-harness`（v3.37.4，公开仓为开发主仓的同步投影）
> 参照基线：本仓库 `D:\code\opencode`（opencode fork，`dev` 分支，v2.2.0-fork.1 基线）
> 结论先行：**天枢最值得借鉴的不是任何单个功能，而是三个工程立场——①把「交付有证据」做成运行时强制门而非提示词请求；②把「前缀缓存命中率」做成一级成本指标并配套防退化门禁；③把「事故复盘→回归测试→Known Constraints 文档」做成纪律闭环。** 它的 75 个 hook 外环体系证明了这个方向可行，但其复杂度形态不建议照搬。

---

## 一、项目速览

| | 天枢 Tianshu Harness | opencode（本仓库） |
|---|---|---|
| 定位 | 编程 agent 运行时，主打「认知执行环境 CVM」：在模型外做确定性监督 | 模型无关的编程 agent 平台：TUI / 桌面 / Web / SDK / Server |
| 技术栈 | Node 24 + TypeScript strict（`noUncheckedIndexedAccess`）+ tsup + node:test，单包 `src/` | Bun + Turbo monorepo（~34 packages），Effect Schema / HttpApi / Drizzle+SQLite |
| 规模 | `src/` 约 1,739 文件 / 34.8 万行；测试约 39 万行 / 2.4 万条用例（静态声明），**测试:源码 ≈ 1.1:1** | 34 包分层，核心循环/事件溯源/投影在 `packages/core` |
| 架构 | 六层：Surfaces → Agent Loop → Context & Cognition → Prompt & Compact → Tools → API | Schema → Core → Protocol → Server → Client/SDK，表面层 CLI/TUI/App/Desktop |
| 多表面 | 自研纯 ANSI TUI、Tauri 桌面、VS Code 插件、headless `-p`，共用一个内核 | OpenTUI+Solid TUI、Electron 桌面、Solid SPA、CLI 根命令即 TUI |
| 许可 | 代码 Apache-2.0；**两篇 CVM 理论/实证文档 CC BY-NC-ND（不可改编摘编）**；桌面端与部分实现闭源 | MIT（upstream） |

核心叙事：**Capability ≠ Runtime Behavior**。模型在真实会话中会因「Cognitive Anchor Collapse」（词汇/语义/策略/历史四类锚点）产生系统性退化——被质疑就让步、局部高显著信号压过全局目标、反复调用工具却不推进、最后说「应该修好了」。天枢的答案是：prompt 是信息不是状态，这类问题不能靠写更好的提示词解决，要在运行时加一层**确定性监督外环**：

```
内环 · 模型认知    reason → decide → act → observe
外环 · 运行时监督  observe → measure → evaluate → gate → verify → continue / correct / halt
```

---

## 二、天枢的核心机制盘点（代码实证，非宣传口径）

以下机制均已在代码中定位核实（路径相对 Tianshu 仓库根）。

### 2.1 RuntimeHookPipeline —— 五阶段确定性外环

- `src/agent/runtime-hooks.ts`：5 个阶段 `preTurn → afterPerception → postTool → postTurn → postSession`，hook 只能通过 `RuntimeHookEffects`（`injectUserMessage` / `emitPhaseChange` / `setStrategy` / `emitControlSignal`…）产生作用，**不允许直接改写 prompt**。
- `src/agent/hooks/` 下 **75 个 hook 模块**（默认会话实际激活约 18+，按依赖/环境变量条件装配）。代表性的有：
  - `courage-hook.ts`：反谄媚。检测连续失败→注入「说出当前方向最大风险」的义务性指令；配合 sycophancy-trap 检测连续让步后切换到「宪法模式」绕过冷却强制纠偏。
  - `convergence-detector.ts`（配套 `convergence-emit-gate/message/replay`）：多信号复合收敛分，含工具指纹振荡检测（A→B→A→B）、只读连击计数、无工具文本轮计数，阈值随上下文窗口（200K/1M）与阶段自适应。
  - `edit-failure-recovery-hook.ts`、`compaction-amnesia-hook.ts`（压缩失忆补偿）、`regression-bisect-hook.ts`（回归语义 + ≥5 轮只读空转 → 强制切基线对照）、`reasoning-spiral-hook.ts`（纯思考不打工具的停滞）。

### 2.2 AdvisoryBus —— 带核销账本的提醒通道

`src/agent/advisory-bus.ts` 把五条独立纠偏通道收敛为单一汇聚器：

- 三级优先层：`constitutional`（永不截断）/ `operational`（每轮最多 3 条）/ `informational`（填空），同 key 去重、TTL 控制。
- 三条投递通道：`bus`（appendix 块，粗断点）/ `system-reminder`（消息流尾部追加，缓存安全）/ `status`（只进 TUI 不进 prompt）。
- **最有价值的设计：advisory `expect` 谓词 + readback**。每条提醒携带一个「被采纳时后续轮次应能观察到什么」的可核销签名（`tool_appears` / `pattern_absent` / `withinTurns`），postTurn 由 `advisory-readback-hook.ts` 对照工具事件核销，产出 adopted/ignored 账本——提醒不再发后不管，可以统计采纳率、做习惯化对抗与降频。

### 2.3 TaskContract + 交付门 —— 「完成」由运行时裁决

- `src/context/task-contract.ts`：结构化任务契约——`objective / scope(mentionedFiles) / constraints / successCriteria / regressionInventory / planConstraints`，状态机 `exploring → planning → executing → verifying → ready_to_deliver`。目标由运行时持有，不依赖模型「记得」。
- `src/agent/delivery-gate-v2.ts`：基于 TaskLedger + OwnershipLedger + VerificationAttribution 计算 **GREEN / YELLOW / RED** 三态。RED（owned 文件未验证或有失败）**禁止交付**；外部文件噪声（junk 目录、gitignore）过滤后才计入信号。
- `src/agent/deliver-task.ts`：**提交、验证、审查三分离**。`deliver_task` 收敛为纯安全提交（归属限定 commit、跨会话 claim 冲突检测、版本一致性、敏感路径保护），回执明确写「本次未执行测试或审查」；定向验证走 `run_tests`（显式范围），独立审查走 `review_changes`（固定快照、只读 reviewer）。交付回执不作质量背书。
- 归属（Ownership）概念贯穿：谁改的文件（owned）vs 外部变更（external）分开计量，避免把环境噪声算成 agent 的功劳或锅。

### 2.4 前缀缓存引擎 —— 把命中率工程化为一级指标

- `src/prompt/` + `src/cache/`：System = `static.ts`（会话内冻结）+ volatile（动态区）+ `appendixDelta`（**字节稳定**的跨回合增量块，入场付一次、稳态零重发）；压缩历史重写只在用户边界 `turn===0`；API 客户端变换层强制 copy-on-write 防重入双写。
- 观测配套：每请求落 `cache-log.jsonl`（input/cacheRead/cacheCreate/hitRate），`npm run cache:audit` 审计 CLI，`scripts/prefix-budget.ts`、`tokens:audit.ts`。README 里每个数字都附 `jq` 复算命令（`docs/reference/observability-harness.md`）。
- 实测口径（自举开发 5 个真实会话，DeepSeek V4）：6.45 亿 input tokens，命中率 99.3–99.6%，成本 ¥880→¥20。**数据是自报的、样本是自选的**，但复算命令齐全——这个「每个宣称可复算」的纪律本身比数字值钱。

### 2.5 注入点申报表 —— 缓存纪律的机器执法

`src/prompt/injection-surfaces.ts` + `scripts/verify-injection-surfaces.ts`：所有 prompt 注入点在一张申报表里登记，校验器做 7 道检查（V1 形状 / V2 锚点存在性 / V3 CVM 计量源全覆盖 / V4 frozen 三分区不被 churner 污染 / V5 appendix 推送点对齐 / V6 稳定在前易变在后 / V7 尾部位置不可挪动）。且**用变异测试证明每道检查确实会失败**（「不会失败的门禁等于装饰」）。

### 2.6 工程治理 —— 事故驱动的纪律闭环

- `src/__tests__/architecture-guards.test.ts`：CI 级源码模式扫描，把设计约束变成红绿测试（禁用模式、文件行数上限 + `scripts/source-budgets.manifest.json` 行数棘轮账本）。
- 测试入口加固（`scripts/test-child-guard.ts` + `test-entry-hardening.test.ts`）：`--test-force-exit` 会在高负载下**少跑测试仍退 0**——被反向锁死；汇总完整性 fail-closed（进程退出却没见汇总行即判失败）；desktop 入口按 20 文件/批 spawn 逐批核对，因为单进程跑 200 文件也会静默丢 2%。
- CLAUDE.md「Known Constraints」：每条都是真实事故的沉淀，配 `docs/changelog/` 与 `docs/analysis/` 复盘文档。反复出现的主题值得抄进任何团队手册：**「静默降级是最贵的 bug 形状——走通和走不通，观察者区分不了」**；**「假通过没有任何外显信号，退出码不是验证——声称全绿前先核报告条数」**；**「每条修复都要做『还原缺陷即红』」**；**「代理判据永远漏——需要『哪些可以』时写白名单 + fail-closed，让漏判失效在保守侧」**。

### 2.7 其余机制速览

| 机制 | 位置 | 一句话 |
|---|---|---|
| Sensorium 六维状态 | `src/agent/sensorium.ts` | momentum/pressure/verificationCoverage/decisiveness/complexity/stability，全部由既有信号算出，**不调 LLM** |
| 星域 16 个 | `src/agent/star-domain-data.ts` | 可切换认知纪律：提示词后缀 + 工具白名单（真实交集、拼错 fail-closed 返回 []）+ `courageThreshold`（破军 0.25 最敢闯 → 太一 0.95 最审慎） |
| 工具内核预算 | `src/tools/default-registry.ts` | kernel 工具 ≤26 件，超出触发认知过载退化（有专门测试） |
| 跨会话记忆 | `src/memory/` | knowledge 索引 + 自适应 STM（8 轮压力重评）+ essence-gate 质量门；**自动注入只带约束类记忆**，旧问题显式 recall，自动记忆形成默认关（opt-in） |
| 信息素 Stigmergy | `src/context/stigmergy.ts` | 文件级行为足迹带 7 天半衰期，用得多的文件越来越熟，陈旧标记自动消失 |
| 多代理分波 | plan + `wave-gate.ts` | 计划分波执行，波间硬门禁：typecheck + 白名单验证命令必须过才放行下一波；议事会席位 `tierFloor` 只抬不降，cheap 产出的计划在审批面警告 |
| 仓库智能 | `src/repo/meridian-*` | 导入图/影响半径 + tree-sitter chunk 混合检索 + LSP 诊断编辑后回注 |
| 沙箱与安全 | README/SECURITY | 路径边界拒 `..` 穿越、项目信任门（未授信不加载 hooks/MCP/技能）、敏感文件禁读禁提交、破坏性命令确认、逐跳 DNS 防 SSRF；可选 landlock（`@huiliyi37/node-addon-landlock-run`） |
| 检查点 | `checkpoint.ts` | 每回合首次修改前建 Git 检查点，每次写入前版本化备份 |

---

## 三、逐维度对比

| 维度 | opencode（本仓库现状） | 天枢 | 差距与借鉴点 |
|---|---|---|---|
| **回合结构** | 一步 = 一次 `llm.stream`，durable inbox → `SessionRunCoordinator` → `SessionRunner.drain`；steer/queue 交付语义清晰（`packages/core/src/session/`） | turn 编排 + 五阶段 hook 管道 + 压缩五级阶梯 | **opencode 的 durable/session-core 架构更干净**，天枢的优势只在「循环里插了监督点」 |
| **运行时监督** | 插件钩子：`tool.execute.before/after`、`session.context`、`experimental.idle`、`experimental.ws.send/receive`（`packages/core/src/plugin/hooks.ts`）；权限规则（静态 allow/deny）+ goal judge（LLM 裁决） | 75 个确定性 hook + AdvisoryBus（优先级/去重/TTL/核销） | opencode 有挂载点但**没有成体系的外环**；天枢证明五阶段 + 统一提醒通道可行，且提醒可核销 |
| **目标与交付** | plan 模式（只读 agent + 审批）+ `/goal` 模型裁决环（`plugin/goal.ts`，"assistant 声称完成不算证据"，MAX_ROUNDS=50）+ 桌面 review UI | TaskContract 状态机 + DeliveryGate GREEN/YELLOW/RED + deliver/run_tests/review 三分离 + Ownership 台账 | opencode 的 goal judge 是对话证据裁决；天枢是**制品证据门**（改了哪些文件、哪些测试覆盖了它们）。两者互补，后者可落地为实验性工具 |
| **停滞检测** | unfinished-todo nudge（`runner/unfinished.ts`，MAX_NUDGES=10 / STALL_LIMIT=3） | 多信号收敛检测器（振荡指纹、只读连击、无工具轮、自适应阈值）+ reasoning-spiral + regression-bisect | opencode 只有 todo 视角的 stall；天枢是行为视角且零 LLM 成本，可直接借鉴 |
| **前缀缓存** | drain 级冻结指令前缀 + 末步工具定义保序 + 压缩持有不重写（`session/runner/llm.ts`、`compaction.ts`）；`session_usage` 已存 cache 列 | 会话级冻结 + 字节稳定 appendixDelta + 仅用户边界压缩 + 逐请求 cache-log + 审计 CLI + 注入点申报表 | opencode 是「不破坏缓存」，天枢是「**主动经营缓存**并机器执法防退化」。缺的是命中率账本、churn 诊断和防退化门禁 |
| **记忆** | 无跨会话记忆子系统（指令/技能/AGENTS.md 均为静态文件） | knowledge.jsonl + 约束类注入 + opt-in 形成 + recall 效率追踪 | 真实空白。天枢的「只注入约束类、旧问题显式 recall、防记忆劫持新任务」设计可直接抄为设计约束 |
| **多代理** | `subagent` 工具（深度默认 1）+ 完成通知 + `experimental.idle` | scout/team/council/galaxy + 分波 wave-gate + worker 档位 + tierFloor | opencode 缺少**波间验证门**与多席审查；wave-gate 是把 CI 前置到执行中的好模式 |
| **权限与沙箱** | 权限引擎（ask/assert/reply、unattended 自动拒绝、组织策略）+ Code Mode 无 fs/net 解释器；**无 OS 级沙箱** | 三档权限 + 路径边界 + 项目信任门 + 敏感文件 + 破坏性命令门 + SSRF 逐跳防护 + 可选 landlock | opencode 权限模型更强（规则/策略/托管），但缺**信任门**（未授信项目不加载 hooks/MCP/技能）这类「面」级防护 |
| **观测性** | SQLite 事件溯源 + SSE + OTLP 日志 + 请求追踪 + simulation/http-recorder 测试观测 | sensorium.jsonl 逐回合判定记录 + cache-log.jsonl + `/cockpit` 仪表 + jq 复算文档 | opencode 基础设施更强；天枢强在**面向「宣称可复算」的账本设计与复算文档** |
| **测试与治理** | `bun run check` 统一 lint+类型；unit/tui/app-e2e/component 四类技能约束 | 2.4 万用例近 1:1 配比 + architecture guards + 行数棘轮 + 测试入口加固 + 事故 changelog | opencode 有测试技能但**没有「治理即测试」**的源码扫描/预算棘轮/入口加固 |
| **工具面** | read/write/edit/patch/glob/grep/shell/skill/subagent/question/webfetch/websearch… + Code Mode + MCP | kernel ≤26 预算 + run_tests/review_changes/deliver_task 工程原语 + LSP/语义检索 | opencode 缺 `run_tests`/`review_changes`/`deliver_task` 这类**面向交付语义**的工具层 |
| **文档工程** | 产品文档（web 站点）+ ARCHITECTURE.md + doc/session-loop.md | 用户手册 + 理论文档 + 实证报告（附复算命令）+ 逐事故 changelog/analysis + engineering-metrics（口径争议都写明） | 天枢的「数字必须可复算、口径必须写清」值得整体搬 |

---

## 四、值得借鉴的机制（按价值/成本排序）

> 落地约束：遵循本仓 AGENTS.md——新行为从 experimental 起步、走 feature flag、不破坏 Schema→Core→Protocol→Server 依赖方向、durable 事件最小化。

### P0 —— 低成本高价值，建议尽快立项

**1. 确定性停滞/空转检测器**（借鉴 convergence-detector，零 LLM 成本）
- 在 `packages/core` 的 step 收尾处聚合既有信号：工具指纹振荡（argsHash 序列）、只读连击、无工具轮计数、同参数重复调用、todo 长期不动。
- 产出先走 `experimental.idle` / system-reminder 注入，flag 门控（如 `experimental.stall_detection`）。opencode 的 `runner/unfinished.ts` 已有 STALL 雏形，扩展即可。
- 价值：这是 CVM 外环里**单位代码收益最高**的一块——不需要 75 个 hook，一个多信号检测器就能拦截大部分 doom loop。

**2. 交付证据门（GREEN/YELLOW/RED）+ 提交/验证/审查三分离**
- opencode 的 goal judge 回答「目标达成了吗」（对话证据）；天枢补上「改动验证了吗」（制品证据）：`filesModified`（diff/snapshot 已有）× `verificationEvents`（shell/run_tests 的结构化结果）→ 归因矩阵 → 三态。
- 落地形态：internal tool `deliver` + `session_usage` 风格的投影表；RED 只阻断「交付」语义动作，不阻断对话。引用天枢原话作为设计边界：**deliver 回执明确「本次未执行测试或审查」，不冒充质量背书**。
- 配套：`run_tests`（显式范围）与 `review_changes`（固定快照、只读 reviewer、发现持久化）两个工具把验证变成一等公民动作。

**3. 缓存命中率账本 + 防退化门禁**
- `session_usage` 已有 cache 列 → 补一个聚合审计命令（命中率、cacheCreate 尖峰定位、churn 归因），再把天枢的「注入点申报表」思想简化为一条 guard 测试：扫描 system prompt 构建路径，断言易变内容只出现在允许的注入面。
- 价值：对 DeepSeek 类 50 倍价差 provider，命中率就是账单折扣；对其他 provider 也是稳态延迟指标。

### P1 —— 中投入，结构性补强

**4. AdvisoryBus 式统一提醒通道（带核销）**
- opencode 的 `session.context` 钩子可注入内容，但多来源提醒会各自为政。借鉴：单一汇聚器 + constitutional/operational/informational 分层 + 同 key 去重 + TTL + **expect 谓词核销账本**。核销账本是关键差异——让「提醒有没有用」变成可观测数据，才能对抗习惯化。

**5. Ownership 台账（会话归属文件）**
- `session/diff.ts` / `snapshot.ts` 已有 diff 能力，补一个 per-session owned-files 投影（哪些文件本会话改过、外部改了什么）。它是交付门、review UI、多代理冲突检测的公共底座，天枢用它做了归属限定 commit 与跨会话 claim 冲突检测。

**6. 工程治理三件套**
- 行数棘轮账本（manifest + ceiling + CI 校验）防止热点文件继续膨胀；
- 架构 guard 测试（把「禁止模式」写成红绿测试，opencode 已有依赖方向的 guard，可扩展到运行时约束）;
- **事故纪律**：修复必须附「还原缺陷即红」的回归测试 + `doc/`（或 fork 自己的目录）下留 incident 复盘；把「静默降级是最贵的 bug 形状」「退出码不是验证」写进 AGENTS.md 给 agent 的纪律段。

**7. 项目信任门**
- 未授信项目不加载项目级 hooks / MCP / 技能 / 记忆，`/trust` 管理。opencode 的插件发现已支持 `.opencode/plugins`，缺这道面级闸门。天枢把它列为默认开启的安全基线，成本低。

### P2 —— 大投入，需先论证再动

**8. 跨会话项目记忆**：真实空白，但按天枢的保守设计起步——约束类记忆自动注入、其余显式 recall、形成 opt-in、recall 效率可观测。flag 门控 + experimental 端点。
**9. 计划分波 + 波间硬门禁（wave-gate）**：多代理并行施工时 typecheck 不过不放行下一波；配合「回归清单」（计划里的 grep 可验证锚点）交付前逐项核验。
**10. LSP 诊断回注 + 导入图**：编辑后自动回注诊断是高频刚需；meridian 式影响半径是加分项。
**11. agent 级行为阈值**：opencode 的 agent 定义已含 prompt/tools/permissions（≈ 星域的前两项）；「courageThreshold」这类**数值化行为参数**是新意，可作为 agent schema 的 experimental 字段试水。

---

## 五、天枢的反面教训（不建议照搬的部分）

1. **75 个 hook 的复杂度形态**。`src/agent/` 一个目录 505 个文件；CLAUDE.md 里专门有「hook 信号互扰治理」、装配条件靠 deps/环境变量门控、「改 hook 行为前先看 gate 条件，勿假设某 hook 一定在跑」这类警告。监督逻辑一旦发散，每个 hook 的触发条件、相互影响和缓存副作用都变成认知负担。**借鉴机制而不是借鉴规模**：opencode 用少数几个高杠杆 hook（stall/交付门/提醒总线）即可拿到大部分收益。
2. **缓存优先约束全局渗透的脆弱性**。Known Constraints 里「frozen 快照孤儿化 → 单次 18.9 万 token 重建」「侧路重入双写 → 整段前缀 miss」等事故说明：字节级稳定 discipline 的每一处疏忽都是成本事故，且需要申报表 + 守卫 + changelog 三层才能守住。opencode 的 server/SDK 架构下，除非明确以 DeepSeek 类计费为目标，不必照搬全套字节稳定约束；先做账本和诊断，再做执法。
3. **实证数据是自报口径**。A/B 试点 n=5、单模型、LLM 审查，README 自己也承认；命中率数据来自自举会话。引用其数字时应带口径，借鉴其「附复算命令」的做法而非结论。
4. **叙事包装与工程分离**。星域碑文、种子胶囊是品牌叙事，底层只是「预设纪律 profile（提示词后缀 + 工具白名单 + 行为阈值）」。学习机制即可。
5. **治理结构不可复制**：单作者核心 + 外部 PR 收编（内容评审后移植进闭源主仓再同步回来）+ 桌面端闭源。本仓是社区 fork，协作模式完全不同。
6. **许可红线**：两篇 CVM 理论/实证文档为 CC BY-NC-ND，**不可改编、摘编**；代码 Apache-2.0 与本仓 MIT 混用需保留声明。结论：**借鉴概念自行实现，不做文本或代码搬运**。

---

## 六、结论

天枢用 35 万行代码验证了一个命题：**在概率模型外面加一层确定性监督，是工程上可行且成本上划算的**——前提是这层监督（a）不调 LLM、（b）有统一注入通道、（c）提醒可核销、（d）门禁有证据、（e）每个数字可复算。opencode 当前在会话核心、事件溯源、权限模型、表面工程上明显更现代；差距集中在三处：**交付无证据门、停滞无行为检测、缓存无账本执法**。P0 三项（确定性 stall 检测、交付证据门、缓存审计）都可以在现有插件钩子 + 投影体系内以 experimental + flag 方式落地，不需要动会话核心架构。

> 报告基于两侧仓库静态分析撰写；天枢侧所有机制均注明源码路径可复核，opencode 侧基线引用 `ARCHITECTURE.md`、`doc/session-loop.md`、`doc/context-economics.md` 与 `packages/core` 实际代码。
