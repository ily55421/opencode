# goose 借鉴技术方案（第 5 轮）

> 分析对象：`D:\code\github\goose`（goose `1.57.0`，aaif-goose / Linux Foundation AAIF；Rust workspace 15 crate + Electron 桌面端 + Docusaurus 文档站）。
> 我方基线：工作树 `loop-reliability-docs`，`2.2.0-fork.10`。前四轮对象：codex / kimi / ZCode / adm（见 `优势对比清单.md`）。
>
> **证据分级**：`实测` = 本轮我在我方树上跑命令核对；`对方实测` = 本轮针对 goose 仓库读码核对（7 个子系统分头读，承重符号逐个 grep 复核）；`UNVERIFIED` = 搜索范围不足以断言。
> 引用一律 `路径` + `符号名`，不写行号（纪律见 `doc/conventions.md`）。
>
> **本轮只做增量**：我方已有等价物的不推荐、前四轮已否决的不换皮重提。每项落地建议都标注了与既有否决记录的相撞检查。

## 1. 先纠正四个想当然（对方实测）

| 想当然 | 实测结果 | 证据 |
| --- | --- | --- |
| goose 有 lead/worker 多模型分工 | **已删除**。现行的多模型 = 会话内 `/model` 热切换 + 子代理独立 provider/model | git 提交 `6435e1a85` "Remove lead/worker provider (#7989)"、`0e743112e` 移除文档；现行载体 `crates/goose/src/agents/subagent_task_config.rs` 的 `TaskConfig` |
| goose 是 ratatui 全屏 TUI，我们要学布局 | **不是**。`crates/goose-cli/Cargo.toml` 无 ratatui/crossterm；现行是 rustyline + cliclack + bat 的**行式 REPL**（渲染完滚出 scrollback） | `crates/goose-cli/src/session/mod.rs` 的 `CliSession::run_interactive`、`session/output.rs` |
| goose 的大工具输出落盘值得抄 | **我方已有等价物**，且我方口径更紧 | goose `crates/goose/src/agents/large_response_handler.rs` 的 `DEFAULT_LARGE_TEXT_THRESHOLD = 200_000` 字符（只溢写不内联截断）≈ 我方 `packages/core/src/tool-output.ts` 的 `truncate`（`MAX_LINES=2_000`/`MAX_BYTES=50*1024` + `RETENTION=Duration.days(7)`）【实测】 |
| goose 有 OS 级沙箱 | **没有**。全仓无 seatbelt/seccomp/firejail/landlock；Docker 只隔离扩展执行环境，不强制沙箱 shell 工具 | `crates/goose/src/agents/container.rs` 的 `Container` + `extension_manager/stdio.rs` 的 `docker_exec` |

一个正面事实：goose 的评测台账（`evals/harbor/README.md`）把 **opencode 当对照组**，README 顶部内嵌历史结果快照，其中一行 `opencode-sonnet46-full 52.8%`——我们是别人评测里的 benchmark 对象。

## 2. 一句话结论

goose 与我方工程重心几乎完全同轴（会话持久化、审批安全、循环可靠性、上下文经济学），但它把我方几件「**有机制、没闭环**」的事做成了闭环：幻觉工具自愈、审批记忆的粒度与方向、子代理的持久化纪律、MCP 子进程卫生。另有整块**空白区**（recipes + cron 定时任务）是它有、我方全无的最大面积。需要防两处与我方否决记录相撞的设计，都在 §6 标明。

## 3. P0：低成本、本轮已核实我方确实没有

### 3.1 工具 schema 归一化——「工具表面预算」的最便宜第一步

- **goose**（对方实测）：`crates/goose/src/agents/tool_schema_normalize.rs` 的 `collapse_const_unions`——把 schemars 生成的 `$ref → $defs → oneOf(string const...)` 膨胀 schema 折叠成 `{type:"string", enum:[...]}`，合并各 variant 描述；实现非常谨慎：尊重 `$schema` 方言（draft-04 的 `const` 语义不同）、不碰 `default/examples`、不碰带 `$id/$anchor` 的 def、nullable `anyOf` 不折叠。原报告估算约 9 倍 token 节省，且 Moonshot 等严格校验器不再拒绝。
- **我方**（实测）：`packages/core/src/tool.ts` 的 `snapshot` 只按权限过滤工具面，schema 逐条全发；未见等价归一化。
- **落点**：schema 序列化进请求的地方（`packages/ai` 协议层或 `packages/core/src/session/model-request.ts`）。**先做一件事**：实测我方 zod → JSON Schema 产物里 `oneOf`/`const` 的占比，确认同病再动手。
- 归属：codex 清单 P5「工具表面预算」的第一步，比 `tool_search`/BM25 便宜一个数量级。

