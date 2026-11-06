# Reasonix（DeepSeek-Reasonix）借鉴清单

- 分析时间：2026-11-01
- 来源仓库：`D:\code\github\DeepSeek-Reasonix`（分支 `studio`，HEAD `b9daee966`）。Go 单模块：非测试约 49.5 万行、**测试约 58.7 万行（比产品代码还多）**、3738 个 `_test.go`；`internal/` 12 个一阶包（ext/runtime/state/frontend/contract/session/safety/tools/platform/assembly/model/base）；`desktop/` 2127 个文件（Electron + frontend-next TS/TSX）；`benchmarks/` **1461 个文件**；`docs/` 106 篇机制文档，其中 **33 篇 `*_SECURITY.md`**（计数命令见第八节）。
- 对照仓库：本仓 `loop-reliability-docs` @ `81738639df`
- **本文只做分析，未改任何代码。**
- 证据分级：**[实测]** = 本轮我亲自打开该文件并复述其内容；**[转述]** = 子agent报告、我未逐行复核（动手前必须复核）；**[实测存在]** = 我只确认了文件/符号在，语义来自文档或子agent。第六节记录本轮未能升级为 [实测] 的项。
- 对账声明：已与 adm / kimi / codex / cline / gemini / aider / goose / codewhale / ZCode / oh-my-pi 十轮及合并稿 `借鉴技术方案-cline-gemini.md`（L 号）逐项对账。**已在他轮立项的主题在本清单撤下**，见第三节；已写下否决的项集中在第四节。

## 一、结论框架

Reasonix 的路线是**把并发与崩溃当成主战场**：它把「一个可能崩、可能被取消、可能被两个写入者同时动的状态机」写成了 33 篇 `*_SECURITY.md`，每篇对应一个失败模式（租约、栅栏、收据、重检、幂等、fail-closed 保留字节）。它的测试行数超过产品行数，`benchmarks/` 有 1461 个文件，并且用**代码守卫**（种子必须过不了、参考解必须过）来防止自己的评测自欺。它的强项是**写路径的准入语义**和**外部契约的可证性**。

opencode 的路线是**事件内核 + Location 服务 + 多客户端**：durable 事件、inbox 交付、写前执行 claim、compaction 预算、生成式客户端与生成物漂移门禁。我们在「状态一致性」上比它更成体系（它是 JSONL + 派生投影，我们是事件折叠 + projector），在「工具与写路径的具体准入规则」上比它粗。

真正的增量集中在三处，且都不需要换栈：**写操作的准入**（它有三条我们完全没有的门：看过才准覆盖、破坏性目标全档位硬拒、并行写路径冲突即拒）、**来源分档的权限**（项目配置现在能静默取消「问一次」）、**外部契约与外部事实的可证性**（ACP 逐帧官方 schema、价格代际与复核、多端能力债务矩阵）。它的招牌（108 万行 Go 单体、sidecar 扩展运行时 V2、会话托管 worktree、SQLite 检索投影、marketplace）要么建立在那个栈上，要么撞上本仓已写下的否决。

## 二、可借鉴项（按 价值/代价 排序）

### 1. 「看过才准覆盖」：读取来源决定写准入 [实测两边]

**它的机制**（`internal/tools/builtin/fileviews.go`，[实测]）：

- `FileViews` 记 `fileView{content: sha256, complete bool}`。**只有从 offset 0 起、成功、完整、未超限的那次读取**才能替换一个文件的观察（第 63 行注释："Only a complete returned read can replace an earlier observation. A page, …"）；`captureRead` 在 `offset != 0` 时直接透传不刷新，`sawPartial` 只留下「不完整」的事实。
- `checkOverwrite(path, current)`（第 117 行）：目标文件在盘上的内容与已观察不符、或已观察但 `!complete` 时，返回 `ErrFileNotFullySeen`，并且**错误文本是给模型的可执行纠正**："write_file replaces all %d lines of %s; read it whole first (read_file with offset 0 and limit >= %d), or use edit_file for a targeted change"（第 129 行）。
- `BindFileViews`（第 139 行）给每个子代理 registry 绑一张**自己的表**——子代理读过不能替父会话的覆盖保护背书 [转述]。

**我们的现状** [实测]：`packages/core/src/tool/plugin/write.ts`（全文 101 行）读当前内容只为了算 diff 预览给用户看（L73-77），随后 `permission.assert` → **无条件 `writeTextPreservingBom`**。没有「模型是否读过这个文件」的任何状态：`grep -n "seen|readState|hasBeenRead|staleness|mtime" packages/core/src/tool/plugin/read.ts packages/core/src/tool/plugin/shell.ts` **零命中**。另一个不对称也值得单独确认是否有意：`edit.ts:315` 与 `patch.ts:304` 都套了 `fileMutation.withLock([...])`，而 `write.ts` 的 execute **没有**——它的读→审批→写不在同一条事务锁里（`file-mutation.ts:32` 声明该锁的语义正是 "Serialize a complete read/prepare/write mutation transaction by resolved path"）。审批可能等人几百毫秒，期间另一个并行工具或外部进程改了盘，我们的 `write` 会把预览里没出现过的那部分覆盖掉。

