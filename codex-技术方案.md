# codex 借鉴技术方案

把 `codex-借鉴清单.md`（2026-10-30，第三轮 repo-mining）转成可执行方案。本文以**本地 `D:\code\github\codex` 仓库逐符号核对**为依据，修正了清单中来自子代理报告的误差；落地时以本文的符号为准，不要引用清单原文。

- 生成日期：2026-10-30。基线：`opencode` 分支 `loop-reliability-docs`，HEAD `419c10d165`。
- 核对方式：5 路并行只读核对（opencode 侧现状、codex P0、P1/P2、P3/P4/P5、P6/P7/TUI），清单第 2 节的六条实测事实全部复核成立。
- 本文只做方案，未改任何代码。每个里程碑独立成一个 PR 粒度，含测试与 doc 同步要求。

---

## 目录

1. 核对结论与清单修正
2. 路线图
3. M1 决策代数（P0 主体：fold + 危险分类器 + 回写护栏）
4. M2 流程闸门（P7：CI 与仓库卫生）
5. M3 注入身份与裁剪告示（P2 精简版）
6. M4 子 agent 树预算（P4 收窄版）
7. M5 prompt 分段 diff（P1，先出计划再动）
8. M6 工具表面预算与观测（P5/P6 选件）
9. M7 并发客户端与 TUI 小件（P3/附加）
10. 明确不做（更新版）

---

## 1. 核对结论与清单修正

### 1.1 全部确认的关键事实

- opencode `Permission.evaluate`（`packages/core/src/permission.ts`）用 `findLast` 最后匹配胜出、无命中回退 `ask`；`evaluateInput` 把 `savedRules()` 追加在末位，一次 always-allow 永久盖掉配置的 ask。**0 号洞（无 fail-closed）确认存在。**
- opencode 全仓无危险命令清单；`SECURITY.md` 明示 "No Sandbox"、权限系统只是 UX 不是安全隔离。
- codex `Decision` 四值派生 `Ord`（`execpolicy/src/decision.rs`，Allow < Prompt < PromptUser < Forbidden）；`policy.rs` 的 `Evaluation::from_matches` 用 `.max()` 最严者胜出；规则按首 token 精确建键、`PatternToken` 只有 `Single`/`Alts`，无通配符。
- codex 危险启发式仅在 `matched_rules.is_empty()` 且提供 `heuristics_fallback` 时合成 `HeuristicsRuleMatch`（`policy.rs` 的 `matches_for_command_with_options`）——清单"原样照搬会搬进别人的 bug"的判断成立。
- codex 侧 P1/P2/P5/P6 的主要符号（world_state、ContextualUserFragment、RetainedContext、GuardianBudgetOmission、TruncationPolicy、output-truncation、json_schema compaction、otel 双 target、RetryPolicy、responses_retry）逐条确认，见各里程碑内的引用。

### 1.2 必须按本文修正的条目

| # | 清单原文 | 核实结果 | 对方案的影响 |
| --- | --- | --- | --- |
| 1 | "SubagentTool 没有树预算，也没有深度上限" | **深度上限已存在**：`packages/core/src/tool/plugin/subagent.ts` 读 `experimental.subagent_depth`（默认 1，`packages/schema/src/config/experimental.ts`），超限报 "Subagent depth limit reached"。"notify" 是 `packages/core/src/session/subagent-job.ts` 的运行时行为，不是输入模式 | M4 收窄为：共享树预算 + 错误文案指导，不做深度上限 |
| 2 | `dangerous_command_forbidden_in_external_sandbox_when_policy_matches` 钉住 "allow 击穿危险判定" | 该测试（`core/src/exec_policy_tests.rs`）用的是 **prompt 规则**，钉的是"规则命中优先于启发式"；allow 击穿是结构事实（启发式仅在零命中时运行），未被该测试直接钉住 | 不影响 M1 设计，但引用时不要再说"被测试钉成预期行为" |
| 3 | execpolicy 约 2,983 行 / 13 文件 | 实测 12 文件共 **2,020 行**（parser.rs 473、policy.rs 412、amend.rs 342、rule.rs 306 等） | TS 首版 300–500 行的估算不变 |
| 4 | `MAX_DANGEROUS_COMMAND_WRAPPER_DEPTH = 8` 在 `core/src/exec_policy.rs` | 在 **`shell-command/src/command_safety/is_dangerous_command.rs`**；递归点是 sudo / env / trap / `bash -lc`，超限返回危险（fail-closed） | M1 分类器照此形状实现 |
| 5 | 全仓 `rm -rf` 仅命中 `environment/exec-defaults.ts` | 还有第二处远端实现：`packages/gui-plugins/src/ssh/remote-cli.ts` 的 `trap 'rm -rf "$stage"' EXIT` | "无危险清单"结论不变 |
| 6 | codex TUI 有 `scrollback.rs` 的 `ScrollbackStrategy{Standard, Zellij, FullScreen}` | **不存在**。实际是 `tui/src/insert_history.rs` 的 `InsertHistoryMode{Standard, FullScreen}`（Zellij 只是选 FullScreen 的原因之一） | M7 只借行为（定稿行写 scrollback），枚举名不要照抄 |
| 7 | `required-git-spec = "rev"` 等在 cargo config | 在 **`codex-rs/deny.toml` 的 `[sources]` 段** | M2 供应链项的落点描述 |
| 8 | `ResolvedModelMessages` 在 core | 在 **`prompts/src/model_messages.rs`**（prompts crate）；`is_guardian_context_message` / `is_user_authorization_message` 在 `core/src/context/contextual_user_message.rs`，不在 retained_context.rs | M5/M3 引用位置 |
| 9 | `daemon_recovery.rs` 在 app-server-daemon | 在 **`app-server-transport/src/daemon_recovery.rs`**（消费在 `app-server/src/daemon_thread_recovery.rs`） | M7 引用位置 |
| 10 | 序列化作用域 7 个变体、`ThreadClientCommand` | 共 **9 个变体**（多 `Process`、`FuzzyFileSearchSession`）；队列枚举名是 **`ThreadListenerCommand`**（`app-server/src/thread_state.rs`） | M7 引用位置 |
| 11 | `strip_personality_section` 等是通用 H1/H2 段删除 | 都是**按具名段删除**（`# Personality`；`## Planning`/`## update_plan` 等固定段名） | M5 的段改写按具名实现 |
| 12 | "我们的 `experimental.*` 只有开/关" | 已有非布尔值：`subagent_depth`（int）、`location_idle_timeout`、`policies`（已弃用） | P6 的 Feature 生命周期项降级为低价值 |
| 13 | codex `fence` 作全局 egress 代理 | 仅在 `blob-size-policy.yml` 一个 workflow 以 audit 模式使用 | M2 供应链项按实际范围描述 |
| 14 | `Decision::parse` 接受四值 | 只接受 `allow/prompt/forbidden` 三种字符串；**`prompt-user` 仅由 serde rename 出现**，策略文件写不出来 | M1 的 ask-user 同样保持内部合成、不可被用户规则书写 |