### 3.2 幻觉工具三件套——把「Unknown tool」变成一次自纠

- **goose**（对方实测）：
  1. 只执行「确实在本轮 advertise 给模型」的工具（消息 metadata 记 `ADVERTISED_TOOLS_NOTE` 比对，防跨轮幻影）；
  2. `recover_mangled_tool_name`（`ops_llm.rs`）把模型常见的改名错误（`developer.shell`、`functions.x`）修复回正名；
  3. 兜底响应打 `UNCLAIMED_TOOL_ERROR` metadata，下一次推理前 `enrich_unclaimed_tool_errors` 把**当前可用工具清单**追加进该错误响应，让模型自我纠正。
- **我方**（实测）：幻觉工具名会得到 `Unknown tool: ${name}` 错误（`packages/core/src/session/runner/publish-llm-event.ts` 对该文案有专门处理），但 grep 全树无 mangled-name 修复、无「下轮附加可用工具清单」；`packages/core/src/session/model-request.ts` 的 `Prepared.executeTool` 已限定在「本请求 advertise 的工具」上执行——三件套我们已有 1/3 的地基。
- **落点**：`publish-llm-event.ts` 附近的 Unknown tool 分支 + 下一步请求组装处。

### 3.3 空响应重试

- **goose**（对方实测）：`crates/goose-agent/src/inference.rs` 的 `MAX_EMPTY_RESPONSE_RETRIES = 3`——全空输出且上一轮无成功 tool response 时就地重试；仍空则写入一条**隐藏**的 `EMPTY_RESPONSE_MESSAGE` 标记消息保持历史完整。
- **我方**（实测）：`packages/core/src/session` 内 `empty response` 零命中。空响应当前行为 UNVERIFIED（可能靠通用的 step 重试覆盖，值得先确认再决定是否值得做）。

### 3.4 Windows 进程树治理——我们天天在 Windows 上跑

- **goose**（对方实测）：`crates/goose/src/agents/platform_extensions/developer/shell_process.rs` 的 `ProcessTree`（Windows 分支）——`CREATE_SUSPENDED` 启动 → `AssignProcessToJobObject`（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）→ `NtResumeProcess`；终止 `TerminateJobObject` 杀整棵树。配套 `crates/goose/src/subprocess.rs` 给所有子进程加 `CREATE_NO_WINDOW`。
- **我方**（实测）：`packages/util/src/cross-spawn-spawner.ts` 用 `taskkill /pid ${proc.pid} /T /F`。taskkill /T 有已知盲区：孙进程脱离、PID 复用竞态、树枚举瞬时不一致。Job Object 的 kill-on-close 是内核级保证，孙进程逃不掉。
- **落点**：`cross-spawn-spawner.ts` 的 Windows kill 路径（或 shell 工具的进程管理层）。这是对上游行为的行为级改动，需要单独验证关停时序。

### 3.5 MCP 子进程卫生三小件

- **goose**（对方实测）：
  1. `crates/goose/src/agents/extension.rs` 的 `Envs::DISALLOWED_KEYS`（31 键）——`PATH`、`LD_PRELOAD`、`DYLD_INSERT_LIBRARIES`、`PYTHONPATH`、`NODE_OPTIONS` 等注入向量一律不传给 MCP 子进程；
  2. `extension_malware_check.rs` 的 `deny_if_malicious_cmd_args`——启动 `npx`/`uvx` 前查 OSV 公告（命中 `MAL-*` 拒启，fail-open）；
  3. `subprocess.rs`——Unix `process_group(0)`（Ctrl+C 不误杀）+ Linux `PR_SET_PDEATHSIG` + Windows `CREATE_NO_WINDOW`。