**落点**：三小步，不要搬它的 sha256-per-file 结构（我们有 `Environment.files`，直接复用）。(a) Location 内加一张 per-session 的观察表，只在「完整读取」时记 (path → 内容指纹)，分页/超限/失败记「不完整」；(b) `write` 在指纹缺失或已过期时返回工具失败，文本按上面那句的形写（告诉模型怎么补救）；(c) 把 `write.ts` 也放进 `withLock`，与 edit/patch 对齐。子代理与 plan-mode 的只读代理各用一张表（或明确拒绝为其刷新）。

**代价**：小（一张表 + 一处检查 + 一行 pipe）。**验收**：读 1-50 行后 `write` 同一路径必须被拒；完整读后立刻被外部 `echo > file` 改盘再 `write` 必须被拒；`edit` 路径行为不变。**风险**：模型可能因为被拒而反复整读大文件，需要一个「超限文件不纳入强制门」的豁免，这一点它用 `complete` + 8MiB 上限处理 [转述 上限值]，我们得自己定。

### 2. 来源分档的权限：项目配置只能收紧，不能取消「问一次」 [实测本仓 + 实测对方文档]

**它的机制**（`docs/AGENT_COMPOSITIONS.md`，[实测]）：一张按来源（builtin / user / project）的权限表，第 214-218 行对 project 列逐项写 **Refused**：MCP 的 `args`、`url`、`env`、`headers` 在 project 层 "Refused, **including empty array/map overrides**"（防「把凭据引用抹掉」这种反向放宽）；Extension 的 `args`、`env` Refused；第 218 行 "Extension executable, hook/command code or module installation | No new authority | … | **Cannot replace a launch or approve/install a program**"。第 223-224 行："Project definitions can select only resources already authorized by the user, **never widen capabilities or change a launch**"。第 177 行 project 文件不能选默认组合，第 207 行"选择一个定义从不授予权限"。

**我们的现状** [实测]：`packages/core/src/config.ts:307-316` 的加载顺序是 `managedPolicies → integrations → wellknown → globalSupplementary → explicit → direct → **projectSupplementary** → content → managedSettings`，同文件 L298 的注释自己写明 "Global entries sit below explicit and direct files; **project directories rank above them**"。`packages/core/src/config/plugin/agent.ts:83-90` 把所有文档的 permissions `flatMap` 后 **`agent.permissions.push(...permissions)`**（追加），而 `packages/core/src/permission.ts:83-93` 的 `evaluate` 用 **`findLast`**。三者合起来的结论：**clone 一个仓库并打开它，其中的 `opencode.json` 或 `.opencode/agent/*.md` 可以把用户全局设成 `ask` 的动作改成 `allow`，也就是静默取消「问一次」。** 现有缓解只有两样：`Permission` 的 escalation（`doc/permissions.md`："an escalation outranks every allow rule — an agent default, **a project config**, or a saved always-allow"，救得了 `rm -rf` 这类形状，救不了「edit 不再问」）和 agent 缺省 deny-all（`permission.ts:19`，只在 agent 完全没有规则时生效）。

**落点**：给规则带上来源档（`Rule` 加一个 `tier`，或按档位分桶存进 ruleset 后固定顺序求值），把 project/content 档的写入限制成「只能把 allow 变 ask/deny」；程序与参数（MCP command/args/env、`formatter`、`commands.*`、插件可执行）不接受 project 档新增或替换。这是**新增一条求值前的来源门**，不是改折叠顺序——与本仓已否决的「最严者胜折叠」（`doc/records/2026-10-permission-fold-ordering.md`，goose §6 / C14）无关，那条反对的是把 `never>always>ask` 折成单值。**要单独核实**：`packages/core/src/config/plugin/mcp.ts` 是否已有「内置服务器不被替换」级别的保护（本轮只在 [转述] 里看到，未亲读），以及托管策略 `config/plugin/policy.ts` 是否已经覆盖同一位置。

**代价**：中（触及规则数据结构与所有写入方）。**验收**：一个把 `edit` 设成 `allow` 而全局设成 `ask` 的项目配置必须被拒绝或降级；项目里的空 `env: {}` / `args: []` 覆盖必须被拒绝；`doc/permissions.md` 的 Evaluation 一节补上这条来源门。

### 3. 破坏性目标在任何审批档位都硬拒 [实测两边]

**它的机制**（`internal/tools/builtin/bash_delete.go:20,144`，[实测]）：`const CodeDestructiveTarget = "shell.destructive_target"`，拒绝文本 "Use a target strictly inside the workspace or granted write roots; home, filesystem roots, workspace ancestors and out-of-scope paths are protected **in every approval mode**"。它不是一个 effect，是一个**错误码**——所以不存在「哪条 allow 规则能盖掉它」。配套规模：`bash_delete_parser.go` / `bash_delete_interpreter.go` / `delete_range.go` / `delete_symbol.go`，带 `bash_delete_pwsh_test.go`（PowerShell 语义单独测）与 `bash_delete_parser_budget_test.go`（解析本身有预算，防被输入拖死）[实测 文件存在，语义转述]。另有 `docs/TOOL_APPROVAL_MODES.md` 的 Yolo 定义：只跳普通提示，**不跳 deny、不跳沙箱、不跳 plan 确认、嵌套 Bash 仍需真人** [转述]。

