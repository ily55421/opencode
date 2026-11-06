# dsh-superagent 借鉴技术方案（第 7 轮）

> 分析对象：`D:\code\github\dsh-superagent-prototype`（DeepSeek dsh-superagent 原型，研究预览版；
> TypeScript monorepo 单包，pnpm + vitest + cordis 插件内核 + SQLite；配套论文
> *Exploring Super-agent Design: Towards a More Autonomous Agent System*，README 自认与论文实现不一致）。
> 我方基线：工作树 `loop-reliability-docs`，HEAD `81738639df`，`2.2.0-fork.10`。
> 系列既有对象：`codex` / `kimi-code` / `ZCode` / `adm` / `cline` / `gemini-cli` / `goose` / `aider` / `codewhale`
> （台账见 `优势对比清单.md`；施工图见 `P0-可执行技术方案.md`，下称"施工图"）。
>
> **证据分级**：`对方实测` = 本轮我亲自在 dsh 树上 grep/读码复核过承重符号；`子代理` = 本轮子代理深读报告得出、
> 我未逐条复核，**不作为设计依据**，只作背景；`实测` = 本轮在我方树上跑命令核对。
> 引用一律 `路径` + `符号名`，不写行号（纪律见 `doc/conventions.md`）。
>
> **本轮只做增量**：产品形态上 dsh 是「无人值守、以他人注意力为预算」的 proactive agent，与我方交互式单机 fork
> 几乎正交——它的 GitHub/飞书 Source、admission、mandate 体系整体不学（§5）。能借的是它在**无人值守纪律**下
> 沉淀出的四件我方没有的东西，其中两件直接是对施工图 L1 / L31 的增量（§3），一件是 cline §6 定时任务的执行底座
> （§4.1），一件是 L32 的测试先行路径（§3.1）。

## 1. 先纠正五个想当然（对方实测）

| 想当然 | 实测结果 | 证据 |
| --- | --- | --- |
| 「它有一个长期记忆子系统」 | **不是**。`src/core/memory.ts` 名字骗人：它是 `MemoryRepositories`，领域测试用的内存仓储实现（克隆 Map + `atomic` 快照回滚）。它的"记忆"就是 SQLite Store 本身——每条 admission 判断把理由（`Reason[]` + assessor `audit`）永久落进 `decision` 表，「为什么这么做」数月后可查 | `src/core/memory.ts`；`子代理`确认 `decision.audit` 链路 |
| 「监听 GitHub 靠 webhook」 | **不是，全部轮询**。每个事件流独立 cursor + ETag（`src/sources/github.ts` 的 `STREAMS`），轮询起点回拨 5 秒防漏（`src/sources/poll.ts` 的 `cursorAt`），订阅线程死后继续轮 14 天（`polled()`）。回拨是免费的，因为触发器 ID 是内容派生哈希，重复接收返回 `'duplicate'` | `src/sources/poll.ts`、`src/kv.ts` |
| 「observe 模式是灰度测试开关」 | **它是默认值**。`src/policy.ts`：`mode: z.enum(['off', 'observe', 'auto']).default('observe')`——observe 下模型给出的接受判断被改写成 `would_accept` 审计记录，不产生工单。主动行为先只记录"我本会做什么"，人工翻记录后再切 auto | `src/policy.ts` 的 `assessmentOutcome` 附近 |
| 「编排者是更聪明的编码 agent」 | **相反，它被禁止编码也被禁止等待**。`prompts/shared.md` 禁止它实现需求（`子代理`）；`src/app/sessions.ts` 的 `noWait` 工具守卫用命令位正则 `SLEEP` 拒绝 `sleep`、拒绝 `timeoutMs > 30_000`，文案说"报告自己会作为消息到达，结束你的 turn" | `src/app/sessions.ts` 的 `noWait` / `NO_WAIT` |
| 「模型在关键判断上说了算」 | **模型只提案，代码复核后才生效**。assessor 的结构化 `Assessment` 必须通过 `assessmentOutcome()` 复验：每条启用规则恰好一条 `rule_assessments`、direction 落定、有 `intent_evidence`；worker 想回答某个触发消息要凭 `answers: <triggerId>`，这是一次性授权 token，宿主校验拒绝（`questionWithResult` / `notAsker` / `notAnswerable`） | `src/policy.ts` 的 `assessmentOutcome`；`src/core/errors.ts`（`子代理`） |

