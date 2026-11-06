# gemini-cli 借鉴技术方案

把第五轮对手分析（`D:\code\github\gemini-cli`）转成可执行方案。本文以**本地 `D:\code\github\gemini-cli` 仓库逐行核对**为依据；凡我自己读过的对方代码都标 `对方实测`，仅由子代理报告得出、我未复核的细节标 `子代理` 且**不作为设计依据**。落地时以本文的符号为准。

- 生成日期：2026-10-31。基线：`opencode` 分支 `loop-reliability-docs`，HEAD `81738639df`，`2.2.0-fork.10`。
- 核对方式：4 路并行只读核对（gemini-cli 内核机制 / 扩展与 CLI 工程 / 评测与测试基建 / 我方现状盘点），随后我逐行复核了驱动本方案的四个事实（见 §1.3 与 §9 复核命令）。
- **本文只做方案，未改任何代码。** 每个里程碑独立成 PR 粒度，含测试与 doc 同步要求。
- 证据分级沿用 `优势对比清单.md` 的口径：`实测` = 本工作树跑命令得到；`对方实测` = 本轮直接读对方文件核对；`子代理` = 本轮子代理报告、我未复核；`UNVERIFIED` = 搜索范围不足以断言。

---

## 目录

1. 与前四轮的衔接、更正与撤下
2. 路线图
3. G1 重复熔断：把 kimi 的连击判据升级为周期判据
4. G2 压缩的两个守卫：反膨胀闩锁与摘要自校验
5. G3 旧工具结果二次回收（挂在压缩边界，不挂在每步）
6. G4 行为评测与可信度分级（本轮唯一的全新轴）
7. G5 小件
8. 明确不做
9. 复核命令
10. 会推翻本方案的五件事

---

## 1. 与前四轮的衔接、更正与撤下

### 1.1 一条必须更正的旧结论

`codex-技术方案.md` 附录写：「kimi 第 3 项（工具重复熔断）：codex 侧确认也无此机制，维持『**两家都缺**、我们有半成品（STALL_LIMIT）』的判定，不在本路线图」。

这条已经错了，且 `优势对比清单.md` §1 和 §3.2 已经改口但 codex 方案没同步。本轮再加一家：

- **kimi 有**：`toolDedupe` 的 3/5/8 递进提醒 + 12 次强制 `stopTurn`（`优势对比清单.md` §3.2 记为对方实测）。
- **codex 有**：`consecutive_empty_turns >= 3` 空转断路器（同上）。
- **gemini-cli 有，且是三者中判据最强的**：`gemini-cli/packages/core/src/services/loopDetectionService.ts`，`TOOL_CALL_LOOP_THRESHOLD = 5`、窗口 `maxRequiredLength = 5 * 5 = 25`、**周期 `k` 从 1 到 5 逐个试**（`const cycle = this.toolCallHistory.slice(-k)` / `expectedKey = cycle[i % k]`）——所以 `A B A B A B` 这种交替循环能抓到，而 kimi 的「同名同参连击」抓不到。`对方实测`
- **我们没有**：`grep -rnE "repetition|loopDetect|isLoop|stuck" packages/core/src` 得 **1** 条命中，且那一条是 `packages/core/src/plugin/skill/opencode.md` 里的一句散文，不是代码。`实测`

→ 结论从「要不要做」变成「**做哪一个判据**」。本轮的增量是把 kimi 第 2 项的判据形状换成 gemini 的周期判据，并补上两个双方都漏掉的性质（见 §3.2、§3.3）。

### 1.2 gemini-cli 独有的、前四轮没有的三样

| 项 | 为什么前四轮拿不到 |
| --- | --- |
| **行为评测基建**（`gemini-cli/evals/`、可信度分级、回归 vs 既有失败自动归类） | codex/kimi/ZCode/adm 四家都没有等价的 live-model eval 层；`优势对比清单.md` §3.5 已实测确认 codex CI 只有 `blob-size-policy`/`cargo-deny`/`codespell`/`bazel`。这是五家里**唯一**的一份，且我们完全空白（根目录无 `evals/`，`实测`） |
| **旧工具结果的独立回收通道** | kimi 的 `toolResultTruncation` 与我们等价（首尾预览 + spill，§3.4 已判定「不是优势」），但 kimi 和我们一样**只在发布前裁一次**；gemini 额外有一条「事后把已经没用的旧结果换成占位符」的独立通道 |
| **压缩失败的反膨胀闩锁** | 我们的 `SHRINK_STEPS` 阶梯管的是「请求被 provider 拒」，没有任何人管「压缩成功但没省下来」。前四轮三家均未提供该机制，`UNVERIFIED`（未专门搜 codex/kimi 是否有） |