**我们的现状** [实测]：`packages/core/src/shell/danger.ts` 的 verdict 分类（`doc/permissions.md` 把它写得很细：递归删除对 `/`、`~`、`$HOME`、顶层系统目录、`dd`/`mkfs`/`shred`、`find / -delete`、fork bomb、pipe-to-shell、`shutdown`），`shell.ts:140-150` 把 `risk` 传给 `permission.assert`。求值顺序是 **deny → escalation → allow**，escalation  outranks 所有 allow——**但「唯一能清掉它的是会话自身含 `{*,*,allow}` 的规则集」**，即 composer 的 Full access；而且 Decisions 里明写 `--auto` 的机器可以代答（"The escalation happens server-side before any client sees a request, so a non-interactive run still gets a prompt — **which the CLI's `--auto` path then answers**"）。也就是说：**`rm -rf` 打向 `/` 或 `$HOME` 在本仓是可以被一个档位开关或一个 `--auto` 放过去的**，在 Reasonix 是不存在放行路径。

**落点**：把「目标形状」从 escalation 里拆出来，做成一个 `dangerous-target` 的**不可取消拒绝**（返回 `shell.destructive_target` 形态的错误码，提示改成工作区内目标），保留 escalation 作为其余不可分析情形的门。**注意这一条推翻 `doc/permissions.md` 里写下的一个 Decisions**（"The escape hatch is choosing Full access for the session"），属于要用户拍板的设计反转，不是可以直接顺手改的实现细节；改之前先决定是否愿意让 Full access 与 `--auto` 出现一个「不管怎么配都不放行」的洞。

**代价**：小（一个门 + 一个错误码 + 一次文档 Decisions 改写）。**验收**：Full access + `--auto` 的 `opencode run` 跑 `rm -rf ~` 必须失败而不是执行；`rm -rf ./dist` 必须照常；PowerShell 与 bash 两条解析路径结论一致。

### 4. 一步内并行写的路径冲突：预留路径集，冲突即拒 [实测两边]

**它的机制**：`internal/runtime/writeclaim/write_grant.go:22` `const CodeWritePathBusy = "write.path_busy"` [实测]；`writeclaim/scheduler.go` 的 `ReserveWrite(paths WritePathSet)` / `TryClaimWritePaths` / `conflictLocked` / `ActiveWriterClaims`，并区分 parent claims 与子代理 claims（`NewSubagentScheduler(maxTotal, maxWriters)`）[实测 符号]。`internal/runtime/agent/optimistic_write_admission.go:14` 的 `reserveToolWrite(ctx, writer, args, readOnly, declared)` 注释写明 **admits the actual execution target, including a child proxy's** —— 预留的是解析后的真实目标，不是模型声明的字符串；兄弟后台任务持路径时乐观任务仍可经直接/动态工具写入，全路径集 all-or-nothing，冲突回 `write.path_busy` [转述]。同一族还有 `state/workspacelease/`（跨会话 flock 路径租约 + `claimlog.go` 记录谁 claim 了什么 + `yield.go` 等待时放开并回报竞争者）[转述]。

**我们的现状** [实测]：`packages/core/src/session/runner/step.ts:123-134` 把每个 tool-call 用 `Effect.forkScoped` 起成并发 fiber（AGENTS.md 与 `script/session-efficiency.ts` 都把 "parallel tool gain" 当作优化目标），到 `Fiber.awaitAll`（L151）才收。序列化只发生在**单路径粒度**：`file-mutation.ts:60` 的 `KeyedMutex`，同文件 L62-65 的注释自己承认 "Mutation locking is process-local and serializes cooperating OpenCode changes; **external writes can still race**"。后果是：同一步里两个工具写同一路径 = 后写静默覆盖前写，而不是冲突；`file-mutation.ts:132` 还挂着一条我们自己的未来项 "TODO: Design multi-file transactions / rollback if patch needs atomic edits"。

**落点**：不要上它的调度器。第一步只做**同一步内**：`Step` 起一个本轮写路径集合，工具在真正落盘前一次性申请自己的路径集（目录写按它的祖先/子树规则与已有集合相交），相交就返回冲突错误、不动盘，让模型改成本地顺序或换目标。跨会话的部分**不要在这里做**——那是 adm 轮第四章 / L11 的既有议题。**与第 1 项同源**（都发生在写落盘前的同一处），可合成一个 PR 序列。

**代价**：中（要定义「目录租约 vs 文件」的相交语义，正是它 `OpaqueWrite` 卡住的地方——见第六节：他们承认那条只有库和测试、没有生产调用者）。**验收**：一个步内让模型并行写 `a.ts` 与 `a.ts` 必须第二个失败且文件内容是第一个的结果；写 `dist/` 与 `dist/x.js` 必须判为相交；无写工具的步不受影响。

### 5. 评测语料的防自欺守卫：种子必须过不了、参考解必须过，用一个测试守住全部语料目录 [实测对方]

**它的机制**（`cmd/e2ebench/corpus_test.go`，[实测] 测试名）：`TestSolvableCorpusSeedsMustNotGradeClean`（每个可解任务的**起始状态必须过不了 `verify.sh`**）、`TestCorpusGradersPassTheReferenceSolution`（参考解必须过）、`TestNoSolutionCorpusGradesTheInverseContract`（若干"无解"任务必须真的能拒绝"作弊通过"，数量 [转述]）、`TestAnchorCorpusSeedsBothArmsOrNeither`（锚定双臂要么都配要么都不配）、`TestCorpusLetsTheAgentDecideWhenToStop`（不许任务把停止时机规定死）、`TestContradictionGraderAcceptsPnpmRejectsNpm`（**评分器自己也要被测**：一个接受 pnpm 的评分器必须拒绝 npm，否则它什么都能过）。这些守卫覆盖 `benchmarks/` 下 e2e / verification-stress / train / memorybench / fanout-width / upstream-edge / project-check / realrepo 全部语料目录，且**随 `go test ./...` 进 CI**；付费的模型对跑不进 CI [转述]。另有中立计量：`-meter` 在 provider 边界用回环代理计数，报告 "self-report divergence"；无 usage 记 `unmeasured`，**绝不当 0**；JSON 里显式省略随机种子并注明原因——不假装可复现（`benchmarks/README.md`）[转述]。