### 1.3 opencode 侧现状基线（M1 依赖的锚点）

- `Permission.Effect = "allow" | "deny" | "ask"`，`Rule = { action, resource, effect }`（`packages/schema/src/permission.ts`），无 justification、无示例校验。
- `Permission.evaluate(action, resource, ...rulesets)`：纯函数，`findLast` 胜出。调用点 4 处，全是"预过滤可见性"用途：`packages/core/src/skill.ts`、`packages/core/src/mcp/instructions.ts`（两处）、`packages/core/src/tool/plugin/subagent.ts`。
- 服务方法 `ask` / `assert` / `assertNotDenied`；`assert` 调用点遍布各工具（file-access、edit、write、patch、shell、grep、glob、webfetch、websearch、skill、question、mcp、mcp-resource、subagent、opencode、plugin/host）。
- shell 工具（`packages/core/src/tool/plugin/shell.ts`）：`action` 名是 **`shell`**；`ShellParse.scan`（`packages/core/src/shell/parse.ts`）产出逐语句 `commands: [{ resource, save }]` 与 `directories`，resource 是命令语句原文，save 是"命令头前缀 + ` *`"；`cd/pushd` 类进 directories 走 FileAccess，不经 shell 权限。
- `PermissionSaved`（`packages/core/src/permission/saved.ts`）按 projectID 存 `{ action, resource, time }` 于 SQLite；`reply({ reply: "always" })` 写入后对本批 pending 重新 `evaluateInput` 自动放行。
- CI 现状：`check.yml` 只有 lint + typecheck + `lint:changed`；`check-test.yml` 已跑 client/protocol 的 `check:generated`。**没有**架构边界检查、clean-worktree、blob-size、license 门、SBOM、依赖审计。
- `toSessionError`（`packages/core/src/session/to-session-error.ts`）已穷尽 12 个 `AIError` reason；P6 的错误分类项确认"我们不弱"。

---

## 2. 路线图

| 里程碑 | 内容 | 前置 | 运行时风险 | 规模 |
| --- | --- | --- | --- | --- |
| M1 | 决策代数：fold 语义 + 危险分类器 + 回写护栏（无 schema 变更） | 无 | 中（权限语义变化） | ~400 行核心 + 测试 |
| M2 | 流程闸门：边界检查 / clean-worktree / 聚合 required / blob-size | 无 | 零（纯 CI） | ~200 行脚本 |
| M3 | 决策代数补强：`justification`、`match`/`not_match` 加载期校验、basename 匹配 | M1 | 低（schema 增量） | ~150 行 |
| M4 | 子 agent 共享树预算 + 深度错误文案 | 无 | 低（实验开关） | ~150 行 |
| M5 | 注入文本身份标记 + 裁剪/压缩告示（P2 精简版） | 无 | 低 | ~200 行 |
| M6 | prompt 分段 diff（P1 WorldState） | 先出 `doc/records/` 计划 | 高（触及上下文装配） | 大，单独立项 |
| M7 | 工具表面预算 / 观测 / 并发 / TUI 选件 | 各节独立 | 低 | 按选件 |
| 不做 | OS 强制层、Starlark、协议重放倒退、文档外置、组织项 | — | — | — |