### 1.3 本轮核对后**撤下**的项（别重复立项）

| 我最初以为可借 | 撤下原因 |
| --- | --- |
| 供应链：Actions SHA 固定 + lockfile 拒绝 git/http 直依赖 + `dependabot` | **codex M2 第 7 项已完整立项**，且我方 `bunfig.toml` 的 `exact = true` + `minimumReleaseAge = 259200` 已是同类闸（`优势对比清单.md` §3.5）。再加一条 lockfile 检查属边际收益，归入 M2 落地时顺手做 |
| 截断标记补原始行数/字节数 | **codex M7 P5 第 2 项已立项** |
| 配置/事件 manifest 生成并保鲜 | **kimi 清单第 6 项已立项**；`script/sdk-docs.ts` + `script/doc-refs.ts` 已在 `bun run lint` |
| 扩展 marketplace + 安装签名 | 见 §8，与我们的插件单元不同构 |
| 「`estimateWide` 是优势」类旧说法 | §3.4 已判定 kimi 早有等价实现，本轮不再宣称 |

---

## 2. 路线图

| 里程碑 | 内容 | 对应前轮 | 前置 | 运行时风险 | 规模 |
| --- | --- | --- | --- | --- | --- |
| G1 | 重复熔断：周期判据 + 结果参与键 + 从 durable 历史折叠 | **升级** kimi 第 2 项 / ADM 第一章 | 无 | 中（会打断模型） | ~250 行 + 测试 |
| G2 | 压缩反膨胀闩锁 + 摘要自校验 | 全新 | 无 | 低-中 | ~150 行 |
| G3 | 旧工具结果二次回收（压缩边界） | 全新 | G2 | 中（触及 prompt 装配） | ~200 行 |
| G4 | 行为评测 + 可信度分级 +  nightly 聚合 | **全新轴** | 无（但 G1/G2 的验收依赖它） | 零（不进阻塞 job） | ~600 行基建 |
| G5 | todo `blocked` 状态与单 `in_progress` 校验 | 全新（小） | 无 | 低 | ~60 行 |
| 不做 | 内容层/模型层循环检测、marketplace 签名、IDE companion 传输层、Clearcut | — | — | — | — |

依赖：G1 与 G4 可并行起步，但 **G1 的开关默认值要等 G4 的 `no-repeats` 与 `stop-when-done` 两条先跑通**，否则「误打断」只能靠人肉发现。G3 在 G2 之后（同一处装配点）。G5 完全独立。

与 codex M1–M7 的关系：G1–G5 与 M1–M7 **互不阻塞、可交替排期**；只有 G5 与 M5（注入身份）都碰 todo/nudge 文本，落地顺序上 G5 应在 M5 之后，以便 harness 标记是现成的。

---

## 3. G1 重复熔断：把连击判据升级为周期判据

### 3.1 判据来源与适配

新模块 `core/src/session/runner/loop.ts`，用 `makeLocationNode`（`packages/util/src/effect/app-node.ts`）建 Location 作用域服务，在 `packages/core/src/session/runner/llm.ts` 的 `runStep` 里与 `packages/core/src/session/runner/unfinished.ts` 并列调用。

**硬性约束：窗口从 durable 历史折叠，不用进程内环形缓冲。** gemini 的 `toolCallHistory` 是进程内数组，kimi 把状态存在 `AgentStateService` 的内存 `Map` 且那些 key 没有 `.replayable(...)`，重建即归零（`优势对比清单.md` §3.2 实测）。`doc/session-loop.md` 的 `Decisions` 已经写过「auto-continuation breakers read durable history」并点名否决过 `Map<SessionID, number>`。所以我们既不能抄 gemini，也不能抄 kimi 的存储，只能抄**判据形状**：