**我们的现状** [实测]：本仓没有任何 agent 行为语料。`git ls-files | grep -iE "benchmark|eval"` 侧只有 `packages/core/script/snapshot-parity.ts`（快照引擎差分）、`packages/app` 的 `test:bench:devex`、`perf/test-suite.md`；`script/session-efficiency.ts` 量的是**已发生会话**的耗时构成，不是任务通过率。

**落点**：**这一项是 gemini 轮 G4「行为评测+可信度分级」（已并入 L28）的实现细节，不是新里程碑**——G4 立项时没有回答「怎么保证语料本身不是在自欺」。搬的就这一点：任何新增语料目录都自动进一条守卫测试，规则是「种子必挂 / 参考解必过 / 无解任务必须能拒」，评分器自带一个反例测试。没有这条，语料越多越危险：一个本来就能 `verify.sh` 通过的种子会让分数恒为 100%。

**代价**：小（守卫与语料同批写）。**验收**：故意把一个语料的 `verify.sh` 改成恒真，CI 必须红。

### 6. ACP 一致性拿官方 SDK + 逐帧 schema 当靶子 [实测两边]

**它的机制**（`tools/acp-conformance/`，[实测]）：`harness.mjs` 直接 `import * as acp from "@agentclientprotocol/sdk"`，并 `require.resolve("@agentclientprotocol/sdk/schema/schema.json")` 把**官方 schema 编译成 ajv 校验器**（自注册 `double`、`uri` 两个 format）；L116-118 的 `wireProblems(wire)` "Every message the agent wrote must satisfy the official schema"，conformance 测试要求它为空；L46 注释说明为什么要按「产生该响应的那条请求」来选择 schema 分支。配套 `fakemodel.mjs` 让它**不依赖真实供应商**也能跑，`make acp-conformance`（Makefile:93）是一条可点名的靶子。

**我们的现状** [实测]：我们有相当完整的 ACP 实现——`packages/cli/src/acp/` 20 个手写文件（agent/capabilities/catalog/child/client/compaction/config-option/connection/content/directories/elicitation/error/permission/prompt/replay/sessions/tool/translate/turn/service），`packages/cli/test/acp/` 14 个测试含 `.subprocess.test.ts`。但根与 `packages/cli/package.json` 里**没有 ACP SDK 依赖**（`grep "agent-client-protocol|@zed-industries"` 零命中），也没有对「我方发出的每一帧」按官方 schema 的校验。我们的测试全在校验自己的翻译层。

**落点**：加一个 devDependency + 一个 `script/acp-conformance.ts`：用我们的 subprocess harness 跑一组固定场景，把写出的每条消息喂官方 schema，`wireProblems` 必须为空；再补一个假模型替掉真供应商。价值不在覆盖率，在**把「符合协议」的定义权交给协议作者**——这正是我们 AGENTS.md 对生成式客户端已经在用的思路（`check:generated` 由 protocol 自己生成），只是 ACP 这一侧我们是手写镜像。

**代价**：小（一个 harness）。**验收**：故意把一个 `_meta` 字段类型改错，conformance 必须红。

### 7. 价格作为 append-only 代际数据 + 一个触网的复核工具 [实测两边]

**它的机制**（`internal/contract/pricing/rates.go`，[实测]）：`type rateGeneration` 带 `From`（该代计费起始日 YYYY-MM-DD UTC，注释解释空值含义），`officialRateRow` 带 `DocURL` 与 `CheckedOn`（**核过价的日期与来源 URL 是数据的一部分**），L51 注释 "officialRates is the price book. **A price change appends a generation rather than …**"——旧价不删的用途是让「用户配置里存的价」能被识别成「这是我们某个时期发过的价」而不是当作未知自定义价。`make pricecheck`（`tools/pricecheck`）触网抓官方页对比，**故意不进 CI**，读不到页面即非零退出，纪律写作 "unread ≠ agreed" [转述]。

**我们的现状** [实测]：`packages/core/src/session/usage.ts:21-52` 的顺序正确（端点实报优先，报 0 也算数，没报才按目录价 `calculateCost`）；目录价来自 models.dev（`packages/core/src/models-dev.ts`、`model-resolver.ts`），`Model.Info.cost` 是带 context tier 的数组。缺的正是它那两个字段：**没有「这条价是哪天从哪个 URL 核过」的取证，也没有一个能对本机价目做差分的东西**。后果落在 usage 页的诚实性上——`doc/usage-stats.md` 已经承认口径设计（估算不入库、compaction 用量不进日分布），但目录价本身过期没人知道，页面仍然会显示一个精确到分的美元数。

**落点**：只搬纪律不搬实现——(a) 价目条目带 `checkedOn` / `source`（models.dev 的快照时间即可）；(b) 一个 `script/pricecheck.ts`，手动跑、输出与本机目录价的差异清单、抓不到即失败，**不进 CI**（它依赖外网，进 CI 会把红灯变成噪音）。与 ZCode「每模型选项数据化」/aider L7 是同族不同字段：那条管行为位，这条管价格位。