## 2. 一句话结论

dsh-superagent 的机制层对我方是**窄口高价值**：产品面（来源、admission、mandate、面板、注意力经济学提示词）整体不适用，
但同一个"无人值守"前提逼出了四件我方缺失且可直接移植的东西——**模型可读文本当合同用测试钉住**（含每角色字节数预算与
退役词表）、**实验开关的中间态 observe 且默认就是它**、**审批/决定记录要带"依据事实"**、以及一个被真实系统验证过的
**持久化效果队列形状**（coalesce + generation + `Later` 不计失败 + per-kind health），最后这件正好是本 fork 最大空白
「定时任务子系统」（cline §6）缺的执行底座。工程面上它与我方同族的地方（content-derived id、docs 链接校验、
溢出落盘）都已被我方等价覆盖，§5 逐条列了不学理由。

## 3. P0：成本低、本轮已核实我方确实没有

### 3.1 模型表面契约测试：把 L1/L3/L31/L32 的"字面保留"真正钉住

- **dsh**（对方实测）：两份测试把"模型读到的一切"变成了合同。
  ① `tests/cards.spec.ts` 的 `RULES` 表：`[rule, file, says[], gone?]` 四元组——每条规则一行，声明**这条规则为什么存在**、
  落在哪个 prompt 文件、必须出现的原句（`says`）、禁止再现的原句（`gone`，例如覆盖改写后旧措辞残留）。跑在 vitest 里，
  改 prompt 忘写某句就是红灯。
  ② `tests/model-surface.spec.ts`：`BUDGET: Record<Role, number> = { orchestrator: 59_000, worker: 40_500 }`，注释原文
  *"Lower this limit when shrinking model-facing text; raise it only intentionally and explain why in the commit message"*；
  另有 `LEGACY` 退役词表（`reopen` / `event/` / `task/` 不得再现）和"prompt 文本里提到的工具名 ⊆ 注册工具 schema"对账。
- **我方**（实测）：模型可见文案分散且**只有功能局部断言**——`packages/core/test/session-runner.test.ts` 断过
  `"Generate a title."`、`"Background work completed"`、`"Checkpoint instructions"`、`"Newest instructions"` 这些碎片，
  但没有任何一处回答「哪些句子是承重契约」。施工图 L1 的契约 token（`Loop guard: ...` 两条）、L3 的拒绝措辞、
  L31 的 `claimCeiling` 字面、`publish-llm-event.ts` 的 `INPUT_FAILURES`、`max-steps.ts` 的 `MAX_STEPS_PROMPT`、
  `unfinished.ts` 的 notice token、`subagent.ts` 的 `"DO NOT sleep, poll..."`——这些"模型读到的关键句"目前唯一的
  载体是 markdown 文档，重构删掉不会有任何红灯。
- **落点**：`packages/core/test/model-surface.test.ts`（新），复用 `session-runner.test.ts` 已有的 `TestLLM` /
  `compileRequest` 组装真实请求，断言四类：(a) 承重句 `toContain`（L1/L3/L31 落地时把契约 token 登记进来，先登记
  已存在的 `INPUT_FAILURES`、`MAX_STEPS_PROMPT`、notice token）；(b) 退役词表（起步空表，机制先立）；(c) 每角色
  "system + 工具定义"字符预算——**先量再钉**（用施工图 §5.2 的测量协议跑一次取基线，上限取基线 +5%，与 dsh 的
  "~5% above baseline" 同法）；(d) prompt 文本提及的工具名 ⊆ 注册工具名（防 L13 那类幻觉名从我们自己的文案里长出来）。
- **相撞检查**：⚠️ 这是 **L32 的仓库级先行路径**，不是替代——L32 管运行时预算（超了裁剪/拒发），本条管"悄悄变大"在
  CI 就红。⚠️ L1 的测试用例表已含契约 token 断言，本条是把这些断言**集中到一个有规则名、有理由的表里**，L1 落地时
  从自己的测试里删掉重复份。⚠️ 预算数字不许拍脑袋，先量后钉（同 L25/L1 的先量纪律）。

### 3.2 loop guard 增加 observe 中间态——把「默认开」的决定变成数据