- 数据源：`session.tool.success` / `session.tool.failed` 投影行，turn 边界沿用 `unfinished.ts` 的 `idle` marker 作用域（同一函数里已有 fold 逻辑可参照）。
- 键：`effectiveName`（`packages/core/src/tool/runtime.ts`）+ **持久化的** input（规范化键序后 SHA-256，取前 12 hex）。用持久化副本而不是内存对象，否则重启后同一次调用会算出不同的键。
- 匹配：窗口 25，周期 `k ∈ 1..5`，同一周期连续重复 `R = 5` 次触发。`对方实测`（gemini 的这三个数）

### 3.2 我们比 gemini 多的一条：结果必须参与判据

`gemini-cli/packages/core/src/services/loopDetectionService.ts` 的**模型层 prompt 原文**写着：交替循环只有在「每轮的参数**和结果**实质相同」时才算 loop，「改了不同的代码或撞到不同的错误，那是调试进度」，并且在另一处重申「同一工具被以语义等价的参数反复调用」才算。而它的**确定性工具层**（`sha256(name + JSON(args))`）里没有结果。

这是 gemini 自己的两层不一致，照搬会得到一个必然的误判类：`shell` 跑同一个命令轮询构建状态、`read` 同一文件区间等同一步落盘——参数完全相同，**世界变了**，这是正确行为，会被连打 25 次窗口内的周期匹配打断。

所以：**键 = 工具名 + 规范化参数 + 结果摘要**。结果摘要取该 tool part 的输出文本按 `packages/util/src/token.ts` 同一套字符算术后的哈希，provider-executed 的调用没有本地输出则退化为 status（success/failed）参与键。代价是每个键多一次哈希，可忽略；收益是把「轮询」和「空转」分开了——这一条 kimi 和 gemini 都没有做。

验收用例必须包含这条：一个刻意轮询（同参数、结果每次不同）的 fixture **不得**被打断。

### 3.3 我们比 gemini 少的一条：不要三层

gemini 有三层——工具层、内容层（`CONTENT_CHUNK_SIZE = 50`、`CONTENT_LOOP_THRESHOLD = 10`、`maxAllowedDistance = 50 * 5`、`periods.size > 5` 判否）、模型层（周期性 JSON 诊断调用，0.9 置信后再让第二个模型复核）。`对方实测`（阈值）/`子代理`（模型层流程）。

首版只做工具层：

- **内容层否决**：transcript 里大量是代码，重复本身是代码的性质；gemini 自己就在围栏块、表格、列表、标题处重置检测并在代码块内禁用——四个特例在对抗一个弱信号。这与 `doc/context-economics.md` 已写下的「不为一处截断的中间段付模型调用」是同一取向。
- **模型层否决**：在一个长 turn 的关键路径上加付费请求，且需要第二个模型才敢动手。等工具层有实测漏检率再重评。

### 3.4 反应：先软提醒，再硬收束

沿用现有 token 纪律，不新造机制：

1. 首次命中发布 `SessionEvent.Synthetic`，`metadata.notice` 值 `loop-repeats`，文本点名是哪条调用、重复了几轮。这与 `NOTICE`（`todo-residue`）同构：提醒必须是 synthetic 消息，**不能**是伪造的用户轮次——`doc/records/2026-10-todo-completion-nudge.md` 记的理由（`SessionInbox` promotion 会重置步数预算）对这里同样成立。
2. 常量成对导出，照 `packages/core/src/session/runner/unfinished.ts` 的形状：`NOTICE_REPEATS` / `NOTICE_STOPPED` 的值是契约，文本常量可改写。
3. `LOOP_NOTICE_LIMIT = 3` 次提醒后仍命中，则本 turn 以 `loop-stopped` 收束并 idle。**收束方式**采用 kimi 清单 §2.2 已经定下的方案：拒绝下一次工具执行 + 追加一个 `toolChoice: "none"` 的纯文本收尾步（与 `packages/core/src/session/runner/max-steps.ts` 的步数耗尽处理一致），而不是新增 `DrainResult` 变体——`doc/records/2026-10-todo-completion-nudge.md` 已论证过重跑 drain 会重复 stale settlement 等入口工作。
4. **不是 session error**。理由同 `todo-residue-stopped`：错误读起来像会话坏了，真相是模型在原地打转。
5. 计数清零条件：出现一个**未见过的键**才算前进；`unfinished.ts` 的「真实副作用」定义在这里不够用，因为重复的 `edit` 也是副作用。