**代价**：小。**验收**：脚本能把某一条已知调过价的模型报为 diff；目录价字段缺失时 usage 页降级为「按目录价估算」而不是显示精确数。

### 8. 辅助调用并入同一预算，超预算复用已有的收尾路径 [实测两边]

**它的机制**：`internal/runtime/agent/run_loop.go:758-763` [实测] —— 每个工具轮结束后 `exceededTaskBudget(ctx, state)`，命中就 `armFinalizationRound(landCause{kind: "task_budget", …})`，`max_steps` 走**同一个** `armFinalizationRound`。也就是说超预算不是拒绝、不是杀进程，而是**降级收尾一轮**（禁用工具，让它把话说完）。ROOT_* 那批文档（`ROOT_AUXILIARY` / `ROOT_TRIAGE` / `ROOT_WEBSEARCH` / `CONTROLLER_ROUTING` / `COORDINATOR_ROOT` / `GOAL_PLANNER`）逐条关闭一类泄漏：reviewer、摘要、分类器、原生搜索、语义路由此前**绕开 Agent 根计数器** [转述]。计数规则：`max(total, in+out)` 不相加、负数不能充值、溢出饱和 [转述，`budget_tokens.go`]。

**我们的现状** [实测]：我们的辅助 LLM 调用只有两处——`packages/core/src/session/compaction.ts:805-931`（摘要流，`stepFinish` 即 `spend`，注释 L912-916 明写"每个模型调用一完成就计费，失败与被打断的压缩也照付"）与 `packages/core/src/session/title.ts:59-96`（`onInterrupt` 也把已累积 usage 发布出去）。两者都发 `SessionEvent.UsageRecorded` 并由 `projector.ts` 的 `applyUsage` 累加进 `session` 表——**所以"辅助花费对账单隐形"这个它踩过的坑我们没有**。真正的差在强制侧：估算只用于「发多大的请求」（`model-request.ts:85-90` 的 `room` 公式），本地没有会话级 token/wall 上限，超支只体现为 provider 拒绝（`to-session-error.ts` 的 `provider.budget-limit`）与 `usage-limits.ts` 的只读展示。**已立项关系**：goose 轮的 turn-budget 与 codex M4 子 agent 树预算已经占了「预算」这个题；这一条不是新里程碑，是给它们补一个我们已经付过账的收尾形状——到线时复用 `max-steps.ts` 的 `MAX_STEPS_PROMPT + toolChoice:"none"` 那条路，不新造机制。

**落点**：`Session.prompt` 允许带一个可选的 token/墙钟上限；`runStep` 的步预算判定处并列检查已投影的真实用量（含 compaction/title 来源），命中就走同一条"禁用工具的收尾步"。**先不加**它的饱和计数与 max 语义——我们入库的是 provider 实报，不需要那种防御。

**代价**：小-中。**验收**：一个设了很小上限的会话必须在超线后仍产出最后一条解释性回复而不是硬失败；compaction 的用量必须计入该上限（现在它进了 session 总额但没有任何预算读它）。

### 9. 多端能力债务用静态检查算出来，而不是写在一份永远过期的 parity 文档里 [实测存在 + 转述语义]

**它的机制**：`tools/repolint/` 约 25 条规则，本轮我确认存在的文件包括 `frontendparity.go`、`wireparity.go`、`layers.go`、`layer_order.go`、`comments.go`、`complexity.go`、`errortext.go`、`codeowners.go`、`docs.go`、`baseline.json` [实测 文件列表]。语义 [转述]：`frontendparity.go` 静态分析各前端（声明 EditorAPI/SessionAPI 端口的）对 Controller 能力的调用，算出 debt 矩阵，**豁免行必须带 issue 号**；`wireparity.go` 逐类型比对 Go 结构体与 `desktop/frontend-next/src/port/*.ts` 手写镜像。分层设计值得注意：`docs/STUDIO_PARITY.md` **自己承认** "Held by review, not by a gate: **no check reads this file**"——清单归清单（人维护、五态 Have/Have differently/Missing/Removed/Unverified），硬约束归 lint。`baseline.json` 是只减不增的棘轮 [转述]。

**我们的现状** [实测]：我们有依赖方向侧的等价物——`packages/cli/test/import-boundaries.test.ts`（CLI 前端不得直连 Core）、AGENTS.md 的分层规则（Schema→Core/Protocol→Server，Client 只依赖 Schema/Protocol）、`script/doc-refs.ts`、`script/ast-grep` 规则集 + `test:effect-simplification-rules`（lint 规则自己也有测试，这点和他们同思路）、生成物 `check:generated` 两条进 CI。缺的是**能力覆盖侧的度量**：`packages/tui`、`packages/app`、`packages/gui`、`packages/session-ui`、`packages/desktop`、`packages/client`、`packages/cli/src/acp` 是七个消费面，其中 client 是生成的、其余是手写的，今天没有任何东西能回答「桌面比 TUI 少实现了哪些 protocol 能力」。

**落点**：不是抄 25 条规则。只做一条：以 protocol 的 `HttpApi` 操作为分母，统计每个前端实际调用到的操作集合，输出一张债务表；新增缺口要么实现要么在豁免表里挂 issue 号。它防的失败模式很具体——**某端悄悄缩能力而 CI 全绿**，这在我们有真实前例（`packages/client` 的注释与 AGENTS.md 专门写了「不要手改生成物」，正是同一动机）。