依赖关系：M1 → M3；M4、M5、M7 各项互相独立，可与 M1–M3 并行；M6 在 M5 之后（分段身份是它的地基）。

---

## 3. M1 决策代数（P0 主体）

目标：关掉 0 号洞——一条宽 allow 规则（如 `rm *` 或 saved 前缀）不再能让危险命令静默放行；已保存的 always-allow 不再能盖过反升级判定；审批回写不再累积出 `bash *` / `sudo *` 级别的常驻授权。

威胁模型以 `SECURITY.md` 为准：权限系统是 **UX 与防误操作层，不是安全隔离**。因此 M1 不追求对抗恶意进程（那是 codex host_executable 白名单要解的问题），只保证"模型/配置的组合失误会被兜住"。

### 3.1 决策格（新文件 `packages/core/src/permission/decision.ts`）

内部五级序，fold 取最严者。saved allow 占据独立一层，表达"能满足 ask、不能满足 ask-user"：

```ts
// 序：allow < saved-allow < ask < ask-user < deny
type DecisionEffect = "allow" | "saved-allow" | "ask" | "ask-user" | "deny"

interface Decision {
  effect: DecisionEffect
  rule?: Permission.Rule        // 胜出的规则（deny/ask 的理由来源）
  danger?: DangerousMatch       // 危险分类详情（ask-user 的理由来源）
}
```

- `fold(...decisions): Decision`：按上述序取 max；同序保留第一条命中。
- `ask-user` 仅由危险分类器与后续 M3 机制合成，**不可被用户规则书写**（对齐 codex `Decision::parse` 只收三值的设计意图，见核对修正 #14）。
- 对外暴露仍映射回 `Permission.Effect`：`saved-allow → allow`，`ask-user → ask`。`Request.metadata` 增加可选键 `decision: "ask-user"` 与 `reason`，让 TUI 能隐藏 "always" 按钮——不动 schema 字段，无协议变更。

### 3.2 fold 语义改造（`packages/core/src/permission.ts`）

`evaluate` 从 findLast 改为最严者胜出（对 4 个可见性调用点自动生效：任何位置一个 deny 即生效，不再被后面的 allow 覆盖）：

```ts
export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  const matches = rulesets.flat().filter(
    (rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource),
  )
  if (matches.length === 0) return { action, resource: "*", effect: "ask" }
  return matches.reduce((a, b) => (severity(b.effect) > severity(a.effect) ? b : a))
}
```

`evaluateInput` 改为：规则命中与危险分类**无条件同场 fold**（这是与 codex 的关键差异——codex 的启发式只在零命中时运行，allow 同样能击穿；我们不搬这个 bug）：

```ts
const results = input.resources.map((resource) => {
  const matched = evaluate(action, resource, rules, savedRules) // 最严者胜出
  const danger = DangerousShell.scan(resource)                  // 总是运行，与命中无关
  return danger ? fold(matched, { effect: "ask-user", danger }) : matched
})
const effect = results.some((r) => r.effect === "deny") ? "deny"
  : results.some((r) => r.effect === "ask" || r.effect === "ask-user") ? "ask"
  : "allow"
```

行为变化点（写进 CHANGELOG）：

- 配置里"后面的 allow 盖掉前面的 deny"从此失效（deny 胜出）。现有依赖此顺序的配置会开始被拦，这是本里程碑的**目的**而非回归。
- saved allow 仍能满足配置的 `ask`（`saved-allow < ask`），现有 always-allow 用户不受影响——除了命中危险分类的命令。
- 现有的 `denied()` 预检查（configured-only deny）被 fold 吸收，删除。

### 3.3 危险分类器（新文件 `packages/core/src/shell/dangerous.ts`）

形状取自 codex `shell-command/src/command_safety/is_dangerous_command.rs` + `bash.rs` 的两个解析器纪律，剪裁为单向使用：

```ts
interface DangerousMatch {
  kind: "destructive" | "escalation" | "unanalyzable-wrapper" | "other"
  detail: string            // 进入审批提示与 BlockedError.reason 的说明
}
function scan(statement: string): DangerousMatch | undefined
```

实现纪律（每条都是 codex 已验证的形状）：