### 3.5 开关、测试与 doc

- 配置：`experimental.loop_guard`（`packages/schema/src/config/experimental.ts`），**引入 PR 里默认 false**，第二个 PR 翻默认值。翻默认的前提：G4 的 `no-repeats`/`stop-when-done` 两条评测跑通，且 `dev:live` 上三个真实会话无打断。
- 测试：新文件 `session-runner-loop.test.ts`（放 `packages/core/test`，用 `packages/core/test/session-runner.test.ts` 已有的 `TestLLM` seam）。必须覆盖：5 次同参连打打断；`A B A B` 交替打断；6 个不同键不打断；**同参但结果不同不打断**（§3.2）；进程重启后连击不归零（§3.1）；收束是 idle 不是 error；`experimental.loop_guard=false` 时零行为变化。时间控制按 `.opencode/skills/unit-tests`：不 `sleep`，用 `it.effect` 的 `TestClock`。
- doc：`doc/session-loop.md` 的「Stopping, continuing, and nudges」表加一行 + `Decisions` 加一条（记「结果参与键」这个性质和被否决的三层设计）。CHANGELOG 记用户可见行为（默认开启那一刻）。

---

## 4. G2 压缩的两个守卫

位置都在 `packages/core/src/session/compaction.ts`。

### 4.1 反膨胀闩锁

现状：`due` + `SHRINK_STEPS` + `MAX_COMPACTIONS_PER_TURN` 管的是「请求太大被拒」和「一轮里别无限压」。**没有任何一处检查「这次压缩到底省没省」**。

gemini 的做法（`gemini-cli/packages/core/src/context/chatCompressionService.ts`）：新历史 token 数不小于原历史就判 `COMPRESSION_FAILED_INFLATED_TOKEN_COUNT` 并**丢弃摘要**，同时把 `hasFailedCompressionAttempt` 闩锁住，本轮不再重复付 summarizer，第二遍退化为纯截断。`子代理`（我未逐行复核该文件，落地前先读）。

适配到我们的折叠纪律：不新增持久字段记「压缩后大小」。`doc/context-economics.md` 的 `Decisions` 已经明确否决过「存一个 fold 能算出来的数字」，理由是 `due` 每步都跑、下一步自然提供同一信息。我们已有 `summarizedThisTurn`（本轮完成的摘要计数）与 `estimatePrompt`（带 measured 锚点），所以守卫可以写成：**`due` 在同 turn 已有 checkpoint 的情况下再次命中 → 视为上一次没省够**，此时不再排新摘要而走截断兜底。这与 `compaction.stalled` 的区别是：stalled 到 4 次才收束，新守卫在**第一次**就没省够时立刻降级，省下 3 次 summarizer 的钱。

**这条是纯收益且无新状态**，但必须先读 `compaction.ts` 的 `due`/`summarizedThisTurn` 具体实现再动手；若发现「第一次没省够」无法从现有 fold 得到，就退回成「在 compaction 行上记一个 already-existing 的 size 字段」，并把权衡补进 `doc/records/`。

### 4.2 摘要自校验

gemini 生成摘要后会再发一次 `${promptId}-verify` 探针让它挑遗漏，用校验版作为最终摘要。`子代理`。

我们的对应做法：把校验做成 `summarize` 的**可选第二次请求**，由 `compaction.verify` 配置控制、默认关。理由同 §3.3——第二次请求翻加倍数，而摘要质量目前没有测量手段。**顺序依赖 G4**：等评测里有一条「压缩后仍能答出被压掉的事实」的量具，再决定默认值。本里程碑只交付机制与开关，不交付默认开启。

### 4.3 摘要模型档位