**代价**：中（要能解析七个面的调用图）。**验收**：故意在某个前端不接一个新加的 protocol 操作，检查必须报债务；挂上 issue 号后放行。

### 10. 回退能力的前提与覆盖缺口，当成字段发布而不是当成沉默 [实测本仓 + 转述对方]

**它的机制** [转述]：`internal/state/checkpoint/checkpoint.go` 每个用户轮首次触碰文件前存全量 preimage（内容寻址 blob + 写后指纹），带 **`CoverageGap`** 字段显式声明「哪些改动不在回退保证内」；只跟踪可 Preview 的编辑工具，**bash 的副作用不跟踪**，README 也照实这么写（"Only files its edit tools changed are covered, not what a shell command did"，[实测 README]）。`HOOK_CHECKPOINT_SECURITY.md` 的结论值得记：只读工具 ≠ 只读调用——PreToolUse 可以先写文件再拒绝工具，所以「工具或 hook 任一可能写」就要先开写上下文，否则只记一条 `GapHookWrite` 缺口，**不伪造 preimage**。

**我们的现状** [实测]：我们的覆盖面其实更宽——`packages/core/src/session/runner/step.ts:234-258` 每步用 `snapshots.capture()` 取树，并用 `snapshots.files({from,to})` 做树 diff，所以 shell 改的文件也会出现在 `files` 里；`packages/core/src/session/revert.ts` 的 `plan()` 按 boundary 之后每条 assistant 消息的 `snapshot.start + files` 组恢复映射，stage/clear/commit 三段式，TUI 已有 "Revert — undo messages and file changes"。但有两个沉默的前提：(a) `snapshot.ts:90-105,114` 要求 `git.repo.discover(...)` 成功且 `location.vcs?.type === "git"`，非 git 目录直接 `Project is not a Git repository`；(b) `capture()` 在 disabled/unsupported/best-effort 失败时返回 `undefined`，`step.ts` 就把 `snapshot`/`files` 留空——客户端看到的是「没有这个信息」，而不是「这次改动不可回退，原因是 X」。`edit.ts:204`、`write.ts:43`、`file-mutation.ts:130` 还各自挂着一条 "TODO: Add snapshots / undo after design exists."（见第五节）。

**落点**：两个都不大。(a) 把「为什么这次不能回退」变成 `Step.Ended` 上的一个原因字段（disabled / 非 git 项目 / capture 失败），让 rail 与 TUI 能说一句话而不是留空；(b) 决定非 git 目录是否值得一个降级（他们不依赖 git 正是因为 preimage 存自己的 store；我们有内容寻址的 snapshot repo，缺的只是「源不是仓库时也能建一个孤立库」这一步）。**先做 (a)**：它只是把一个已有的事实说出去。

**代价**：小（(a)）／中（(b)）。**验收**：在非 git 目录跑一次写操作，客户端必须能显示"本次改动不可回退：项目不是 Git 仓库"；`doc/session-rail.md` 或 `doc/session-loop.md` 补上这个字段。

## 三、与既有轮次对账后撤下的项（不再推荐）

| 本轮看到的东西 | 撤下原因 |
| --- | --- |
| 工具表面 token 预算（7,185 tokens 内建预算 + 可选工具经 `use_capability` 稳定代理触达、"注册"与"provider 可见"分离） | **codex 轮 M7「工具表面预算/观测/并发」已立项**。「注册与可见分离」是 M7 的实现选择之一，并进去，不另开。 |
| 技能索引硬预算（4000 字符）+ 正文按需展开 + `paths:` glob 门控 + 显式技能共享根预算 | **codewhale 轮「技能预算+冲突可见性」已立项**；根预算部分与第八节同源。`paths:` glob 门控（未触达匹配文件前不暴露该技能）是该条未覆盖的细节，记在 codewhale 条目下补一句即可。 |
| 字节稳定的系统前缀 + 动态状态投射到用户轮尾（`REASONIX.md` Context projection + `boot/context_projection_test.go` 在 provider 边界守） | aider 轮「cache 保活 ping」、goose 轮「cache 确定性纪律」、codewhale 轮「cache 漂移归因」、oh-my-pi 轮第 5 项「注入三层解耦」四轮都碰过；本仓 `doc/context-economics.md` 的 Decisions 已有自己的立场。不再收。 |
| 安装 preview→apply 两步 + `contentDigest`/`planId` 防 TOCTOU + 主题包禁 CSS/JS/远程 URL | 供应链归 **codex 轮 M2**；且「marketplace + 安装签名」在 gemini 轮 §1.3/§8 已被明确否决（见第四节）。 |
| FTS5 历史/用量可抛弃投影 + 权威 JSONL + 游标绑快照代际（重写即 409） | **kimi 轮第三章「FTS5 会话搜索 + seq watermark」已立项**。他们的增量只是「投影坏了可以直接扔」这一句纪律，作为 kimi 那条的实现注记。 |
| 子代理进度冒泡（保留事件名 + 32 事件/s 限速 + 250ms 合并 + 8KiB pending + 子正文不进父转录） | **goose 轮「子代理收口五件套」**+ **oh-my-pi 轮第 6 项 park/revive/tombstone**。 |
| 会话托管 worktree（不在源仓库内 `worktree add` + 就绪才投递 + apply 前三方比较 + 祖先链 Lstat 校验 + `:(literal)` pathspec） | 本仓已有 `packages/core/src/worktree.ts`（策略化 create/remove/refresh + `WorktreeTable` 归属 + `opencode_worktree_create` 工具）；祖先链校验属其内部实现细节，且 git 路径字面量本仓已在用（`git.ts` 的 `literalPathspec`）。GIT_* 环境变量清洗归 **codewhale 轮「子进程 env 白名单」**。 |
| Windows Job Object 一次性 owner / `RootWaitCompleted` / job finalizer | **goose 轮「Windows Job Object」已立项**。 |
| 压缩触发比例、verbatim tail 窗口、摘要输出预算 | 本仓 `compaction.ts:131-171` 已有同族常量（`RESERVE_SHARE`/`PRECOMPUTE_RATIO`/`PRECOMPUTED_TAIL_*`/`SUMMARY_OUTPUT_FLOOR`），且 **adm 轮 3.1 条目级预压缩** 与 **gemini G2** 已立项。 |
| 权限档位 + deny 先匹配 + headless fail-closed | **codex 轮 M1「决策代数」**；本仓 `doc/permissions.md` 已把非交互无 `--auto` 的情形写成拒绝。只有第 2、3 两项是真正的增量。 |
| 生成物四方漂移锁（schema + SDK 类型 + 文档 + hash 一体，确定性测试） | 本仓已有：`packages/client/package.json:33` `check:generated`（重生成 + `git diff --exit-code`）、`packages/protocol` 同、两条都进 `.github/workflows/check-test.yml:140-148`。见第五节。 |