1. **只升级，从不证明安全。** 返回 `undefined` 不代表命令安全；没有任何调用方可以把 `scan` 的结果当作放行依据。这是 codex `parse_shell_lc_literal_commands` 文档声明（"must not be used to prove that a command is safe"）的单向化——我们甚至不提供 plain/literal 两个解析器，只有危险探测一个入口。
2. **按语句、按词头匹配，不做子串匹配。** 输入单位与 `ShellParse.scan` 的 `resource` 相同（单条语句）。`echo "rm -rf"`、`grep -r pattern` 不得命中；`rm -rf /`、`sudo rm -rf x` 命中。
3. **包装递归上限 fail-closed。** `sudo` / `env` / `nohup` / 解释器 `-c` 包装逐层深入，`MAX_WRAPPER_DEPTH = 8`，超限返回 `{ kind: "unanalyzable-wrapper" }`——对齐 codex 同名常量语义（核对修正 #4）。
4. **双方言联合词表。** bash/POSIX 词表与 PowerShell 词表对每条语句**同时**匹配（`Remove-Item -Recurse -Force`、`Set-ExecutionPolicy`、`Invoke-Expression` 等不会出现在 bash 命令里，反之亦然，联合匹配安全），免去把 shell 类型一路传进 permission 层的管道。这是对 codex `ExecPolicyCommandOrigin` 三分派的刻意简化，理由：opencode 的权限层不是安全边界，误匹配的代价是"多问一次"，漏匹配的代价是静默放行。
5. **词表是数据。** 一份导出的常量表（词头 → kind），首版从 codex 危险启发式的稳定子集抄录：`rm`（携带 `-r` 与危险目标）、`sudo`、`dd of=/dev/…`、`mkfs*`、`shutdown`、管道入 shell（`curl … | sh`）、fork bomb 形状、`chmod -R 777 /`、`git push --force`（远端主保护分支语义可后补）、PowerShell 侧 `Remove-Item -Recurse`、`Format-Volume`、`Set-ExecutionPolicy`。**误报预算是硬约束**：每个词头必须有对应的"不命中"反例测试。

### 3.4 回写护栏（`reply("always")` 路径）

两道闸，都在写 `PermissionSaved` 之前：

1. **banned 前缀过滤**（`packages/core/src/tool/plugin/shell.ts` 的 `prepare`）：`ShellParse.scan` 产出的 `save` 候选，词头命中 `BANNED_SAVE_PREFIXES` 的直接剔除（剔除后为空则不提交 `save`，"always" 退化为 once）。词表取 codex `BANNED_PREFIX_SUGGESTIONS`（`core/src/exec_policy.rs`，约 90 条）的适用子集：`sh/bash/zsh/dash/ksh/fish`（裸、`-c`、`-lc`）、`node/nodejs/bun/deno`（`-e`/`eval`/`run`）、`python/python3/pypy`（`-c`）、`perl/ruby/php/lua/julia/Rscript`、`cmd/cmd.exe`（`/c`、`/k`）、`powershell/powershell.exe/pwsh`（`-Command`、`-EncodedCommand`、`-c`、`-e`、`-File`）、`npm run/pnpm run/yarn run`、`sudo`、`env`、`rm`、`git`、`osascript`。注意 `git` 在列——"always allow git status" 不再持久化，这是 codex 已上线的行为，接受这个换来的不累积性；词表是单点常量，后续可调。
2. **ask-user 不落盘**（`packages/core/src/permission.ts` 的 `reply`）：request 的 `metadata.decision === "ask-user"` 时忽略 `reply: "always"` 的 save 请求（仍然放行本次）。同时本批 pending 的自动放行循环（对同 session 其余 pending 重算 `evaluateInput`）保持不变——危险分类会让真正危险的兄弟请求继续挂起，正确。

不做 codex 的 `proposed_execpolicy_amendment`（从批准命令派生结构化规则写回策略文件）：opencode 的 save 前缀本身已是"派生规则"，缺的只是上面两道闸；派生式写回引入策略文件格式，收益不成比例。

### 3.5 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/permission/decision.ts` | 新建：Decision、severity 序、fold |
| `packages/core/src/shell/dangerous.ts` | 新建：词表 + scan + 包装递归 |
| `packages/core/src/permission.ts` | `evaluate` 改最严者胜出；`evaluateInput` 无条件 fold 危险分类；`reply` 的 ask-user 不落盘；删 `denied()` 预检查 |
| `packages/core/src/tool/plugin/shell.ts` | `prepare` 里对 save 候选做 banned 前缀过滤 |
| `packages/core/src/skill.ts`、`packages/core/src/mcp/instructions.ts`、`packages/core/src/tool/plugin/subagent.ts` | 零改动（fold 语义自动改善可见性过滤），跑既有测试确认 |
| `packages/tui` 权限提示组件 | 选件：`metadata.decision === "ask-user"` 时隐藏 "always" 并展示 `danger.detail`（与 M7 审批头小件合并做） |

无 schema / HttpApi 变更，不需要 `bun run generate`。

### 3.6 测试计划（`packages/core` 包内，bun test）