`packages/core/src/plugin/agent.ts` 里隐藏的 `compaction` agent 只设了 name/mode/hidden，**不设 model**，因此摘要用会话主模型；只有标题走 `Model.small`（`packages/core/src/session/context.ts`）。gemini 用 alias 把 compressor 固定到 flash-lite 档。`子代理`（alias 细节）

本方案**不擅自改默认值**，因为它同时动摘要质量和 prompt cache（换模型 = 换请求形状）。交付两件事：① 文档明确 `agents.compaction.model` 是成本旋钮并给出取值指引；② 让 G4 有一条对比同任务下 `compaction` agent 主模型 vs small 模型的评测，再决定是否提供默认。

---

## 5. G3 旧工具结果二次回收

### 5.1 缺口

`packages/core/src/tool-output.ts` 在**发布前**一次性裁剪（`MAX_LINES = 2_000`、`MAX_BYTES = 50 * 1024`、spill 文件 + `metadata.toolOutput.outputPath`）。`实测`

问题不是裁剪不够狠，而是**没有第二次机会**：二十条各自合规的结果仍是二十条 × 最多 ~12k token，一路跟着会话走，直到某轮压缩整体重写。gemini 为此有一条与压缩独立的通道：`gemini-cli/packages/core/src/context/toolOutputMaskingService.ts`，`DEFAULT_TOOL_PROTECTION_THRESHOLD = 50000` + `DEFAULT_MIN_PRUNABLE_TOKENS_THRESHOLD = 30000`，源码注释写明是「batch pruning threshold」——不为小历史付文件 I/O。`对方实测`

### 5.2 关键取舍：挂在压缩的重建点，不挂在每步

gemini 的 masker 在历史增长时独立运行。照搬到这里会在 `runStep` 里重写模型可见前缀，而 `doc/session-loop.md` 明确只允许一件事重建 prompt：**压缩**（它清掉冻结的 `InstructionBaseline`）。每步 masker 会把 provider cache 命中持续丢掉，正好抵消它省下的 token——按 `token-speed-requirement` 那条口径（输入框下方的 tok/s 与缓存命中必须保留），这是不可接受的。

所以：回收发生在压缩重建上下文的那条路径上（`clip` 与 `summarizedThisTurn` 所在的装配处），把落在 `keep` 窗口之外的工具结果换成一行占位符——工具名 + `metadata.toolOutput.outputPath`。

这与 `doc/context-economics.md` 已经否决的「对一条结果的中间段做 LLM 摘要」**不是同一件事**，且恰好依赖它给出的理由：完整字节已在盘上、路径已在标记里，模型要重读就重读原文，不需要相信转述。本方案不给任何摘要，只留路标，零请求。

### 5.3 阈值、配对不变量与度量

- 触发条件：可回收总量超过 `PRUNE_MIN_STALE_TOKENS`（起步 30 000 token，取 gemini 的 `DEFAULT_MIN_PRUNABLE_TOKENS_THRESHOLD` 同义值）才做，摊平文件 I/O 与请求重建成本。
- **配对不变量**：`call` 落在保留窗口内的结果永不回收；绝不留下一个协议上找不到配对的结果或反之。事后校验，违例就返回**未回收**的上下文（gemini 采用同一防御形状，`子代理`）。这一条防的是 provider 400，属于必要的兜底。
- 度量：回收的 token 数记在摘要结果旁边（沿用 compaction 已有的 outcome 记录位），否则 G3 无法被判定有效。
- 与 G1 的交叉：被回收的结果仍带工具名，重复调用的键不变。在 G1 的测试里加一个「既循环又压缩」的会话验证，不要假设。
- 测试：扩到 `packages/core/test/session-compaction.test.ts`，用该文件已有的 ASCII 精确 token 断言证明「只有旧结果动了，别的没动」；CJK 那条钉住的用例不得回归。
- doc：`doc/context-economics.md` 的「One tool result at a time」加一节 + `Decisions` 补一条（写清与已否决摘要方案的界限，以及 cache 这个理由）。

---

## 6. G4 行为评测与可信度分级

### 6.1 为什么这是本轮最值钱的一条