- **我方**（实测）：`packages/core/src/mcp` 内 grep 无 env 黑名单、无 OSV；spawn 细节 UNVERIFIED。
- **落点**：`packages/core/src/mcp/stdio.ts`。OSV 查询要考虑离线 fail-open 语义（goose 也是 fail-open，只拦已知恶意）。

### 3.6 prompt cache 确定性纪律（先复核，再立规矩）

- **goose**（对方实测）三条具体实践：
  1. 系统提示里的时间戳**截断到小时**（`crates/goose/src/agents/prompt_manager.rs` 的 `current_date_timestamp` 格式 `%Y-%m-%d %H:00`），注释明说是为了多会话 cache 命中；
  2. 工具与扩展**按名字稳定排序**（`crates/goose/src/agents/reply_parts.rs` 的 `prepare_inference_tools`，注释 "Stable tool ordering is important for multi session prompt caching"）；
  3. turn context 块**turn 内字节级稳定且持久化复用**（`moim.rs` 的 `turn_context_event`，测试 `turn_context_bytes_are_stable_for_a_turn`）。
- **我方**（实测）：`packages/core/src/session/model-request.ts` 内无 `Date.now`/`toISOString`，但未做专项核对——系统提示是否注入分钟级时间、工具序是否跨请求稳定、是否有任何 per-request 变化字节进入前缀。**建议**：立一条可测试的纪律（同 turn 内两次请求的前缀字节必须一致），写进 `doc/context-economics.md` 的 `Decisions`。

## 4. P1：机制清晰、需要设计

### 4.1 子代理收口五件套——直接补 codex 清单 P4 的「树预算/深度上限」缺口

- **goose**（对方实测）：
  1. **嵌套委托硬阻断**：`SessionType::SubAgent` 检查，"Delegated tasks cannot spawn further delegations"；
  2. **并发上限**：`crates/goose-agent/src/subagent.rs` 默认 `GOOSE_MAX_CONCURRENT_SUBAGENTS = 5`（`state_machine_builder.rs` 读参）；
  3. **持久化子会话**：子代理是 `SessionType::SubAgent` 的完整会话 + `parent_session_id`，可 resume、可审计；delivered note 记在消息 metadata，**父代理重启后不重跑**已完成委托；
  4. **确认请求转发**：子代理的 ToolConfirmation 换 id 转发给父会话客户端（`subagent_handler.rs` 的 `forwarded`）；
  5. **产物契约**：`final_output_tool.rs` 的 `recipe__final_output` 工具强制子代理提交 `{"summary": ...}`；delegate 工具描述里直接写并发纪律 "delegates cannot coordinate; same-file work = conflicts"。
- **我方**（实测）：`packages/core/src/tool/plugin/subagent.ts` 有前台/后台/通知语义（`backgroundResult`）、`packages/core/src/job.ts` 的 `Background.recovery` 有 `kind: "subagent"`；缺口正是前四轮记录的「没有树预算，也没有深度上限」。
- **落点**：`subagent.ts` 加深度检查；`Background.recovery` 已有的恢复语义与 goose 的 delivered note 同型，核对是否已防重跑。
- **相撞检查**：无。与我方「durable 优先」哲学一致（delivered note 就是持久化状态，不是进程内计数器）。

### 4.2 审批安全契约（三条硬规则）

- **goose**（对方实测）：
  1. **headless + Approve/SmartApprove 模式直接报错拒绝运行**，Auto 模式才 auto-allow 并 warn（`crates/goose-cli/src/session/mod.rs`）——「非交互模式不允许静默自动放行」是安全契约不是默认值；
  2. provider 下发安全提示时**禁用 "Always Allow" 选项**（`prompt_tool_confirmation`）；
  3. 审批 JSON 逐行做**双向控制符消毒**（`output.rs` 的 `sanitize_tool_confirmation_line`，过滤 U+202A-202E 等），防终端视觉欺骗让用户批准没看到的参数。
- **我方**：三条现状均 UNVERIFIED，需要核对 TUI 的审批 UI（`packages/tui`）与 headless 路径。第 3 条与 `doc/permissions.md` 的威胁模型直接相关，值得先在我方树上确认。
- **相撞检查**：无，且第 1 条与我方「升级不被记住的批准消音」同族——都是封「批准被静默放大」的通道。