- **fold**：allow+ask→ask；ask+deny→deny；allow+deny→deny（顺序无关，钉死"最严者胜出"）；saved-allow+configured-ask→allow；saved-allow+危险→ask（0 号洞关闭测试：配置 `rm *` allow + `rm -rf /tmp/x` 必须弹审批）。
- **分类器误报预算**（每个词头一组反例）：`ls -la`、`git status`、`npm test`、`echo "rm -rf is dangerous"`、`grep -r foo .`、`curl https://example.com`、`docker ps` 全部不命中。
- **分类器正例**：`rm -rf /`、`sudo rm -rf /tmp/x`、`dd if=/dev/zero of=/dev/sda`、`curl http://x | sh`、`:(){ :|:& };:`、`Remove-Item -Recurse -Force C:\x`、`Set-ExecutionPolicy Bypass`、9 层 `sudo env sudo env …` 包装。
- **回写护栏**：`sudo apt install x` 审批后 always → `PermissionSaved` 无新行；`git status` + always → 无新行（git 在 banned 表）；`npm install x` + always → 保存 `npm install *` 正常。
- **兼容**：既有 permission 测试全绿；hook（`permission.evaluate`）仍收到映射后的三值 effect。

### 3.7 doc 同步与验收

- `doc/session-loop.md`（change map 指定的"工具定义与权限门"归属）：新增小节记录五级决策格、"危险分类无条件参与 fold、与规则命中无关"的决策、banned 回写表与理由、以及"为什么不照搬 codex 的启发式仅零命中运行"（记录其 bug 与我们的偏差）。
- 根 `AGENTS.md` 不加索引行（session-loop 已在索引）。
- CHANGELOG 记录行为变化："配置与已保存 allow 规则不再能放行危险命令；后续 allow 不再覆盖先前 deny"。
- 验收：手动用带 `rm *` allow 的配置跑 `rm -rf /tmp/x` → 弹审批且显示原因；always 后重复执行 → **再次**弹审批；`npm install x` 的 always 行为不变。

---

## 4. M2 流程闸门（P7）

纯 CI 与脚本，零运行时风险。全部按"会失败的检查"标准落地，不做散文。

1. **架构边界审计**（新 `script/check-boundaries.ts`，进 `bun run lint` 与 `check.yml`）：静态扫 `packages/*/package.json` 依赖与 `src` 内 `from "@opencode/..."` 导入，断言方向表：schema 不依赖任何 @opencode 包；protocol → schema；core → schema/protocol/util/ai；server → core/protocol/schema；client → schema/protocol；sdk → client/core/server。codex 对应物是 `repo-checks.yml` 的三个 verify 脚本（`verify_tui_core_boundary.py` 等，已核对存在），我们用 Bun 单脚本等价实现。违规即红，替代"靠人读 AGENTS.md"。
2. **clean-worktree 终检**：`check.yml` 与 `check-test.yml` 末尾追加一步（`if: always()`）`git status --porcelain` 非空即失败。codex 形状：`.github/actions/check-clean-worktree/action.yml` 复合 action，8 个 workflow 复用。这一步把 `bun run generate` / doc 生成物的漂移从"review 时人眼发现"变成"PR 变红"。
3. **聚合 required job**（新 `.github/workflows/blocking.yml`）：`required` job 用 `if: always()` + `needs` 全部检查 job，任何非 success（含 skipped/cancelled）判失败。codex 用 `.github/scripts/check_ci_results.py` 读 `toJSON(needs)`，注释明确"没有 always() 时依赖失败会 skip 导致 required 假绿"——直接照搬这个理由到我们的 workflow 注释里。分支保护只挂这一个具名检查。
4. **blob-size 上限**（新 `script/check-blob-size.ts` + `.github/blob-size-allowlist.txt`）：默认 500 KiB、CI 传 512000（对齐 codex `check_blob_size.py` 的双轨），allowlist 精确路径、`#` 注释，防二进制膨胀。
5. **lint 配置当样式指南**：在 oxlint/ast-grep 规则里落第一批"带理由的禁用"，每条注明移除条件（对齐 codex `deny.toml` wrappers 棘轮与 `clippy.toml` disallowed-method 的形状）。首批两条：禁裸 `JSON.parse` 于 untrusted 输入（AGENTS.md 已有此约定，升级为可失败检查）；禁直接调用 `tsc`（AGENTS.md 已有 `bun typecheck` 约定）。
6. **测试确定性**：提供 `skipIfNoNetwork()` 测试助手（探测沙箱网络环境变量即跳过，对齐 codex `core/tests/common/lib.rs` 同名宏）；对起子进程的测试组标注串行执行约定写进 `.opencode/skills/unit-tests`。
7. **供应链**：21 个 workflow 的 Actions 全部改 SHA 固定并保留版本注释（codex 形状：`actions/checkout@<sha> # v6.0.2`）；新增 `.github/dependabot.yaml`（bun + github-actions 两生态起步，`cooldown: default-days: 7`）。依赖审计与 license 门先调研 `bun audit` 可用性再定，不在本里程碑承诺。

验收：人为制造一次越界 import、一次生成物漂移、一个 >512KB 文件，三个 PR 各自变红。

---

## 5. M3 决策代数补强（P0 后半，schema 增量）

前置 M1。三项相互独立，可拆 PR：