五家对比里只有 gemini-cli 有 live-model 行为评测。而 `实测` 确认我们根目录没有 `evals/`、没有任何 LLM-as-judge。更关键的是：G1 和 G2 都会**改变模型行为**，现在唯一的验收手段是人肉跑 `dev:live` 加一句「看起来更好了」——这正是这套基建要替换掉的东西。

### 6.2 断言源是 durable 工具记录，不是回复文本

`gemini-cli/evals/test-helper.ts` 的 `rig.readToolLogs()` 从 telemetry 里取 `tool_call` 事件，断言打在这份结构上（`对方实测`：`EvalPolicy` 三值、`it.fails`、`readToolLogs()` 均在文件里读到）。于是可以写**定量**断言，例如 `frugalReads.eval.ts` 要求 `end_line` 必须存在、单次读取行数 < 1001、累计 < 1000、且区间并集覆盖被问的三行。这类断言跨模型、跨文案改写都成立。

我们的等价实现不需要 telemetry 导出（我们只有 opt-in 的 `packages/util/src/observability.ts`）：直接读会话的 durable 记录，走 `script/session-efficiency.ts` 已经在用的那两个端点——`/api/session`（列会话）与 `/api/session/:id/context`（取上下文），认证沿用它的 `service.json` / `service-local.json` 读取方式。这样评测断言读的就是模型真正看到的那份投影，和 §3.1、§5.2 的判据同源。

### 6.3 首批全确定性评测（无 judge）

| 评测 | 断言 | 服务的里程碑 |
| --- | --- | --- |
| `no-repeats` | 一个刻意造出交替循环的任务，在步数预算内结束且出现 `loop-repeats`/`loop-stopped` | G1 |
| `poll-is-not-a-loop` | 同参不同结果的轮询任务**不得**被打断 | G1 §3.2（防误判的配重） |
| `stop-when-done` | 两文件小修在 N 步内 idle，无 `loop-*` notice | G1 的误打断配重 |
| `frugal-reads` | `read` 必须带 `offset`/`limit`，累计行数在预算内 | 独立 |
| `answer-not-act` | 解释型 prompt 下无 `edit`/`write`/`patch`/`shell` 成功事件，且 `git status --porcelain` 干净 | 独立 |
| `compaction-recall` | 压缩后仍能答出被压掉的某个具体事实（数值/文件名） | G2 §4.2、§4.3 的量具 |

### 6.4 可信度分级，这是能否长期留在 CI 的全部

照搬 `gemini-cli/evals/test-helper.ts` 的三档语义（`对方实测`）：`always` 进 PR 且阻塞；`usually` 在 PR 里 skip、只在 nightly 跑；`usually-fails` 用 `it.fails` 语义登记为「已知退步」，让它可见但不挡路。

晋升与降级由 `gemini-cli/scripts/get_trustworthy_evals.js` 的规则决定（`对方实测`：`PASS_RATE_THRESHOLD = 0.6` 每日地板、`AGGREGATE_PASS_RATE_THRESHOLD = 0.8` 每周信号）：一条评测先在 nightly 里连续每天 >60% 且汇总 >80%，才被允许进 `always`。PR 上按 Best-of-N 判（4 次里 2 次成功即通过）。**最关键的一条**：0/3 失败时把同一评测对着基线分支再跑一遍来区分「既有失败」和「本次回归」——我们基线是 `dev`（见 `AGENTS.md`），所以是 checkout `origin/dev` 重跑。没有这一步，第一条 flaky 的阻塞评测就会让人开始无视 CI。

抖动处理：只对 provider 5xx/过载类响应重试；重试耗尽后**跳过并追加日志**（gemini 用同步 I/O 追加 `evals/logs/api-reliability.jsonl`，因为它要活过超时，`子代理`），真实断言失败一定 rethrow。

### 6.5 落地形态