### 4.3 参数级 always-allow 存储 + 只缓存否定结论的 LLM judge

- **goose**（对方实测）：`crates/goose/src/permission/permission_store.rs` 的 `ToolPermissionStore`——"Always Allow" 按 **`tool_name + blake3(arguments)`** 粒度持久化并支持 `expiry`；「同名工具换参数再问」。`permission_inspector.rs` + `permission_judge.rs`：SmartApprove 用 LLM 判只读，**只缓存否定性结论**（判非只读 → 记 AskBefore），一次性误判不会被永久放行；`manage_extensions` 硬编码强制审批。
- **我方**（实测）：`packages/core/src/permission.ts` 的 allow 规则 + `shell/danger.ts` 的 `BANNED_SAVE` 已做工具级收口；无参数级粒度、无过期。
- **价值**：把「always allow」从工具级收窄到参数级，是给「记住的批准」减负的正交改进，与升级优先性质兼容。**但** LLM judge 是重件——先只借 `ToolPermissionStore` 的存储形状与负缓存原则，judge 缓行。
- **相撞检查**：⚠️ goose 的 `PermissionManager` 查找优先级是 **never > always > ask**（`config/permission.rs`），与我方否决过的「最严格者胜折叠」同族——**折叠语义不要抄**，只借存储粒度。

### 4.4 可插拔 inspector 管线——「决策代数」的过渡形态

- **goose**（对方实测）：`crates/goose/src/tool_inspection.rs` 的 `ToolInspector` trait + `InspectionAction { Allow, Deny, RequireApproval(Option<String>) }`，`ToolInspectionManager` 顺序跑所有 inspector；`security/security_inspector.rs` 的命中转 `RequireApproval(原因 + finding_id)` 自然融入人审流；另有 `AdversaryInspector`（用户规则文件 `~/.config/goose/adversary.md`）、`EgressInspector`（数据外带检测）。
- **价值**：把「安全告警」表达为带原因的 RequireApproval 而非独立 UI 通道，是 codex 清单 P0 决策代数（`Decision` 带 `Ord`）的低配先声；先落管线形状，`Ord` 代数仍按原清单走 codex 的形状。
- **相撞检查**：⚠️ 同 4.3——Deny 优先的聚合在我方树上是「升级优先于一切 allow」，已实现且方向一致；新增 inspector 只能加严、不能引入「命中 allow 就跳过危险检查」的短路（那是 codex 被否决的另一半）。

### 4.5 结构化压缩摘要格式 + 压缩后续接三连

- **goose**（对方实测）：`crates/goose-context-management/src/structured.rs` 的 `StructuredSummary`（`user_intent / files{path,summary,key_code} / errors_and_fixes / pending_tasks / current_work / next_step`）+ `prompts/compaction.md` 四个实测出的细节：
  1. `<analysis>` 丢弃式草稿区（先推理后出 JSON）；
  2. **括号平衡** JSON 提取而非靠 fence（`json_candidates`，只认 `</analysis>` 之后锚定的候选）；
  3. `lenient_string_list` 宽松反序列化（对象/数字强转字符串而不是丢弃整个摘要）；
  4. 解析失败**保留模型原文**做 fallback。
  另有 `summarize.rs` 的 `REMOVAL_PERCENTAGES = [0, 10, 20, 50, 100]`——摘要请求自身超窗时从**中间向外**删 tool response 自愈重试。
- **压缩后续接三连**：摘要（user）+ 固定续接指令（assistant，"不要提你读过摘要"，`CONVERSATION_CONTINUATION_TEXT` 等三种文案）+ **保留用户最后一条真实消息重放到尾部**（`compact_messages::preserved_user_message`）。
- **我方**（实测）：压缩三轨已有（`packages/core/src/session/compaction.ts` 的 `TRANSCRIPT_LEVELS` 分级撤下 + provider 原生 + 后台预压缩）。这里借的是**摘要 prompt 格式与后处理**，不是推翻机制。
- **相撞检查**：⚠️ 我方否决的是「一次性摘要式压缩」这个**机制**（字节回不来且不知哪步挤掉）；格式级借鉴与之不冲突，但落点要先核对 `llm.compact({ mechanism: "trigger" | "endpoint" })` 现在用什么 prompt。