- **dsh**（对方实测）：`eval.mode` 三态且**默认 observe**（§1 第 3 条）。observe 的产出不是日志而是**审计记录**：
  `assessmentOutcome()` 把模型判断改写成 `{ kind: 'ignore', audit: { ...audit, would_accept: true, proposal } }`，
  "我本会接受什么"与"实际发生了什么"可以事后对账。切换模式还带着 `policyVersion` 内容哈希，每个 Decision 盖章。
- **我方**（实测）：施工图 L1 的开关是布尔 `experimental.loop_guard`（默认开，决策点里写着前提是
  poll-is-not-a-loop 同 PR 合并）。**中间态缺失**：要么全开（误伤风险未量化）、要么全关（数据采集不到）。
- **落点**：L1 的 `loop.ts` 折叠骨架不动，加一态：`loop_guard: "off" | "observe" | "on"`。observe 下四类判照算，
  触发时不拒绝、只写一条 durable 记录（建议 `session.event` 侧的投影表或既有 outcome 记录位，**不进** `doc/usage-stats.md`
  的日聚合——同 L25 保活 ping 的记账原则：显式归类，不虚构归属）。默认值定为 `observe`，跑一段真实使用后用
  「would-block 次数 / 误伤候选」数据决定是否切 `on`——这正是施工图 §5.2「先量再定默认」协议需要的仪器。
- **相撞检查**：⚠️ 不改 L1 的判据与收束语义，只加 rollout 仪器；L1 文档落点不变（`doc/session-loop.md`）。
  ⚠️ observe 记录必须是 durable 的（`doc/records/2026-10-todo-completion-nudge.md` 否决进程内 Map 的理由同样适用）。

### 3.3 审批决定带「依据事实」——L31 的两列增量

- **dsh**（对方实测 + `子代理`）：每个 Decision 永久携带 `audit`（逐规则判断、direction、证据）与 `policyVersion`；
  面板的 ticket 页把 mandate 的 basis facts 一直展示下去（`views/tickets.ts` 的 `basisFacts`）。「为什么放行了它」
  是一等数据，不是日志。
- **我方**（实测）：`packages/core/src/permission.ts` 的 `evaluate()` 用 `findLast` 折叠并**返回命中的那条
  `Permission.Rule`**——匹配规则在判定点已经拿得到，只是没人存。施工图 L31 的 `permission_decision` 表记了
  `effect` / `decided_by` / `source`，**没记命中规则与当时规则集形状**。
- **落点**：L31 施工卡加两列：`matched`（命中规则的 `{action, resource, effect}` JSON，规则匹配自当前 ruleset 时写，
  `posture`/自动放行写 `null`）与 `posture`（判定时 ruleset 的形状指纹，例如规则条数的哈希——**不做** dsh 那套全局
  policyVersion，我方权限规则集是会话级的，全局版本号是过度设计）。回执 builder 增加一行"allowed by rule
  `<action> <resource>` (as configured then)"。改动是 L31 表 + `evaluate` 调用点透传，不是重设计。
- **相撞检查**：⚠️ 挂在 L31 之下，不另立条目；L31 的"`host` 永不记成用户拒绝"等既有约定不动。⚠️ dsh 的
  mandate-revalidate（按当日设置复验历史 mandate）**不借**——交互会话里权限规则的时效语义已经由
  "escalation outranks every allow" 守住，事后翻案是另一套产品。

## 4. P1：机制清晰、需要设计

### 4.1 定时任务子系统的执行底座：dsh 的持久化效果队列（cline §6 施工卡增量）

- **dsh**（对方实测）：`src/app/effects.ts` 一张 SQLite `effect` 表扛住全部异步副作用。**Row** =
  `{key, value, seq, generation, attempts, due}`，每 `kind` 一个 handler。四个形状值得整块搬：
  ① **合并入队**：upsert 时 `SET value = excluded.value, generation = generation + 1, attempts = 0`——同 `(kind,key)`
  的重复入队改载荷、保队位、清重试计数；
  ② **generation 防踩**：完成删除必须 `WHERE kind AND key AND seq AND generation` 全匹配——排队中的载荷被更新后，
  正在跑的旧尝试结束删不掉新行；
  ③ **`Later extends Error`**：可重试但不算失败的暂停（忙、无槽位、来源关闭）抛 `Later` 重调度，**不增 `attempts`、
  不进 health**；真失败才累计，指数退避 `retry[0] * 2 ** min(attempts, 16)`，连续 `FAILURES_BEFORE_ERROR = 3` 次
  把该 kind 的 health 置错；
  ④ **内容派生 ID**：`src/core/ids.ts` 的 `key()` = `sha256(JSON.stringify(values))` 前 32 hex，"做过没有"就是一次
  主键冲突。