- 目录放**仓库根 `evals/`**，不放 `packages/*`：`turbo.json` 里定义了 `test` 任务（`"test": { "dependsOn": ["transit"], "outputs": [] }`），凡 workspace 里存在名为 `test` 的 package script 就会被 `bun turbo test --affected` 收进单测 job（`.opencode/skills/unit-tests` 明写该命令），live 模型评测进那里就是事故。`实测` 根 `evals/` 不在 `packageManager` 的 workspaces 列表（`packages/*`、`packages/plugins/*`、`services/*` 等）里，因此天然不被 turbo 采集——这也是它比 `packages/evals` 更安全的唯一理由。**动手前重跑一次 `bun turbo run test --affected --dry` 确认没有新任务被收进来。**
- workflow：`scheduled` + `workflow_dispatch`，nightly 写聚合历史供 §6.4 的晋升判定；PR job 只跑 `always` 档。
- 复用而非另造：`script/session-efficiency.ts` 已经是「把一次真实会话拆成流式/工具结算/间隙」的量具，G4 的评测应当调它取数，而不是重新实现一份时间切分。
- 明确不做 LLM-as-judge（`gemini-cli/evals/llm-judge.ts` 的 3 次并行 + 多数表决）：它需要同一套可信度机制才可解释，且会在确定性那批还没产出信号之前就继承成本。等 §6.3 六条稳定了再评。

---

## 7. G5 小件

`packages/core/src/tool/plugin/todo.ts`（`name = "todowrite"`，`Info` 的 `status` 目前是 `pending|in_progress|completed|cancelled` 四值，`summarize()` 会列出所有 `in_progress`）：

1. 加 `blocked` 状态。价值不在多一个枚举，而在「模型可以显式承认卡住」——`优势对比清单.md` §3.2 记的 codex `spec.rs` 把「同一阻塞条件连续三个 goal turn 才允许 blocked」写进工具 schema，那是把放弃合法化的正确方向。我们若只加枚举不加约束，会换来更早的放弃，所以**默认不做 turn 约束**，只在工具描述里要求「先说明阻塞条件再标 blocked」，文案进 `doc/session-loop.md`。
2. 校验至多一个 `in_progress`（gemini 的 `WriteTodosTool` 拒绝多于一个，`子代理`）。违例按现有工具输入错误路径返回可读提示，不改 schema 语义。
3. 影响面检查：`status` 是模型可见枚举且列表会进投影与合成消息文本。若它出现在 Protocol 或 server `HttpApi` 面上，按 `AGENTS.md` 从 `packages/client` 跑 `bun run generate`，不要手改生成物。
4. 测试：两个 `in_progress` 被拒；`blocked` 不计入「未完成项」的判定要显式钉住——因为它会同时影响 §3.4 的「前进」定义和 `unfinished.ts` 的 todo 残留判据。这一点是本文件里最容易埋雷的交互，必须在 `session-runner-unfinished.test.ts` 里有一条用例。

---

## 8. 明确不做，含理由

| 项 | 理由 |
| --- | --- |
| **扩展 marketplace + 安装完整性签名**（`gemini-cli/packages/cli/src/config/extension*` 的 `gemini-extension.json` 约定目录贡献、`extensions.json` 注册表、HMAC-SHA256 + keychain 密钥签安装元数据） | 我们的分发单元是 **代码插件**（npm 或 Git  specifier，`packages/cli/src/commands/handlers/plugin/add.ts`），带 Effect 类型化面和 `tool.hook`/`session.hook` 钩子；再建一套 manifest 只会在旁边长出一个更弱的插件系统。签名那一半可分离：`packages/plugin/src/source.ts` 已用 `Hash.sha256` 做 reload 摘要，但没有安装期锚点，值得单独立项（不进本路线图）。另外 `优势对比清单.md` §3.5 已确认我们有 Sigstore `publish-attestations` |
| **内容层与模型层循环检测** | §3.3 |
| **每步独立的 tool-output masker** | §5.2：会持续丢 provider cache 命中 |
| **压缩后 `contextManager` 图流水线**（`子代理`：rolling summary / state snapshot / tool masking 三处理器 + `<projectTempDir>/compression_state.json` 持久化 + `sha256[:12]` 缓存命中） | 这是 gemini 的第二代设计，与我们的 `measuredPrompt` 锚点 + `InstructionBaseline` 冻结是两套心智模型；先做 G2/G3，若两者都验证有效再评估是否值得换成图式流水线 |
| **IDE companion 用 MCP server 承载 UI 状态**（两个真工具 + `ide/contextUpdate` 类自定义 notification 传编辑器状态） | 能跑，但我们已有类型化的 GUI 插件面；借「用 notification 走私 UI 状态」等于用契约换 ad-hoc |
| **Clearcut 上报** | Google 内部通道。附带事实：我们没有任何产品分析与 `DO_NOT_TRACK`/`DISABLE_TELEMETRY` 处理（`实测` 无命中），这是产品决策，不由本轮补 |
| **`memory-tests/` 照搬** | 它测的是子进程 heap/RSS（基线 idle 69.8 MB vs resume 887.1 MB，`子代理`），不是上下文质量。我们的 `packages/desktop` 栈不同，先只在 `优势对比清单.md` 保持关注 |