## 四、明确不学

- **108 万行 Go 单体的规模本身**，以及它换来的东西：33 篇 `*_SECURITY.md` 描述的租约/栅栏/收据/重检体系（`.result-locks-v1`、`.settlements-v1`、`inspection.json` 版本冻结）建立在他们「每个子系统都是自研进程内状态机」的前提上。我们的对应前提是可重启的事件折叠 + 写前 claim（AGENTS.md「claim 是恢复标记，不是集群租约或 exactly-once」），照搬等于先重写内核。
- **只有库和测试、没有生产调用者的安全机制**。他们自己在文档里承认：`PROCESS_ROOT_WAIT_SECURITY.md` 明写无生产消费者、`OpaqueWrite` 只被 `ci_workflow_test` 引用、`HOOK_WORKSPACE_INVALIDATION` 与 settlement 记录的创建方「仅文档声明」。本仓 AGENTS.md 已经写了同一纪律（"Don't design for hypothetical future requirements"、"Do not silently expand scope for theoretical robustness"）。这里不但不过，还要把它当成反面证据。
- **composition 引擎整体**（人格 + 工具 + 技能 + MCP + hooks + commands 打成一个带修订号的定义、会话绑定代际锁定、三级来源权限）。只借第四节第 2 项那一条**来源不得扩权**的规则；引擎的代际锁定与我们的 `Agent.Info` + config reload 形状不匹配。
- **扩展运行时 V2**（不可变 `RuntimeSnapshot` + 每会话 `RuntimeOwner` 血缘 + stage→ready→commit + 子图补丁 + 进程内 receipt 32 代×256 条）。这是为了「热重载一个 32 组件的运行中内核」造的一整套代际系统，附带 perf 文档和 `bench_threshold_test.go` 的软阈值（建图 <50ms、no-op diff <20ms、Dispose(64) <50ms）[转述]。我们的插件面没有这个需求形状。
- **sidecar 代码扩展 = full trust、继承未过滤环境**（文档自己写明无沙箱，[转述]）。与本仓已确立的「无 OS 强制沙箱」立场一起属于不承诺的领域，但**不能因此把「继承全环境」当成一种设计来学**——它正好是 codewhale 轮「子进程 env 白名单」要治的反面。
- **`reasonix doctor capabilities` 那套稳定错误码 + remediation + settings_tab 跳转**（`internal/frontend/capdiag/`）[转述]。gemini 轮 §8 已否决 `/doctor` 双可见性字段；我们的对应面是 `packages/desktop/src/main/diagnostics/` 与各错误码，不重开。
- **崩溃报告管线**（有界 10 份 + 正则脱敏 + 用户审核后 POST + Cloudflare D1 worker + 2/20、0/40 的根因数量门槛）[转述]。本仓桌面侧已有 Sentry 路径（`packages/desktop/src/renderer/startup/sentry.ts`、`src/main/native/logging.ts`），且他们自己承认 studio-host 不装 recover、Go panic 无报告。
- **npm 包装多平台 Go 二进制 + Android 把内核编成 `libreasonix.so`** [转述]。本仓是 Bun/TS 单二进制路线，且已有 `packages/process-daemon` 的 Rust 守护进程与三平台矩阵，另有一套本地发布规则（AGENTS.md「Local Release Builds：只出 Windows」）。

## 五、本轮实测对本仓的两处补充