- **我方**（实测）：cline §6 已定「规格文件 → watcher → reconciler 单向同步进 DB → sweep 执行」的骨架，
  但**执行侧**（一次 fire 的重试、跳过、健康可见性）还是空白。我方唯一的持久队列是 `session_inbox`，而它按
  Session Core 的约定只存"未投递的 prompt"，不该被拿来当通用工作队列。
- **落点**：cline §6 增补一段：fire 调度进 `schedule_fire` 效果表，`(kind,key)` 里 key 用 `key('schedule-fire',
  specId, fireAt)` 这类内容派生形式（同一 fire 重复入队天然幂等）；规格编辑走到 generation ②；「上一次 fire 还在跑、
  服务暂停、agent 忙」抛 `Later` ③，只有真实失败计入 3 次健康闸；health 的错误文案按 dsh 惯例**写明去哪看**
  （对应 `src/core/errors.ts` 给 `SetupError` 配"修复地点"的做法，`子代理`）。投递终点仍是 `Session.prompt(...)`
  的 inbox，效果队列只管定时器自己的工作，**不得**绕开 inbox 直接写会话。
- **相撞检查**：⚠️ cline §6 的 reconciler 设计不变，本条只补执行语义；两处文档落点合并写（`doc/` 新主题文档归属
  待定时任务立项时定）。⚠️ ②③④ 的形状对我方现有代码**零适用点**（当前无异步副作用面），不提前落——这正好也
  是"不单独立项"的理由（§5）。

### 4.2 内置被覆盖后的升级漂移检测（override-with-base）

- **dsh**（对方实测）：`src/app/prompts.ts` 的每条 override 记录 `base`（"Key of the built-in text it was edited from"）；
  `DefaultChange { part, base?, previous?, removed? }` 在**升级把内置文本改了**的时候，把"你覆盖时基于的旧文本"
  翻出来给团队看 diff，而不是让覆盖静默漂移。保存时还拒绝丢掉模板必需占位符的覆盖。
- **我方**（实测）：同样的漂移面存在但没有检测。`packages/core/src/config/plugin/agent.ts` 的 `editor.update(agentID, ...)`
  允许用户配置按 ID 补丁内置 agent（模型、权限、system），`disabled` 直接移除；技能同名遮蔽静默择一（施工图 L32
  实测）。本 fork 定期合上游（`2.2.0-fork.10`），上游一改内置 agent/技能，用户的覆盖就**无声地基于过时假设**运行。
- **落点**：覆盖生效时记录被替换内置字段的指纹（内置 agent 的字段哈希；技能遮蔽记被遮蔽内置技能的文本哈希）。
  加载/升级时比对，漂移的走 L32 已有的 `SkillConflicts` 指令源（技能侧）与 config 加载警告（agent 侧）——不弹窗、
  不阻断，进「模型可见的冲突披露」与 `/issues` 类清单。**待验证**：指纹存哪（config.json 是用户手写文件，可能需要
  sidecar 或约定字段），动手前先看 `config/normalize.ts` 的写入路径。
- **相撞检查**：⚠️ L32 管运行时遮蔽披露，本条管**升级时**漂移——同一族不同失效模式，落进 L32 的披露通道而不是
  新开一套。⚠️ 我方文档纪律（records 不改写、superseded 行）已经是 fork 自身的漂移处理，本条管的是**用户配置**
  对内置的漂移，二者不重叠。

## 5. 明确不学（含理由）