---

## 9. 复核命令

本文的存在性判断由这些命令支撑（我在 2026-10-31 于上述基线跑过）：

```sh
# 我方缺口：唯一命中是技能文档里的一句散文，不是代码
grep -rnE "repetition|loopDetect|isLoop|stuck" packages/core/src
# 无 masking/pruning 机制：命中全是 Effect.uninterruptibleMask
grep -rniE "mask|prune|distill" packages/core/src/session packages/core/src/tool-output.ts
ls -d evals 2>/dev/null | wc -l             # 0：无评测基建
grep -A2 '"test"' turbo.json                 # turbo 有 test 任务：评测不能做成 workspace
bun script/doc-refs.ts | tail -1          # 31 documents / 158 paths / 0 problems

# 对方判据（周期匹配、阈值、结果参与判据的自述）
grep -nE "TOOL_CALL_LOOP_THRESHOLD|CONTENT_CHUNK_SIZE|maxRequiredLength" \
  ../github/gemini-cli/packages/core/src/services/loopDetectionService.ts
grep -nE "slice\(-k\)|expectedKey|arguments and outcomes" \
  ../github/gemini-cli/packages/core/src/services/loopDetectionService.ts
# 评测分级与可信度阈值
grep -nE "ALWAYS_PASSES|USUALLY_FAILS|readToolLogs" ../github/gemini-cli/evals/test-helper.ts
grep -nE "PASS_RATE_THRESHOLD|AGGREGATE_PASS_RATE" ../github/gemini-cli/scripts/get_trustworthy_evals.js
# 回收通路的摊平阈值
grep -nE "TOOL_PROTECTION_THRESHOLD|MIN_PRUNABLE_TOKENS" \
  ../github/gemini-cli/packages/core/src/context/toolOutputMaskingService.ts
```

落地前仍需逐行读的两处（本文标为 `子代理`、未复核）：`gemini-cli/packages/core/src/context/chatCompressionService.ts`（G2 §4.1 的反膨胀闩锁细节）与 `gemini-cli/packages/cli/src/config/extension.ts`（§8 的签名部分）。

---

## 10. 会推翻本方案的五件事

1. **G1 在真实会话里打断了正确工作**（§3.2 想防的那类）。若加了结果参与键之后仍出现，说明键太粗，修法是把作用域收到「同一 turn 内的同一键」，而不是去补内容层检测。
2. **G3 的占位符在后续步里被反复重读**。那意味着模型需要的是上下文字节而不是路标，方向应退回 `doc/context-economics.md` 里被否决的「让完整输出进历史」，并重新审视整条回收通路。
3. **G4 的评测超过两晚仍达不到 60%/80% 可信线**。那意味着 live-model 断言在本仓不可长期维护，工作量应转到 `packages/simulation` 的确定性 backend 上，而不是继续加评测。
4. **G2 §4.1 的「压缩到底省没省」无法从现有 fold 得到**。那说明我对 `compaction.ts` 的读法不成立，必须先补一个 `doc/records/` 计划再动，参照 `codex-技术方案.md` M6 的处置方式。
5. **翻 `experimental.loop_guard` 默认值前后，`bun script/session-efficiency.ts --title "<同一任务>" [--dev] --json` 无可比数据**。按 `AGENTS.md` 的性能验证口径（先确认运行的后端 CLI 是新构建、同 prompt 同模型同变体同输出量），没有可比数据就不允许翻默认值——这条是流程红线，不是待办。