### 4.6 recipes + cron——goose 有、我方全无的最大空白

- **我方**（实测）：`cron` 整词在 core/cli/app src **零命中**；`recipe` 无功能。最近同构物：`packages/core/src/config/plugin/command.ts` 的 markdown 自定义命令、`skill.ts` 技能、`packages/core/src/job.ts` 的 `Background`（运行期后台任务，非定时）。
- **goose 的成品设计**（对方实测），若我方决定做，值得照抄的骨架：
  1. **Recipe schema**（`crates/goose/src/recipe/mod.rs` 的 `Recipe`）：`instructions`（system 侧）与 `prompt`（首条消息）分离；参数系统带 `input_type: string|number|boolean|date|file|select` 与 `requirement: required|optional|user_prompt`，缺参交互补填；`input_type: file` **不允许 default**（防导出敏感文件）；`settings` 覆盖 provider/model/temperature/max_turns；`response.json_schema` 校验最终输出；内置变量 `{{recipe_dir}}` 让 recipe 携带同目录脚本资源（`workflow_recipes/release_risk_check/` 是完整范例）；minijinja `UndefinedBehavior::Strict` + `filter_unparseable_variables` 保护用户文本里的花括号；模板继承限定在 recipe 目录内防路径穿越（`template_recipe.rs` 的 canonicalize + `starts_with` 校验）。
  2. **Scheduler 安全细节**（`crates/goose/src/scheduler/`）：job 只存 (id, cron, recipe_path, params)；recipe **复制**进受控目录 `scheduled_recipes/<id>.yaml`（`MAX_SCHEDULE_RECIPE_BYTES = 1MiB`、Unix `O_NOFOLLOW` + 0600）；执行时**强制 `GooseMode::Auto`** + `SessionType::Scheduled`；session 记 `schedule_id` 供 `schedule sessions` 溯源；无人值守场景自动取消工具审批（`roam delegate` 同理——防护目标是成本失控而非鉴权，这个口径本身值得学）。
- **决策点**：这是产品面扩张而非机制补丁，投入前需要明确我方要不要「定时 agent」这个场景（桌面端已有 schedules UI 的目标用户画像）。建议按 P1 立项但最后排期。
- **相撞检查**：无直接冲突；注意我方会话契约没有 `permissionMode` 字段的否决记录——`SessionType::Scheduled` 在我方落地时应走 ruleset 而非新增会话级模式字段。

### 4.7 stop-hook 阻断上限 + turn-budget 软预算提示

- **goose**（对方实测）：`ops_stop_hook.rs`——Stop hook 可拒绝一次 turn 结束，但连续阻断超 `DEFAULT_STOP_HOOK_BLOCK_CAP = 8`（`crates/goose/src/agents/services.rs`，已实测确认常量）就强制放行并告警；**阻断计数记在消息 metadata（`DENIED`），持久化、重启不丢**。`ops_maxturns.rs`——预算过半后往 turn context 注入 `<turn-budget>n/m used</turn-budget>` 让模型自行收敛，而非硬砍。
- **我方**（实测）：`packages/core/src/session/runner/unfinished.ts` 的 `MAX_NUDGES=10`/`STALL_LIMIT=3` 是 durable 的；但「外部 hook/权限拒绝导致的循环」没有独立止损判据，step 预算对模型也不可见。
- **价值**：计数器持久化这一半我方已有共识（`doc/records/2026-10-todo-completion-nudge.md` 否决进程内 Map）；可借的是**计数器种类**（阻断计数）与 **turn-budget 软提示**这个模型侧可见性通道。
- **相撞检查**：⚠️ goose 的 turn context 是一条 user 角色的 agent-only 消息；我方否决过「合成消息伪装成用户轮」（会被标题生成/投递顺序/step 预算重置读成新意图，见 `架构模式与特点.md`）。**借内容不借形状**——在我方树上这个信息应该走已有的注入通道（系统段或 request 附加），并逐项核对不会触发 promotion/inbox 语义。

## 5. 与前四轮缺口清单的对照（goose 数据点如何改变它们）