| dsh 机制 | 不学理由 |
| --- | --- |
| Source / Trigger / admission / mandate / policyVersion 本体 | 交互式 fork 没有主动受理面；policyVersion 盖章思想已吸收进 3.3 的最小形式 |
| 读回执（`TicketInput.readAt`、`letGo`、`requeueUntaken`，`子代理`） | 对方为"取消的轮次可能丢消息"做的补偿；我方 delivery 即同事务写历史（Session Core），重启后历史即真相，**已有更强形式** |
| `tests/docs.spec.ts`（链接解析 + 编号文档 + 架构表↔文件系统对账，对方实测其形状） | `bun script/doc-refs.ts` 已覆盖且进 lint；架构表对账我方无此文档形态 |
| `noWait` 的 sleep 工具守卫 | 文案已有（`subagent.ts` 的 "DO NOT sleep, poll..."），失控兜底归 L1；交互场景用户会真的要求"等 60 秒再跑"，命令位一刀切误伤 |
| orchestrator/worker 类型化交接（`answers: <triggerId>` 一次性授权） | 我方无跨对话授权；审批已是代码判定 + 3.3 的依据落盘 |
| `WorkerSlots` / `untilQuiet`（容量算后台作业，`子代理`） | 单 Session 单 drain 已由 `SessionRunCoordinator` 保证，无容量账可算 |
| 效果队列单独立项 | 我方当前没有异步副作用面；随 4.1 落地，提前落是死代码 |
| 面板 closed problem kinds（`no-source`/`no-allowed`，对方实测其存在） | 无人值守系统的"总览"；MCP 失败我方已有 `/mcps` 重连入口 + 模型可见 instruction（`mcp/index.ts`），交互式下问题当场暴露 |
| 注意力经济学提示词、PATH shim 身份强制、观察窗口（first-5+5 + cursor 读，`子代理`） | 均为多对话/多角色前提；我方单会话上下文经济学已有自己的双轨方案 |

## 6. 对照清单：dsh 数据点如何改变既有条目

- **L1**：+observe 中间态（3.2）——L1 的「默认开」决策点从此有了测量仪器；判据与收束语义不变。
- **L31**：+`matched` / `posture` 两列（3.3）——`evaluate()` 返回值已在手，纯增量。
- **L32**：+仓库级预算测试先行（3.1）——运行时预算照旧，CI 红灯先行。
- **cline §6**：+效果队列四形状（4.1）——reconciler 不变，执行语义补齐。
- **G3 / L25 / L26**：dsh 无对应物，无变化。
- **`优势对比清单.md` §3.2 口径**：循环可靠性一节可加第四家数据点——dsh 也没有通用重复/空转断路器，
  它的对策是结构性的（`noWait` 让编排者根本无事可等）；这支持「断路器是交互式 agent 的刚需」的既有判断。

## 7. 附：复核命令

对方事实（在 `D:\code\github\dsh-superagent-prototype`，本轮均已跑）：

```sh
sed -n '1,30p' tests/cards.spec.ts                                   # RULES 四元组表
grep -n 'BUDGET\|~5% above baseline\|LEGACY' tests/model-surface.spec.ts | head
grep -n 'class Later\|FAILURES_BEFORE_ERROR\|generation = generation + 1' src/app/effects.ts
grep -n 'seq, generation' src/app/effects.ts                          # 完成删除的全键匹配
grep -n "createHash('sha256')" src/core/ids.ts
grep -n "z.enum(\['off', 'observe', 'auto'\])\|would_accept" src/policy.ts
grep -n 'base\|DefaultChange' src/app/prompts.ts | head
grep -n "no-source\|no-allowed" src/app/views/overview.ts
grep -n 'SLEEP\|noWait\|30_000' src/app/sessions.ts | head
grep -n 'afterCommit\|SAVEPOINT' src/app/store.ts | head
```

我方事实（在 `D:\code\opencode`，本轮均已跑）：

```sh
grep -n 'MAX_LINES\|full output saved to' packages/core/src/tool-output.ts        # 溢出已有去处
grep -rn '"Generate a title."\|Background work completed' packages/core/test/session-runner.test.ts   # 断言是碎片化的
grep -n 'findLast' packages/core/src/permission.ts                                # 命中规则可取
grep -n 'editor.update(agentID' packages/core/src/config/plugin/agent.ts          # 内置可被覆盖
grep -n 'DO NOT sleep' packages/core/src/tool/plugin/subagent.ts                  # 文案已有、守卫无
grep -n 'Reconnect it from' packages/core/src/mcp/index.ts                        # MCP 失败已有一等入口
grep -rln 'Outbox\|class Later' packages/core/src --include=*.ts | wc -l          # 0：无效果队列
```