1. **`justification`**（`packages/schema/src/permission.ts` 的 `Rule` 加 `Schema.optionalKey(Schema.String)`）：deny 规则的理由进 `BlockedError.reason` 与审批提示（codex 语义：任意 decision 可挂；`forbidden` 建议写替代方案——文档约定即可，不做代码强制，codex 自己也没强制）。涉及 agent 配置 schema 的 doc 注释；若 Rule 面出现在 HttpApi，按 AGENTS.md 从 `packages/client` 跑 `bun run generate`。
2. **`match` / `not_match` 加载期校验**：`Rule` 加可选示例数组，agent 配置加载（Agent 服务 resolve ruleset 的归一化点）时验证：`match` 示例必须被该 ruleset 至少一条规则命中、`not_match` 示例必须零命中，违例配置直接报错。对齐 codex `validate_pending_examples_from` → `validate_match_examples` / `validate_not_match_examples` 的形状（规则自带单测）。
3. **basename 匹配**：`evaluate` 对 `shell` action 的 resource 抽取命令头，若是绝对路径（POSIX `/…`、Windows 盘符）则按 basename（去 `.exe/.cmd/.bat/.com`、win32 小写）追加一次规则匹配，使 `git *` 规则对 `/usr/bin/git status` 与 `C:\Program Files\Git\bin\git.exe status` 同样生效。**与 codex 的刻意差异**：codex 用 `host_executable(name, paths)` 白名单约束 basename 回退（因为它是安全属性），我们不设白名单（权限层不是安全边界，见 M1 威胁模型），危险分类器照常对全文无条件运行兜底。此差异写进 doc。

---

## 6. M4 子 agent 树预算（P4 收窄版）

核对修正 #1：深度上限已存在（`experimental.subagent_depth`，默认 1），缺的是**树预算**与错误指导。

1. **配置**：`experimental.subagent_budget`（`packages/schema/src/config/experimental.ts`，可选 NonNegativeInt，默认不设 = 不启用）。
2. **记账**：不加 durable 事件——树用量可从既有投影导出（子会话带 parentID，逐消息 token 已存）。提供树用量查询：从根会话沿 spawn 边汇总全部后代消息 token（对齐 codex `rollout_budget.rs` 的"一个根线程会话树共享记账"，但用读时聚合替代其增量记录，符合本仓"durable 事件只记不可约新事实"的纪律）。
3. **执行点**：`packages/core/src/session/subagent-job.ts` 投递与 child step 边界各查一次；超限让 child step 以错误收束，错误语直接教模型下一步（codex 文案已核对：`"Agent depth limit reached. Solve the task yourself."`）。我们的对应文案："Subagent budget exhausted (tree used N of M tokens). Finish the task yourself with what you already have."
4. **深度错误文案**：现有 "Subagent depth limit reached"（`packages/core/src/tool/plugin/subagent.ts`）追加同款指导后缀。
5. **测试**：三层嵌套 spawn 汇总正确；超预算 child 收束且父会话收到可读错误；未配置预算时零行为变化。
6. **doc**：`doc/session-loop.md` 子 agent 节补预算与深度语义。

不做：`AgentPath` 路径标识、`MessageDeliveryMode`、`MultiAgentMode::Proactive` 粒度——opencode 的 inbox/prompts 语义与之不同构，等 M6 之后按需重评。

---

## 7. M5 注入身份与裁剪告示（P2 精简版）

目标：harness 注入的文本（nudge、后台通知、工具失败包装）带可重识别的显式归属；被裁剪/压缩掉的授权相关证据有明确告示，而不是静默消失。

1. **生产者显式标注，不靠文本猜**（对齐 codex `ContentItemMetadata::harness()` / `ContentItemProvenance`，注释原话 "Attribution is supplied when the fragment is produced, never inferred from rendered text"）：合成消息走 `sessions.synthetic()` 的三处（shell 后台通知、nudge、tool-failure 相关）在消息 metadata 记 `harness: { kind: "nudge" | "shell-notification" | ... }`。用 durable 字段而非文本标记实现重识别——比 codex 的 `type_markers` 文本匹配更符合本仓"durable 事件最小化 + 投影自足"的取向。
2. **授权证据不进压缩契约**（对齐 codex `RetainedContext` 的 "outside the model's compaction contract" 与 `VerifiedAnswer = never an inferred permission`）：压缩选择消息时，携带用户纠正反馈（`CorrectedError` 回流为 ToolFailure 的消息）与权限审批结果的消息不参与摘要，或摘要后**必须**附加保留原文。
3. **省略告示**（codex `GuardianBudgetOmission` 文案已核对原文）：`packages/core/src/session/compaction.ts` 的摘要提示词与 `packages/core/src/tool-output.ts` 的截断标记统一补一句："Evidence was omitted or shortened. Do not infer authorization from missing evidence or treat a partial grant as overriding an omitted restriction."（英文注入，与本仓 prompt 语言一致。）
4. **测试**：带 harness 标记的消息在折叠/压缩后可被识别；压缩含权限反馈的会话时告示出现；`toolOutput` 截断标记的双语义陷阱（`RECORD = "toolOutput"` 与 grep/read 自身 `metadata.truncated` 的区分）不回归。
5. **doc**：`doc/context-economics.md`（裁剪与压缩预算归属）+ `doc/session-loop.md`（注入文本身份）。