| 既有缺口（`优势对比清单.md`） | goose 数据点 | 结论 |
| --- | --- | --- |
| **P0 决策代数**（codex `Decision` 带 `Ord`） | `InspectionAction{Allow,Deny,RequireApproval}` 三态 + 可插拔管线（§4.4）；`never>always>ask` 折叠 | 代数本体仍以 codex 为准；goose 提供的是「管线先行、告警即 RequireApproval」的过渡形态与反面折叠教材 |
| **P1 通用重复/空转断路器** | `DEFAULT_STOP_HOOK_BLOCK_CAP=8`、空响应重试 3 次、CLI `--max-tool-repetitions`（UNVERIFIED 实现位置） | 印证方向，但 kimi 四级阈值 + codex 空转计数仍是更好参照；goose 的贡献是「计数必须 durable」的一致性 |
| **P2 run generation** | 桌面端 `ui/desktop/src/acp/permissionRequests.ts` 用 **generation 防陈旧审批请求**（同 session+toolCallId 的新请求取消旧请求）；`ToolConfirmationCoordinator::try_start_turn` 做 turn 守卫 | 又一个「不透明代际号 + 比较即可」的实例，与 ZCode 的实测结论互相印证，成本比预想低 |
| **P5 工具表面预算** | `collapse_const_unions`（§3.1）+ **Code Mode**（`platform_extensions/code_execution.rs`：Boa JS 沙箱里 `tools.call()` 编排，`list_functions`/`get_function_details` 只暴露签名） | 第一步照 §3.1 走；Code Mode 是另一条路（大件），可作为 P3 备选 |
| **P1 prompt-as-data** | moim 的字节稳定性实践（§3.6 第 3 条）可借；user 角色注入的形状不可借（§4.7 相撞检查） | 摘走工程纪律，机制本体仍以 codex `WorldStateSection` 为准 |

## 6. 明确不学（含理由）

| 项 | 理由 |
| --- | --- |
| goose 的 todo 反模式提示词（"Items never need to be checked off... Never redo or re-verify completed work"，`platform_extensions/todo.rs`） | 与我方 nudge 哲学**相反**：我们的 `todo-residue` 判据是实测得来（发现 todo 残留与未完成强相关）。goose 用它换「模型不被计划绑架」，我方用 `MAX_NUDGES` 上限 + `todo-residue-stopped` 达成同样止损，且不放弃发现未完成工作的能力 |
| `never > always > ask` 严格者胜折叠 | `doc/records/2026-10-permission-fold-ordering.md` 已否决同族方案（会否掉 `explore` 子 agent、破坏 Plan 模式，树内 24 条规则含通配符） |
| moim 以 user 角色注入的形状 | 「伪装用户轮」否决记录（§4.7） |
| roam / iroh P2P 远控（`crates/goose-roaming/`） | 远控拓扑是 ZCode `TaskRealtimeBus` 同类，ZCode 清单已明确不学；iroh 的信任模型（`ConnectionCard`/`TrustBook`）写得好，但我方没有这个场景 |
| Temporal 调度依赖 | goose 自己已弃用（`services_status` 注释），印证 in-process cron（§4.6）是终局选择 |
| 全屏 TUI → 行式 REPL | goose 的迁移是放弃全屏而非进化；我方 OpenTUI 方向不变，只借 §7 的交互机制 |
| 一次性摘要压缩机制 | 我方分级撤下已否决该形状；只借 §4.5 的格式层 |
| `/doctor` 的消息可见性 tricks（user_visible/agent_visible 双 bool） | 我方消息模型没有双可见性字段；等价物已由分级撤下 + 投影覆盖，为这一个功能加字段不值 |

## 7. 工程实践（成本低、并列一节）