1. **生成物漂移这一侧我们已经不缺**（对第 6、9 项的定调）：`check:generated` 是「重跑生成 + `git diff --exit-code`」，Linux 腿进 CI；`packages/protocol` 用 `--check` 自检；`packages/sdk/script/verify-package.ts` 还会打真实 tarball 校验 workspace 依赖是否已被替换。**所以 Reasonix 的「四方漂移锁」对我们不是增量**，真正的增量只在「外部契约（ACP）没有权威校验器」和「外部事实（价格）没有取证」两处，即第 6、7 项。
2. **三条已过期的 TODO 值得顺手核对**（AGENTS.md：代码与文档不一致时以代码为准，发现的人负责修）：`packages/core/src/tool/plugin/edit.ts:202-205`、`write.ts:41-44`、`file-mutation.ts:126-134` 都写着 "TODO: Add snapshots / undo after design exists."，但本仓的会话级回退**已经存在**（`packages/core/src/session/revert.ts` 的 stage/clear/commit、`Session.Info.revert` 列、`packages/tui/src/routes/session/dialog-message.tsx:37-38` 的 Revert 菜单、`snapshot.ts` 的 capture/files/diff/restore）。这三条要么指的是「工具内单文件 undo」这个仍未做的子集，要么就是没跟上代码。同一段里的 "TODO: Design multi-file transactions / rollback" 与本轮第 4 项是同一处未来项，"TODO: Publish watcher/file-edit events" 与第 1 项的「外部改动使观察过期」也是同一问题的两个入口——**如果做第 1 项，这三条 TODO 应当一起被改写**，否则下一个读到的人会以为什么都没有。

## 六、本轮未能升级为 [实测] 的项（动手前必须复核）

以下几条我只核到「文件/符号/错误码确在」，其**行为语义来自子agent或对手文档**，写成方案前需要逐行复核：

- `writeclaim/scheduler.go` 的 all-or-nothing 语义与 `workspacelease` 的跨会话 flock：我确认了 `CodeWritePathBusy`、`ReserveWrite`、`TryClaimWritePaths`、`conflictLocked`、`ActiveWriterClaims`、`NewSubagentScheduler(maxTotal, maxWriters)` 存在，没读冲突判定细节。
- `OpaqueWrite`「只有库和测试、无生产调用者」与 `PROCESS_ROOT_WAIT`「无生产消费者」：来自对手的 `*_SECURITY.md` 自述 + 子agent grep，我未亲验。这两条被我用来说明「他们也留半成品」，若要写进任何对外结论需复核。
- `checkpoint.go` 的 `CoverageGap`、hook 先写后拒的修复方式、`mutation/coordinator.go` 的 Effect 分类：全部 [转述]。第 10 项只依赖 README 的对外措辞（[实测]）与本仓代码（[实测]），不依赖这些。
- 价目 `pricecheck` 的 "unread ≠ agreed" 与不进 CI：[转述]。第 7 项的落点是本仓自己的脚本，不依赖它的细节。
- 他们 31 个内建工具、87 个 compat 轴位这类**计数**：均 [转述]，本文未引用为论据。
- `docs/AGENT_COMPOSITIONS.md` 的来源权限表：表格文字我亲读 [实测]，但**代码里是否真的强制**（`internal/state/sessionstore/composition*.go`）未核。第 2 项因此只搬规则不搬引擎，并在落点里要求先核 `mcp.ts` 与 `policy.ts`。

## 七、建议动手顺序

1. **第 1 项 + 第 4 项合做**（写落盘前的两道门：看过才准覆盖、本轮路径冲突即拒）——同一处代码、同一个 PR 序列、直接防用户数据丢失，且顺手改写第五节那三条 TODO。
2. **第 3 项**（破坏性目标全档位硬拒）——一处门 + 一个错误码。但要先由用户确认是否推翻 `doc/permissions.md` 里 "Full access 是唯一 escape hatch" 这条已写下的决定。
3. **第 6 项**（ACP 官方 schema conformance）——独立、小、当天可验。
4. **第 2 项**（来源不得扩权）——价值最高、影响面也最大，需要先把 `permission.ts` 规则结构与 `mcp.ts`/`policy.ts` 现状一次读干净再动。
5. **第 8 项**（预算收尾复用 max-steps 形状）——与 goose/codex 已立项项并轨，不另开里程碑。
6. **第 5 项**（语料双守卫）——与 gemini G4/L28 并轨；先有语料计划，守卫同批写。
7. **第 7、9、10 项**——各自独立，第 10 项先只做「把不能回退的原因说出去」那一半。

## 八、复核命令

```sh
# 对手规模与纪律计数（本文第一节）
cd /d/code/github/DeepSeek-Reasonix
git ls-files '*.go' | grep -v _test.go | xargs -n200 cat | wc -l   # 495260
git ls-files '*_test.go' | xargs -n200 cat | wc -l                 # 586889
ls docs/*.md | wc -l ; ls docs/*SECURITY*.md | wc -l               # 106 / 33
git ls-files benchmarks | wc -l                                    # 1461

# 第 1 项：观察门确实没有
cd /d/code/opencode
grep -n "withLock" packages/core/src/tool/plugin/*.ts              # edit/patch 有，write 无
grep -n "seen\|staleness\|mtime" packages/core/src/tool/plugin/read.ts   # 零命中

# 第 2 项：项目档确实排在用户档之后
grep -n "rank above" packages/core/src/config.ts
sed -n '83,104p' packages/core/src/config/plugin/agent.ts
grep -n "findLast" packages/core/src/permission.ts

# 第 3 项：升级门可被会话级 allow-all 清掉
grep -n "destructive\|escalation\|opt-out\|auto" doc/permissions.md

# 第 6 项：没有官方 schema 权威
grep -n "agent-client-protocol\|zed-industries" package.json packages/cli/package.json   # 零命中

# 第 10 项：回退的前提是 git
grep -n "not a Git repository\|vcs?.type" packages/core/src/snapshot.ts
```