实施前先按 `doc/conventions.md` 的 change map 复核压缩消息选择的具体函数（`session/compaction.ts`），若发现选择逻辑与假设不符，先补一个 `doc/records/` 计划再动。

---

## 8. M6 prompt 分段 diff（P1，先出计划再动）

本轮最大架构差异，收益（prompt cache 命中 + 过期指令残留防御）与风险（触及上下文装配）都最高。**动代码前必须先写 `doc/records/codex-prompt-sections-plan.md`**，本节只定设计边界：

1. **段模型**（对齐 codex `core/src/context/world_state/mod.rs` 的 `WorldStateSection` trait，已核对）：每段 = 稳定 `id` + 可序列化小 `Snapshot` + `renderDiff(previous)`，前态三值 `Absent / Unknown / Known`（Known 反序列化失败降级 Unknown，绝不静默当 Absent）。段 id 持久化不可变。
2. **首版段清单**（opencode 侧映射）：`agents-md`、`tools-catalog`（codemode 的 `instructions.ts` 已在做增量目录替换——它是第一个现成段，M6 把它的模式泛化）、`permissions-summary`、`model-info`、`todo-state`。每段自渲染"不再适用"的移除消息。
3. **放置**：`Placement::{Prefix, Standalone, Mergeable}` 与 `split_prefix_updates`（稳定内容进可缓存前缀，增量走 delta）。
4. **哈希**：规范化 JSON（对象键排序）+ SHA-1 得 `WorldStateHash`；不做 RFC 7386 merge patch（codex 用它合并补丁消息，我们首版只做段级整体替换，复杂度后置）。
5. **AGENTS.md 处理对照**（codex `agents_md.rs` 已核对）：root marker（`.git`）定位、`AGENTS.override.md` > `AGENTS.md`、32 KiB 截断告警、**优先级冲突讲给模型听**（models-manager/prompt.md 原文"更深嵌套优先、直接指令优先于 AGENTS.md"）——第 4 点是 opencode 目前完全没有的行为，可独立先做（小）。
6. **不做**：`ResolvedModelMessages` 目录覆盖机制（opencode 的 prompt 不按模型族分发）、git 状态入 prompt（codex 刻意不进 prompt，`turn_metadata.rs::git_workspaces` 只进请求元数据——保持一致）。

---

## 9. M7 并发客户端与 TUI 小件（选件，各自独立）

**P3 并发编排**——核对后确认 opencode 的大半已有：pending 审批可经 `Permission.list/forSession` + `Permission.Event.Replied` 广播重放与解析通知，durable 事件 + 投影折叠在 resync 上强于 codex（无 protocolVersion/seq，清单第 4 节判定正确）。仅两件小活：

1. 验证 TUI/桌面断线重连路径确实拉取 pending 权限列表并订阅事件；缺则补（预期是客户端侧小改）。
2. 守护进程"该重载哪些线程"快照（codex `RecoverySnapshot { loaded, interrupted }` 消费即删，`shutdownGraceSeconds` 0–300 默认 60，已核对位置在 `app-server-transport/src/daemon_recovery.rs`）：与 opencode 既有 write-ahead execution claim 互补——claim 恢复执行权，快照补"恢复清单"维度。挂到 desktop 服务后继版本，不进本路线图硬性范围。

**P5 工具表面预算**——opencode 已有 head+tail 裁剪与 codemode 目录预算，选两件：

1. **MCP 工具 schema 压缩**（新 `packages/core/src/tool/schema-compact.ts`）：超预算（默认 5,000 字节，对齐 codex `DEFAULT_COMPACT_TOOL_SCHEMA_BYTES`）的 input schema 走四级递进 lossy 压缩：去 description → 删本地 `$defs`（先改写 `$ref`）→ 深层对象折叠（深度 ≥ 3）→ 删 composition 键，逐级测字节直到落入预算。测试钉住压缩后 schema 仍可被模型产出合法调用。
2. **截断警告带原始量**：`tool-output.ts` 的截断标记补原始行数/字节数（codex 文案 `Warning: truncated output (original token count: N)` 已核对，含 20% 序列化余量的 `with_serialization_allowance` 思路一并吸收进预算计算）。
3. 不做 `tool_search`/`ToolExposure::Deferred`（codemode 目录 + `INLINE_BUDGET` + `catalog.search` 已覆盖同需求）与每模型 `TruncationPolicy`（现配置面已够）。

**P6 观测**——两件：