1. **MCP 录制回放测试**（对方实测）：`crates/goose-test/src/mcp/stdio/record.rs`/`playback.rs` + `GOOSE_RECORD_MCP` 环境变量切换 + 提交在库里的真实转录（`crates/goose/tests/mcp_replays/`）。第三方 MCP server 只录一次，CI 确定性回放。我方 `packages/core/test/mcp-import-boundary.test.ts` 只守 import 边界，`packages/core/src/mcp/client.ts` 对真实 server 行为的回归没有等价物。
2. **对抗性 MCP fixture server**（对方实测）：`crates/goose-test-support/src/mcp.rs` 的 `McpFixtureServer`——内置 `forge_meta`（故意伪造宿主保留 meta 字段）、`db.query` 点号名冲突、`change_tools`/`late_tool`（`tools/list_changed` 通知）、elicitation、二进制图片。协议安全边界直接变成单元测试。
3. **AI reviewer 指令**（对方实测）：`.github/copilot-instructions.md` 专写「审查者何时沉默」——CI 会抓的不查、低置信度不评、给回复格式模板。我方 AGENTS.md 已有纪律章，可补一节「不报什么」。
4. **面向 LLM 的全站文档地图**（对方实测）：`documentation/scripts/generate-docs-map.js` 抽全部标题+H2–H6 成 `static/goose-docs-map.md` 供 agent 消费。我方 `doc/conventions.md` 是索引但非生成物；`script/doc-refs.ts` 已有锚点校验，加一个生成器成本很低。
5. **评测台账文化**（对方实测）：`evals/harbor/`——terminal-bench-2 上同模型对照（我们自己就是对照组），每次 run 记 pass 率 + compute + tokens + turns + cost，结果快照提交进 README。贵到不能进 CI 就明说不进（每日 tool-call conformance 扫描「刻意不是 PR 门禁」，`.github/workflows/model-toolcall-conformance.yml` 注释原文）。我方 `script/session-efficiency.ts` 只拆时间不测任务成功率；这不算本轮行动项，但「把评测结论固化进版本库」值得记住。
6. **MCP conformance 进 PR 门禁**（对方实测）：`.github/workflows/mcp-conformance.yml` 跑 `npx @modelcontextprotocol/conformance`，带 expected-failures baseline 文件。我方 MCP 是一等公民（client/server/反向 server 三面），这条很便宜。

## 8. 复核命令

```sh
# 我方缺口核实（本轮已跑）
grep -rn "recover_mangled\|unclaimed" packages/core/src --include="*.ts"        # 零命中
grep -rn "DISALLOWED_KEYS\|LD_PRELOAD" packages/core/src/mcp --include="*.ts"   # 零命中
grep -rn "JobObject\|CREATE_SUSPENDED" packages/core/src packages/util/src      # 零命中；taskkill 在 packages/util/src/cross-spawn-spawner.ts
grep -rn "empty response" packages/core/src/session --include="*.ts"            # 零命中

# goose 承重符号核实（本轮已跑）
grep -n "collapse_const_unions" /d/code/github/goose/crates/goose/src/agents/tool_schema_normalize.rs
grep -n "UNCLAIMED_TOOL_ERROR" /d/code/github/goose/crates/goose/src/agents/state_machine/ops_remaining_tool_calls.rs
grep -n "DEFAULT_STOP_HOOK_BLOCK_CAP" /d/code/github/goose/crates/goose/src/agents/services.rs   # = 8
grep -n "MAX_EMPTY_RESPONSE_RETRIES" /d/code/github/goose/crates/goose-agent/src/inference.rs    # = 3
grep -n "DISALLOWED_KEYS" /d/code/github/goose/crates/goose/src/agents/extension.rs              # 31 键
grep -n "REMOVAL_PERCENTAGES" /d/code/github/goose/crates/goose-context-management/src/summarize.rs
git -C /d/code/github/goose log --oneline --all | grep -i "lead/worker"                          # 6435e1a85 删除提交
```

## 9. 建议行动顺序

1. **立即**（P0，各半天量级）：§3.1 schema 归一化（先实测我方 schema 膨胀占比）→ §3.2 幻觉工具三件套 → §3.5 MCP 卫生 → §3.4 Job Object。
2. **下一批**（P1，需设计）：§4.2 审批三条硬规则（先核我方现状）→ §4.1 子代理五件套 → §4.7 阻断上限。
3. **择期立项**：§4.6 recipes+cron（产品决策先行）、§4.3/§4.4（permission 存储粒度与 inspector 管线，fold 语义保持现状）、§4.5 摘要格式（先核对现网 compact prompt）。
4. **随手**：§7 的 1、2、4、6。