1. **错误上下文传播**：`packages/ai` 层把 `x-request-id` / `cf-ray` / 服务端 `Retry-After` 提进错误串（codex `response-debug-context` crate 形状：提取为结构、展示分离；`responses_retry.rs` 的"服务端 RetryAfter 永远压过本地退避"语义核对无误）。实施前先复核 `packages/ai` 现有重试路径，若 retry-after 已透传则只补 header 提取。
2. **每工具耗时的 durable 化 + 三态关键路径**：确认工具 part 是否已带起止时间，缺则补 metadata；`TurnCriticalPath::{Disabled, Incomplete, Complete}` 的"宁标 Incomplete 不编 0"纪律照搬进 `script/session-efficiency.ts` 的产品内等价物。`log_only`/`trace_safe` 双 target：等 OTLP 导出有真实消费者再立项。
3. 不做 Feature 生命周期（核对修正 #12：`experimental.*` 已非纯开关，价值不足）。

**TUI 小件**——codex 已核对的三件便宜的：

1. **审批头**：权限提示展示 `Reason:`（斜体）、命中的 `Permission rule:` 原文、以及 ask-user 时的影响范围说明（"已保存的允许不适用于此命令"）——与 M1 的 metadata.decision 联动，信任收益最高（codex `bottom_pane/approval_overlay.rs::build_header` 形状）。
2. **OSC 8 链接目标与几何分离 + URL token 不参与折行**（`terminal_hyperlinks.rs` / `wrapping.rs::adaptive_wrap_line`）：与 TUI 现有裁剪/换行工作直接相关。
3. **输入边界隔离**：安全提示/选择前 `discard_pending_terminal_input()`（`tui/tui/input_boundary.rs`，已核对路径），丢弃待发输入防泄漏。
4. 评估而非照搬：定稿行写终端 scrollback（`insert_history.rs`，`InsertHistoryMode{Standard, FullScreen}`——**没有** ScrollbackStrategy，见核对修正 #6）。OpenTUI 是全量树渲染，迁移是架构分叉，仅在 M6 之后作为独立课题评估。`AdaptiveChunkingPolicy` 双阈值（队列深度 8 / 最老行龄 120ms）与 `resize_reflow_cap` 按终端设上限（VS Code 1000 / WezTerm 3500 / WT 9001 / Alacritty 10000）随该课题一起评。
5. 直接搬纪律：`terminal-detection` "只读环境变量、绝不执行不可信 PATH 选中的 helper" 的 crate 级注释与结构（已核对原文），以及 `terminal_probe` 的 250ms 探测上界 + 已消费字节回放。

---

## 10. 明确不做（更新版）

沿用清单第 4 节，按核对结果增删：

| 项 | 理由 |
| --- | --- |
| OS 强制层（network-proxy / windows-sandbox-rs / sandboxing / linux-sandbox 等） | 单栈 8.6k–34.5k 行 OS 专属，与 `SECURITY.md` 立场冲突。只借策略形状（M1/M3 已覆盖） |
| Starlark 策略 DSL | Effect Schema + 现有 config 分层足够；`match`/`not_match` 加载期自检那一半在 M3 落地 |
| "启发式仅在零规则命中时运行" | codex 自己的洞，M1 刻意反向设计（无条件 fold） |
| 无 protocolVersion / 无 seq 重放的协议形状 | opencode durable 事件 + 投影更强，不倒退 |
| 文档外置、组织选择项 | 保持"我们领先"判定不变 |
| codex `proposed_execpolicy_amendment` 派生式写回 | save 前缀已同构，加两道闸（M1 §3.4）即可，策略文件格式收益不成比例 |
| `AgentPath` / `MessageDeliveryMode` / `MultiAgentMode::Proactive` | 与 opencode inbox/prompts 语义不同构，M6 后按需重评 |
| `ResolvedModelMessages` 目录覆盖、RFC 7386 merge patch | 首版 WorldState 不需要，复杂度后置 |
| `tool_search` / 每模型 `TruncationPolicy` / Feature 生命周期 | codemode 目录、现有配置面、现有 typed config 已覆盖 |
| `log_only`/`trace_safe` 双 target | OTLP 导出尚无真实消费者，推迟 |

---

## 附：与清单第 7 节（ADM/kimi 关系）的衔接

- ADM backlog 第 0 项（权限 fail-closed）：本方案 M1+M3 是它的完整落地，形状取 codex 但修掉其 allow 击穿洞。
- ADM 第 2/3 项、kimi 第 1 项：已在 `loop-reliability-docs` 落地（`estimateWide`、`measuredPrompt`、head+tail、`MAX_NUDGES`/`STALL_LIMIT`），核对确认无遗留。
- kimi 第 2 项（dangerous/unanalyzable 分类插在 deny 与 allow 之间、opaque 从 fail 改 ask）：M1 的五级格以更细的形状覆盖（ask-user 层），落地时顺手把 `shell/parse.ts` 的 opaque 语义并入分类器决策。
- kimi 第 3 项（工具重复熔断）：codex 侧确认也无此机制，维持"两家都缺、我们有半成品（STALL_LIMIT）"的判定，不在本路线图。
- 本轮独有增量：M5（注入身份）、M6（分段 diff）、M7 的重放/快照小件——ADM 与 kimi 均未提供，按 §2 顺序排期。
