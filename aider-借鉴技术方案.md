# aider 借鉴技术方案（第 6 轮，编号按 goose 轮的序续）

> 分析对象：`D:\code\github\aider`（aider `0.86.3.dev`，`main` = `5dc9490bb`；Python 单体包 `aider/` 共 20285 行，
> 依赖 litellm 巨石 + tree-sitter + networkx + prompt_toolkit；另有 Exercism 基准套件 `benchmark/` 与 Jekyll 文档站）。
> 我方基线：工作树 `loop-reliability-docs`，HEAD `81738639df`，`2.2.0-fork.10`。
> 系列既有对象：`codex` / `kimi-code` / `ZCode` / `adm` / `cline` / `gemini-cli` / `goose`（台账见 `优势对比清单.md`）。
>
> **证据分级**：`实测` = 本轮我在我方树上跑命令核对；`对方实测` = 本轮针对 aider 树读码并逐条 grep 复核承重符号；
> `UNVERIFIED` = 搜索范围不足以断言。引用一律 `路径` + `符号名`，不写行号（纪律见 `doc/conventions.md`）。
>
> **本轮只做增量**：我方已有等价物的不推荐、前五轮已否决或已立项的不换皮重提。撤下项与被接手项逐条见 §5。
> aider 是 2024 年形态的 agent CLI（单模型循环 + 显式编辑格式文法），它的多数「功能」我方已有更强形式；
> 本轮只取它**被实测编译下来的三件事**：能力是数据、循环要给自己的失败计数、缓存是有 TTL 的资源。

## 1. 先纠正五个想当然（对方实测）

| 想当然 | 实测结果 | 证据 |
| --- | --- | --- |
| 「aider 运行时用正则抓模型的偷懒产出」 | **不是**。`ModelSettings.lazy` / `.overeager` 是**每模型数据位**（`aider/resources/model-settings.yml` 中 `lazy: true` 15 条、`overeager: true` 64 条），`base_coder.fmt_system_prompt` 据此把 `base_prompts.lazy_prompt` / `.overeager_prompt` 追加到系统提示尾部。正则 `^[+]? *# .* \.\.\.` 只活在计分侧（`benchmark/benchmark.py` 的 `lazy_comments`），运行时一次都不扫模型输出 | `grep -rn "lazy" aider/models.py aider/coders/base_coder.py`；`sed -n '1173,1180p'` 落在 `fmt_system_prompt` 内 |
| 「aider 默认帮你看住 prompt cache」 | **不是**。`--cache-prompts` 默认 `False`、`--cache-keepalive-pings` 默认 `0`，且 `warm_cache()` 需 `add_cache_headers && num_cache_warming_pings && ok_to_warm_cache` 三门同时为真。作者把它做成显式 opt-in，本身就是「这笔账不一定划算」的信号 | `aider/args.py` 的 `default=False` / `default=0`；`base_coder.warm_cache` 开头三个 guard；`main.py` 仅在 `args.stream and args.cache_prompts` 分支里设 `ok_to_warm_cache` |
| 「aider 的编辑正确性来自 repo map」 | **不是**。map 是只读上下文（338 条 `use_repo_map: true`，dataclass 默认 `False`），编辑正确性来自 6 种 edit format + `reflected_message` 有界反射。`ModelSettings` 里最重的形状其实是**三角色路由**：`weak_model_name` 300 条、`editor_model_name` 145 条、`edit_format: editor-diff` 138 条 | `aider/models.py` 的 `@dataclass ModelSettings`；`edit_format` 分布 `diff 289 / editor-diff 138 / diff-fenced 35 / whole 4 / udiff 4 / architect 1` |
| 「aider 出错就无脑重试」 | **不是**，而且**我方已有更强等价物**。`aider/exceptions.py` 是一张 23 条 `ExInfo(name, retry, description)` 表（可否重试与「对用户怎么说」绑在同一个条目里），`LiteLLMExceptions._load()` 边扫 `dir(litellm)` 边断言「新错误类没进表就 raise ValueError」；`ContextWindowExceededError` 显式 `retry=False` 并在 `base_coder.send()` 里单独特判跳出。我方对应物：`packages/ai/src/provider-error.ts` `isRetryable()` 尾部 `const exhaustive: never = error.reason`（编译期穷尽，比运行时断言更早）+ `packages/core/src/session/runner/step.ts` 的 `isContextOverflowFailure` → `Outcome.Compacted` | `sed -n '13,57p' aider/exceptions.py`；`base_coder.py` 两处 `ex_info.name == "ContextWindowExceededError"`；我方 `provider-error.ts` / `model-retry.ts` |
| 「aider 会拦住模型读 `.env`」 | **不是，方向相反**。`main.py:check_gitignore` 只做提交侧防泄漏：`repo.ignored(".aider")` 为假则加 `.aider*`，`.env` 存在且未被忽略则加 `.env`。读侧保护反而是我方有：`packages/app/src/session/composer/permission-mode.ts` 的 `RISKY_READS = ["*.env*"]`，auto-approve 下对 `read *.env*` 仍 `ask`（`doc/permissions.md` 记着，测试 `permission-mode.test.ts`） | aider 全仓 `grep -i gitignore packages` 对应物见 `main.py`；我方 `RISKY_READS` 实测 |

一个正面事实：aider 的 `benchmark/benchmark.py` **在没有 `AIDER_DOCKER` 时拒绝运行**——它的纪律是「不执行未经审的 LLM 产出物」。我方若做评测闭环（§4.5），这条要先抄进设计，否则评测本身变成 RCE 面。

## 2. 一句话结论

aider 的机制层我方几乎全线追平或超过（能力表、错误分类、溢出恢复、cassette 重放、崩溃预填 issue、GUI 分层都已有更强形式），
但有三件事它做成了我方没做成的闭环：**把基准结论编译成每模型行为位**、**把「模型没按格式产出」当成一等事实计数并对用户可见地上限止损**、
**把 prompt cache 当成有 TTL 的主动资源**。加上两个便宜的可借形状：编辑后验证结果直接进入下一次推理，以及结构化上下文按 token 预算做二分裁剪。
需要防的是它作为 2024 年单模型循环设计的两处时代痕迹：每请求全量 repo map、以 git 历史当 undo 栈——都在 §6 标了不学。

## 3. P0：成本低、本轮已核实我方确实没有

### 3.1 prompt cache 保活 ping——把「缓存会过期」当成调度事实

- **aider**（对方实测）：`base_coder.warm_cache(chunks)` 在每次请求组装完 chunks 后调用（`base_coder.send_message`），起一个 daemon `threading.Timer` 线程 `warm_cache_worker`：每 1 秒轮询，到 `next_cache_warm` 就用 `max_tokens=1` 发一次**非流式**请求，消息体只取 `chat_chunks.cacheable_messages()`（即带断点的前缀），成功则读 `prompt_cache_hit_tokens`/`cache_read_input_tokens` 汇报 "Warmed N cached tokens."，`warming_pings_left` 递减到 0 停；间隔 `delay = 5 * 60 - 5`（Anthropic 5 分钟 TTL 前 5 秒），可被 `AIDER_CACHE_KEEPALIVE_DELAY` 覆盖；`set_cache_warming_enabled(False)` 与 `base_coder.close()` 关闸。整套是 opt-in（§1 第 2 条）。
- **我方**（实测）：缓存策略链齐全但**没有任何主动保活**。`packages/ai/src/cache-policy.ts` 的 `applyCachePolicy`（`AUTO = {tools, system, messages:{tail:1}}`、`BREAKPOINT_CAP=4`、`RESPECTS_INLINE_HINTS` 路由白名单、per-model `gatewayPolicy`）；`protocols/anthropic-messages.ts` 的 `cacheControl()` / `Cache.newBreakpoints`；`packages/core/src/session/model-request.ts` 的 `promptCacheKey` 与 `cache: {ttl}`，`boundImages` 甚至专门为「切图时保持前缀字节不变」写了注释；`packages/core/src/session/usage.ts` 按 `cache.read`/`cache.write` 计价，`session/stats.ts` 把 `$.tokens.cache.read` 折进用量页。**缺的只有保活**：`grep warm_cache|keepalive packages/{ai,core}/src` 只命中入站 SSE keepalive（`ai/src/route/framing.ts`）。
- **为什么值得做**：我方比 aider 更需要——审批等待、用户在读 diff、shell 工具跑长任务，这些间隙前缀在被逐字复用但一次都不发请求；TTL（Anthropic 5 分钟档，我方 `model.cache.ttl` 已可配）过期的直接后果是下一个请求**全价重推整个前缀**。这条同时打在成本与 tok/s 上，而 tok/s 与缓存命中是必须保留的展示项。
- **落点**：请求前缀在 drain 内已经组装好，保活应挂在 `packages/core/src/session/runner` 的空闲边界（等待审批 / 等待下一条 inbox）而不是新线程；ping 请求必须走同一个 `promptCacheKey` 与同一份前缀字节，否则等于自己把缓存打脏。
- **相撞检查**：⚠️ 记账口径先定再写码——ping 是真实 API 调用。`doc/usage-stats.md` 的原则是「不虚构归属」，它已把 `source: "compaction"` 排除在日聚合外；保活 ping 同理需要显式归类（建议 `source: "cache-warm"`，计入 tokens 不计入日活），否则用量页会出现「没人提问却花了钱」的无法解释条目。⚠️ aider 默认关闭是证据不是噪音：上线默认值需要实测「一次 ping 的成本 vs 前缀重推的成本」，我方 `script/session-efficiency.ts` 已经能拆出 cache reuse，先量再定默认。

### 3.2 编辑后验证结果直接进入下一次推理（不是提示用户去验证）

- **aider**（对方实测）：`base_coder.apply_updates` 尾部是一条有顺序的闭环——`edited = self.apply_updates()` → 若 `self.reflected_message` 已存在则**直接返回**（格式修复优先于验证）→ `edited and self.auto_lint` 时 `lint_errors = self.lint_edited(edited)`，随后 `auto_commit(edited, context="Ran the linter")` 把修复也纳入提交，有错则 `io.confirm_ask("Attempt to fix lint errors?")`，用户同意后 `self.reflected_message = lint_errors; return` → `auto_test` 同型（`cmd_test(self.test_cmd)` → `reflected_message = test_errors`）。`reflected_message` 被 `run_one` 的 `while message:` 循环当作**下一轮 LLM 调用的输入**，且受 `max_reflections = 3` 约束。
  另一件更硬的东西在评测侧：`benchmark/refactor_tools.py` 用 AST 判「假重构」——`verify_full_func_at_top_level` 要求目标函数仍是顶层函数、`sum(1 for _ in ast.walk(node))` 的子节点数偏差 `< 10%`。这是把「模型偷工减料」变成可断言的判据，而不是靠提示词祈祷。
- **我方**（实测）：写工具后只有 formatter，而且**失败是被主动丢掉的**——`packages/core/src/formatter.ts` 的 `Formatter.file` 把子进程 `stdout/stderr` 设为 `"ignore"`，命令抛错走 `Effect.logError("failed to format file")` 后 `Effect.as(undefined)`，退出码非 0 时只 `Effect.logError("formatter exited unsuccessfully")` 并 `return false`；调用点 `tool/plugin/edit.ts` 拿到 `false` 后直接回读原文（`const formatted = (yield* formatter.file(target.absolute)) ? syncTextBom(...) : readText(...).text`），**模型收到的 diff 里没有任何「格式化失败」的痕迹**。`write.ts`、`patch.ts` 同型。没有 lint / typecheck / 测试自动执行，没有 idle 时验证；`tool/plugin/edit.ts` 里还留着两条 TODO（"Publish watcher/file-edit events after watcher integration exists"、"Add LSP notification and diagnostics after LSP runtime exists"）。可承载验证的钩子存在：`packages/plugin/src/effect/tool.ts` 的 `tool.hook("execute.after")`（但只有 `before` 能否绝调用的 `Tool.Error`）。
- **落点**：不是把 aider 的 lint 搬过来，而是把**「验证失败 → 成为下一次推理的输入」**这条通道做出来。我方对应形状是 durable 的合成 inbox 项或 notice token，**不能**用 `reflected_message` 那种「伪装成模型自己刚说的话」。判据建议直接从便宜的开始（formatter 失败、`tsc`/项目自带 check、patch 后语法可解析），AST 不变量这种重判据留给评测层（§4.5）。
- **相撞检查**：⚠️ 前五轮的否决记录：「合成消息伪装成用户轮」（`架构模式与特点.md`，会被标题生成、投递顺序、step 预算重置读成新意图）——所以这条只能落在已有注入通道上。⚠️ 必须有次数上限并进 `doc/session-loop.md`（改续跑判据的落点就在那）。⚠️ 我方「验证是模型的工作还是循环的工作」是架构取向问题：现在的答案偏前者（模型自己跑 bash），本轮只是**补一条可选的自动反馈**，不是把模型侧的 shell 工具撤掉。立项前需要这个共识确认。

### 3.3 给「模型没按格式产出」计数，并把上限对用户可见

- **aider**（对方实测）：三件套。① `base_coder.num_malformed_responses`（类级初值 0，`apply_updates` 的 `except ValueError` 分支 `+= 1`）——这个数字同时是 `.aider.results.json` 的指标与网页排行榜的 `percent_cases_well_formed` 来源，即**循环内的计数就是评测口径**，两边不分叉。② `run_one` 的 `while message` 反射循环带 `num_reflections >= max_reflections` 上限，停的时候明说 `Only {max_reflections} reflections allowed, stopping.`——上限是**说给人听的**，不是静默放弃。③ 错误文案带去处：`"The LLM did not conform to the edit format."` + `urls.edit_errors`（`aider/urls.py` 是集中登记文档 URL 的表）。④ 修复是定向的：`editblock_coder` 失败时 `find_similar_lines` 产生 "did you mean" 提示塞进异常文本，模型收到的是**候选而不是重来**。
- **我方**（实测）：格式层很硬但没有计数。`session/runner/publish-llm-event.ts` 的 `InputFailureReason = "malformed" | "length" | "incomplete"`、`INPUT_FAILURES` 模型可见文案、`failMalformedToolInput`、`flush()` 在步末结算畸形项、`inputFailure()` 附 2048 字符摘录（`INPUT_EXCERPT_LIMIT`）；事前修复比 aider 强——`packages/core/src/plugin/tool-input-repair.ts` 按 schema 做 coercion 与 oneOf 试探，把畸形消灭在结算前。**缺口**：没有任何「同一 turn 内畸形产出第 N 次」的持久计数，也没有「超限就停下并告诉用户为什么停」的可见上限；`grep -rn 'repetition\|loopDetect\|isLoop\|stuck' packages/core/src` 仍为零命中（`优势对比清单.md` 实测结论）。
- **落点**：`packages/core/src/session/runner/` 内，判据从 durable 历史 fold（与 `runner/unfinished.ts` 的 `decide(messages)` 同型，那里已有 `MAX_NUDGES=10` / `STALL_LIMIT=3` / `ESCALATE_AFTER=3`）。**这一条与 `优势对比清单.md` §4 的「通用重复/空转断路器（建议插 P1）」是同族不同判据**：那条数的是「重复工具调用」，本条数的是「不合法产出」。两者应共用同一个 fold 骨架与同一套「上限必须可见」的纪律，而不是分叉成两套计数器。
- **相撞检查**：⚠️ 不撤下断路器那条，两者并列；实做时先做**判据种类**（畸形产出）而不是新算法，因为 `llm.ts` 的历史 fold 已经是现成地基。计数必须 durable——`doc/records/2026-10-todo-completion-nudge.md` 否决进程内 `Map` 的理由同样适用。

### 3.4 配置面与 schema 从声明生成，而不是手写 mdx

- **aider**（对方实测）：`aider/args.py` 用 configargparse，`auto_env_var_prefix="AIDER_"`（**每个 flag 自动获得一个环境变量**）+ `YAMLConfigFileParser`，再挂三个自定义 formatter：`MarkdownHelpFormatter` / `YamlHelpFormatter` / `DotEnvFormatter`（`aider/args_formatter.py`，228 行），文档站的选项表、YAML 样例、`.env` 样例**全部由同一个 parser 生成**，不可能与代码漂移。模型默认值同款：`python -m aider.models --yaml` 走 `get_model_settings_as_yaml()` 直接 dump 给文档用。`commands.py` 的 `get_help_md()` 同理自动生成命令表。
- **我方**（实测）：有真 codegen 但方向是 API 不是配置面——`packages/protocol/script/generate-openapi.ts`（`generate` / `check:generated`）、`packages/httpapi-codegen`（CI 卡漂移）。文档侧是两个**校验器**而非生成器：`script/doc-refs.ts`（烂路径、失效 `path#Symbol`、未登记 topic doc，进 `bun run lint`）、`script/sdk-docs.ts`。配置参考在 `packages/web/src/content/docs/*.mdx` 手写，`"$schema": "https://opencode.ai/config.json"` 在仓内**找不到生成器**（实测 grep 未找到），`packages/core/schema.json` 是 drizzle SQL schema 不是配置 schema。
- **落点**：`packages/schema` 的配置 schema → 生成 ①`config.json` ②docs 选项表 ③env 变量表。这条与我方最强的「单源契约 + 三口味 codegen」优势同轴（`优势对比清单.md` §2），是把已有优势补到配置面上，不是新机制。
- **相撞检查**：goose 轮 §7.4「面向 LLM 的全站文档地图」是**不同产出物**（标题索引 vs 配置参考），不冲突也不重复；那轮把它列在「随手」，本条同理列随手但优先级更高，因为 `config.json` 无生成器是**已核实的事实缺陷**而非优化项。

## 4. P1：机制清晰、需要设计

### 4.1 侧任务模型路由——aider 用得最多的一个字段，我方完全没有对应物

- **aider**（对方实测）：`ModelSettings` 里 `weak_model_name`（300 条设置）与 `editor_model_name`（145 条）+ `editor_edit_format`。`weak_model_name` 专门承担 commit message 生成（`repo.py:GitRepo.get_commit_message` 沿 `commit_message_models()` 逐个试，走 `sendchat.py:simple_send_with_retries`）与摘要；`editor_model_name` 承担 architect 模式落地编辑那一步（`architect_coder.py` 里对 editor coder 强制 `cache_prompts = False`）。`aider/prompts.py` 的 `commit_system` 是独立提示，`{language_instruction}` 还按用户语言本地化。
- **我方**（实测）：侧任务全部跟主模型。压缩用 `packages/core/src/session/compaction.ts` 里 `.resolve({ ...context.session, model: agent.model }, catalog.available)`；标题/生成走 `packages/core/src/session/generate.ts` 的 `context.resolveModel(selection.session)`；提交信息**根本没有生成器**（唯一写路径是人在 rail 手输 message → `sdk.api.vcs.commit`，见 `doc/session-rail.md`）。agent 级 model 覆盖是有的（`packages/core/src/config/plugin/agent.ts` 的 `agent.model = {id, providerID, variant}`），但没有「这个**用途**用这个模型」的路由维度。
- **价值**：压缩是真实成本与真实延迟，而且它压在 tok/s 这条必保指标的关键路径上。`packages/core/src/session/compaction.ts` 已经为「摘要质量」设计了 `TRANSCRIPT_LEVELS` 分级与 `NUDGE`（摘要漏模板时补一次），说明这条链路的产出格式是固定的、可降级到小模型的。
- **落点**：新增**用途维度**而非会话维度：`compaction` / `title` / 将来的 `commit-message` 各自的 model override，缺省继承会话模型。⚠️ 换模型 = 换 cache 前缀，必须逐用途实测（`doc/context-economics.md` 是这条的归属文档）。⚠️ 小模型跑摘要会直接影响压缩质量判据（`compaction.ts` 的模板校验与 `SHRINK_STEPS` 百分比是按现模型调的），先只做 `title`（无 cache 收益、零风险）验证形状，再决定是否开 `compaction`。

### 4.2 脏工作区先提交（价值被我方 snapshot 削弱，但边界污染仍在）

- **aider**（对方实测）：`base_coder.allowed_to_edit` 对已在 chat 的文件调 `check_for_dirty_commit(path)`：`self.repo.is_dirty(path)` 为真则把路径加进 `need_commit_before_edits`，编辑真正落地前由 `prepare_to_edit` → `dirty_commit()` 提交（`self.repo.commit(fnames=..., coder=self)`）。默认开（`--dirty-commits` default `True`），但 `if not auto_commits: dirty_commits = False`——没有自动提交能力时这条依赖不存在。`source` 里还留着一句关键注释：空文件跳过那段被注释掉了，理由是 "We need a committed copy of the file in order to /undo, so skip this"——**dirty commit 与 undo 是绑定的**。
- **我方**（实测）：完全没有 dirty 检测/stash/守卫（`grep dirty|uncommitted|stash packages/core/src` 只命中 `plugin/vcs/git.ts` 的 worktree-remove `forceRequired` 与 `shell/parse.ts` 把 `git stash` 当命令解析）。`Vcs.status()` 只服务 rail 的未提交数展示。隔离哲学不同：**换 worktree 而不是兜底**（`packages/core/src/worktree/strategies.ts`、`worktree/git.ts` 的 `Git.worktree.create`，目录在 `$data/worktree/<project6>`）；undo 靠 `Snapshot.capture/restore` + `session/revert.ts` 的 `stage/clear/commit`，snapshot 库在 `$data/snapshot/<project>/<hash>` 用独立 git-dir，**绝不碰用户仓库历史**。
- **诚实收缩**：aider 那条链的收益一半（能 undo）我方已由 snapshot 提供。剩下的真收益只有一条，且只在**非 worktree 场景**（用户直接在自己主检出里跑 agent）成立：人类未提交改动与 agent 编辑落进同一个提交，提交边界不可分割。rail 的 `git commit --only -m <msg> -- <paths>` 已经限定了路径集，所以污染面比 aider 小得多——**本条降级为「先复核非 worktree 路径下到底会不会混」**，会混再做，不做不立项。
- **相撞检查**：⚠️ 自动提交人类代码是高风险动作，aider 自己也是 `confirm_ask` 语义。我方若要做得走 permission 通道（`doc/permissions.md`），且不得引入「agent 顺手改了用户 git 历史」这条与 snapshot 哲学冲突的副作用。

### 4.3 结构化上下文的预算二分 + 符号缓存落盘（借算法，不借每请求全图）

- **aider**（对方实测）：`repomap.py:get_ranked_tags_map_uncached` 是**按 token 预算裁剪结构化内容**的干净实现——`get_ranked_tags`（tree-sitter `queries/*-tags.scm` 抽 def/ref，`networkx.MultiDiGraph` + `nx.pagerank` 带 personalization，chat 文件边权 ×50、`num_refs=sqrt` 缩放）产出有序 tag 后，`lower_bound = 0 / upper_bound = num_tags / best_tree / best_tree_tokens` 在 tag 数量上二分逼近 `max_map_tokens`；`get_repo_map` 再按 `max_map_tokens * map_mul_no_files`（无 chat 文件时给更大份额）调整，失败时把 `max_map_tokens = 0` 整体撤下而非报错。缓存侧：`TAGS_CACHE_DIR = f".aider.tags.cache.v{CACHE_VERSION}"`（diskcache），`tags_cache_error()` 在缓存损坏时**降级为内存缓存**并告警而不是崩。`filter_important_files`（`special.py` 的 `ROOT_IMPORTANT_FILES` 白名单）把 README/pyproject 这类根文件**无条件前置**到排名结果里。
- **我方**（实测）：无 repo map、无符号索引（tree-sitter 只用于 shell 命令解析：`packages/core/src/shell/parse.ts` + `parser-wasm.{bun,node,workerd}.ts`）。LSP 三处 stub 明确写着等待运行时（`tool/plugin/edit.ts`、`write.ts`、`file-mutation.ts`）。结构化注入目前只有环境段与 AGENTS.md 增量（`session/instructions/builtins.ts` 的 `core/environment`、`Instructions.diffByKey`）。
- **为什么仍值得记**：两点可迁移且与我方方向一致。① **预算二分的形状**：我方 `session/compaction.ts` 的 `SHRINK_STEPS`（85/70/50/35 %）是**固定百分比阶梯**试错，`model-request.ts` 有 `ESTIMATE_ERROR` 估算误差——二分逼近预算是同一问题的更精确解，适用于任何「按预算塞结构化块」的场景（未来的 LSP diagnostics 集、AGENTS.md 集合、工具 schema 面）。② **缓存损坏降级为内存**是个便宜的健壮性纪律。③ 顺带事实：`web-tree-sitter` 依赖**已经在树里**，做符号级检索的依赖成本比外部想象低得多。
- **落点**：不新建索引子系统；把二分预算做成 `packages/core/src/session/` 内的一个纯函数（输入有序条目 + 预算 → 输出可容纳的最大前缀），先在压缩/撤下面前替换百分比阶梯试点，再谈 LSP。
- **相撞检查**：⚠️ 每请求全量 repo map 不抄（§6）；⚠️ 与 `优势对比清单.md` §4 的「工具表面预算（P5）」是同一类问题的不同面，不重复立项——那条管 tool schema，本条管注入块。

### 4.4 文件内 `AI!` / `AI?` 协议——把人机交替搬到文件里

- **aider**（对方实测）：`watch.py:FileWatcher` 是 daemon 线程跑 `watchfiles`，`get_roots_to_watch()` 尊重 gitignore，命中的文件里出现以 `AI!`（要求改）或 `AI?`（要求答）结尾的注释时，取 `watch_prompts.watch_code_prompt` / `watch_ask_prompt`，用 `TreeContext` 定位行号做精确片段，然后 `self.io.interrupt_input()` **打断正在等待的输入循环**（`io.py:interrupt_input`）把这条变化投递进对话；首次触发时提示用户 "End your comment with AI! to request changes or AI? to ask questions"。
- **我方**（实测）：监听层已有且不弱——`packages/core/src/filesystem/watcher.ts` 用 `@parcel/watcher` 原生绑定（`getBackend()`：win32 `windows` / darwin `fs-events` / linux `inotify`），`filesystem/location-watcher.ts` 把 watch 目标定位到 **VCS 元数据**（`<gitDir>/HEAD`）从而感知外部分支切换，`filesystem/file-watch.ts` 提供 per-file 订阅（`TTL 24h` / `SWEEP_INTERVAL 5m` / `MAX_PER_LOCATION 256`）。缺的只是**「文件内容里的注释是人的指令」**这一层语义。
- **价值与定位**：这是产品面扩张，不是机制补丁。它的真实吸引力在桌面/IDE 场景：人在编辑器里改注释即下达下一步，不需要离开编辑器。但与我方 inbox 语义要对齐——投递形状应是 `session.inbox.enqueued` 的**合成项**（可见、可取消、可在步界改），而不是伪装用户轮（同 §3.2 的相撞检查）。且必须默认关闭：文件注释变成可执行指令，等于给「任何写进文件的文本」开了一条注入面。
- **建议**：按 P2 排期，先出威胁模型与默认值讨论，不要直接实现。

### 4.5 评测闭环：把基准结论编译回行为位（本轮接手，前几轮只说「值得记住」）

- **aider**（对方实测，完整链条）：`benchmark/benchmark.py` 跑 Exercism polyglot 习题 → `Coder.create(...)` → `coder.run(with_message=instructions)` → `run_unit_tests()`（按扩展名查 `TEST_COMMANDS`），失败时把 pytest 输出用 `prompts.test_failures` 回喂，最多 `--tries`（默认 2）次 → 每题写 `.aider.results.json`，指标口径固定：`tests_outcomes` / `cost` / `num_malformed_responses` / `syntax_errors` / `indentation_errors` / `lazy_comments` / `num_exhausted_context_windows` / `user_asks` / `chat_hashes`（每次请求响应的 sha1）。`summarize_results()` 直接打印 **YAML-ready** 排行榜条目（`pass_rate_1/2`、`percent_cases_well_formed`、`seconds_per_case`），粘进 `aider/website/_data/*_leaderboard.yml`（polyglot / edit / refactor / architect / quant / code-in-json…）。**闭环的最后一跳**：这些结论反向编译进 `aider/resources/model-settings.yml` 的 `edit_format` / `lazy` / `overeager` / `reminder` / `examples_as_sys_msg`，即**跑分决定默认行为**，且每个结果里记 `commit_hash` 与 `dirname` 日期，可追溯。`rungrid.py` 做 model × edit-format 扫描，`problem_stats.py` 把排行榜读回来找每题难度（`HARD_SET_NUM=3`）。
- **我方**（实测）：三件事各有半个。① 重放：`packages/http-recorder`（`HttpRecorder.layerFetch`）+ `packages/core/test/session-runner-recorded.test.ts` 用真 runner + SQLite + `LLMClient` 打在录制 cassette 上（`packages/core/test/fixtures/recordings/`），`packages/ai/test/fixtures/recordings/**` 按 provider 分；编辑解析器另有直测（`packages/core/test/patch`、`tool-edit`、`tool-patch`）与 `patchmark` 的差分 fuzz（`bun run fuzz` → `scripts/fuzz-differential.ts`）。**这一层我方形式比 aider 强**（cassette 在 HTTP 边界，不是 md 文件正则），所以 §6 不抄它的 `--replay`。② 任务成功率：**没有**。`script/session-efficiency.ts` 只拆 wall time（模型流式 / 工具结算 / gap）与 tokens/缓存复用/step 数，**没有任何结果断言**。③ 版本库里的评测台账：**没有**——`packages/stats` 是 opencode.ai 的服务端站点统计，其 "leaderboard" 是模型 token 图（`app/src/i18n/*.ts` 的 `nav.leaderboard`），不是跑分；`.github/workflows` 只有 check / check-test / release / nightly / triage。
- **归属**：goose 轮 §7.5 把「评测台账文化」明确判为「**这不算本轮行动项，但值得记住**」，`优势对比清单.md` 也没有这一项。本轮接手立项，因为 aider 给出了 goose 没给的东西：**结论会编译回运行时行为**，而不只是贴给人看。
- **规模与两步走**（这是大件，必须拆）：
  1. **先建台账不建跑分**（小）：选定一组能本地跑的任务（我方已有 fixture 形状可复用），把 `session-efficiency.ts` 的读数 + 一个**成功判据**写进提交在库的 JSON/YAML；成功判据从 §3.2 提到的 AST 不变量这类可断言的东西起步，别从 LLM judge 起步。
  2. **再谈行为位**（中）：只有台账能稳定复跑，才值得引入我方版的「每模型行为位」——我方现成的载体是 `packages/schema/src/model-compatibility.ts`（已有 `reasoningField` / `requireReasoning` / `maxTokensField` / `requireFinishReason` / `requireAssistantAfterTool` / `supportsPromptCacheKey` / `cacheFormat` / `mediaInput` …），加字段是便宜的，贵的是产生填它的证据。
- **相撞检查**：⚠️ 纪律先抄：不执行未审 LLM 产出（见 §1 末），评测必须在容器/worktree 里；⚠️ 供应链与依赖面归 codex 轮 M2，本轮不重复立项；⚠️ `优势对比清单.md` 的 P5「工具表面预算」与 §3.1（goose 轮的 schema 归一化）不要和这条混成一件事。

## 5. 与前五轮台账的对账（撤下 / 接手 / 更正）

| aider 看起来支持的项 | 本轮处置 | 归属与理由 |
| --- | --- | --- |
| Windows 进程树治理（Job Object / `CREATE_SUSPENDED`） | **撤下，本轮不立项** | goose 轮 §3.4 已立项且判据更硬。aider 是 Python CLI，用 `subprocess` 加 `startupinfo`，全仓无 Job Object；它在这个维度**不提供新证据** |
| MCP 子进程 env 黑名单 | **撤下，本轮不立项** | goose 轮 §3.5 已立项。顺带实测我方现状（本轮核）：`packages/core/src/mcp/stdio.ts` 是 `env: options.environment, extendEnv: true`，**无任何 denylist**——这条缺口被 aider 再次确认存在，但立项仍记在 goose 轮名下 |
| 工具 schema 归一化 / 工具表面预算 | **撤下** | codex 清单 P5 + goose 轮 §3.1（第一步是实测膨胀占比）。aider 用 function-calling 的 `write_file` schema，不涉及 schema 膨胀 |
| 通用重复 / 空转断路器 | **并列保留，新增第二种判据** | `优势对比清单.md` §4 那条数「重复工具调用」；本轮 §3.3 补「不合法产出计数」并要求**上限对用户可见**（aider 的 `Only 3 reflections allowed, stopping.`）。两者共用 `unfinished.ts` 的 fold 骨架，不分叉实现 |
| 错误变体漂移检测 | **不立项** | 我方 `const exhaustive: never = error.reason`（`packages/ai/src/provider-error.ts` 的 `isRetryable()`）是编译期等价物，比 aider 的运行时 `_load()` raise 更早。写在这里是为了阻止下一轮把 aider 这张表当缺口重提 |
| transcript 重放测试 | **不立项** | 我方 cassette（`packages/http-recorder` + `session-runner-recorded.test.ts`）在 HTTP 边界重放真 runner，强于 aider 的 `--replay` 正则读 `.aider.chat.history.md` |
| 崩溃预填 issue | **不立项（TUI/GUI/桌面已有）** | `packages/tui/src/component/error-component.tsx` 已在错误页预填 `issues/new?template=bug-report.yml`；`packages/desktop/src/main/ipc-handlers/app.ts` 的 `AppRecordFatalRendererError` 覆盖桌面。仅「纯 CLI 崩溃路径是否等价」本轮 **UNVERIFIED**，列为待核不是待建 |
| 面向 LLM 的文档地图 | **保留在 goose 轮 §7.4** | 本轮 §3.4 是**不同产出物**（配置参考与 `config.json` 由 schema 生成），不与「标题索引生成」重复 |
| 评测台账文化 | **本轮接手立项** | goose 轮判为「不算行动项，但值得记住」；aider 的增量是「结论编译回运行时行为位」这一跳，见 §4.5 |

## 6. 明确不学（含理由）

| 项 | 理由 |
| --- | --- |
| 每请求全量 repo map（tree-sitter + PageRank 结构化图当上下文） | 与我方架构相反：我方是**按需 agentic 检索**（`read`/`glob`/`grep` ripgrep 后端 + AGENTS.md walk-up + `Instructions.diffByKey` 增量）+ 工具表面预算（codex P5）。全量 map 的代价是每请求固定税、跨请求字节不稳定（**直接与我方 cache 前缀稳定性目标冲突**，见 §3.1 与 goose 轮 §3.6），而 aider 自己也是靠 `map_mul_no_files`、失败时 `max_map_tokens = 0` 整体撤下来控制这个税。只借 §4.3 的预算算法形状 |
| `/undo` = `git reset --hard` 把 git 历史当 undo 栈（`commands.py cmd_undo` + `show_undo_hint`） | 与我方已定的「snapshot 用独立 git-dir、绝不碰用户仓库历史」冲突（`packages/core/src/snapshot.ts`、`session/revert.ts`）。aider 的 dirty commit 之所以必要正是因为它的 undo 依赖提交（§4.2 的注释证据）；抄 undo 会连带把整套提交耦合哲学拖进来 |
| `SwitchCoder(Exception)`：命令 `/model`、`/chat-mode` 用抛异常重建整个 coder | 我方是事件溯源 + 投影，状态迁移有 durable 记录；「抛个异常来换实现」在 aid 里省了字段迁移，在我方等于绕过所有 projector。不借形状 |
| GUI 走 `CaptureIO(InputOutput)` 子类把 console 输出 tee 进界面（`aider/gui.py`） | 我方 server/protocol + desktop/TUI/app 三面已是更强的同一形式（单源契约 + 三口味 codegen），aider 这个技巧是在没有协议层的 CLI 上模拟协议层 |
| 以 litellm 为唯一 provider 抽象、单包 20285 行巨石 | 我方 `packages/ai/src/protocols/*` 已按协议分文件并有 provider-error 分类；引入 litellm 级依赖会破坏 `bunfig.toml` 的 `exact = true` + `minimumReleaseAge = 259200` 供应链闸门 |
| 运行时正则扫模型输出来判「偷懒」 | 抄错形状就等于把 aider 最值钱的那一半丢了（§1 第 1 条）：它的判据来自基准，落在**每模型数据位**（`ModelSettings.lazy`）上。我方要做的是 §4.5 的台账 → `model-compatibility.ts` 加位，不是加正则 |
| `aider/commands.py` 1712 行单类斜杠命令面 | 我方已有 `config/plugin/command.ts` 的 markdown 自定义命令 + `session/command.ts`；合并成一个巨类与 `src/config` 的自导出模式相违 |
| 客户端匿名遥测采样（`analytics.py` 的 `PERCENT = 10` + `is_uuid_in_percentage` + `_redact_model_name`） | **决策点而非行动项**。实测我方现状：本地统计无上报（`doc/usage-stats.md`），外发只有默认关闭的 OTLP（`packages/util/src/observability.ts`），`config.ts` 的 `username` 标了 "用于 telemetry identity" 但没有采样器也没有本地 jsonl 聚合（无 `scripts/my_models.py` 等价物）。fork 场景确实想要「我方用户实际用哪些模型、哪些 provider 失败率高」，但这是隐私与分发政策决定，需要产品同意后才立项 |
| `/help` 的本地语义检索（`help.py` + llama-index + 首次运行下载 `bge-small-en-v1.5`，测试 `tests/help/test_help.py` 真下载并自带 `retry_with_backoff`） | 引入 embedding 模型与索引栈只为了文档问答，代价与收益不成比例；我方 `doc/conventions.md` 索引 + 检索由模型自己做 |
| `scrape.py`（playwright）与 `voice.py`（sounddevice + whisper）作为主包内建 | aider 用 extras + 交互式 `pip install aider-chat[playwright]` 缓解，但依赖仍在同一包图里。我方这些表面各自独立；且 aider 的测试 `tests/browser/test_browser.py` 只能断言「streamlit 变成可 import」，说明这种降级验证不住行为 |

## 7. 工程实践（成本低、并列一节）

1. **`pytest.ini` 里 `env = AIDER_ANALYTICS=false`**（对方实测，pytest-env 插件）：遥测在测试层被配置关掉，而不是靠 mock 全局。对应我方需求：任何外发（OTLP、update check）在测试里应有配置级关闭而不是 monkeypatch。便宜的闸门形状，值得进 `bun run lint` 一类检查。
2. **`aider/urls.py` 集中登记文档 URL**（对方实测）：错误文案与去处同表（`urls.edit_errors` / `urls.model_warnings`），改文档路径只需改一处。我方错误文案在 `publish-llm-event.ts` / `provider-error.ts` 各处散写，且 `script/doc-refs.ts` 只校验仓内路径不校验外链。
3. **`fuzzy_match_models()` 的 "Did you mean…" 与 `sanity_check_models()`**（对方实测，`--show-model-warnings` 控制）：配错模型名在启动时给候选而不是运行时 404。我方 TUI 有模型选择器，**CLI/headless 路径是否等价本轮 UNVERIFIED**，值得一次 grep 而不是直接立项。
4. **`ModelInfoManager` 的 24 小时缓存 + `~/.aider/caches/`**（对方实测）：外部模型目录拉取有版本化磁盘缓存与固定过期。我方 `packages/core/src/models-dev.ts` 已是 v1/v2 fetch + versioned cache keys，**已有等价物**，列在此处只为记录 aider 也停在同一结论上。
5. **`main.py:check_and_load_imports()` / `load_slow_imports()`**（对方实测）：`httpx/litellm/networkx/numpy` 首次运行同步加载并写状态文件，之后放 daemon 线程加载；`llm.py:LazyLiteLLM` 的注释直说 "takes 1.5 seconds, defer it!"。我方有启动敏感面的动态导入纪律（AGENTS.md「Prefer dynamic imports…especially in startup-sensitive entrypoints」），可借的是**把「为什么慢」写进注释**这条习惯。
6. **`scripts/blame.py` 统计「多少代码由 aider 自己写出」**、`scripts/my_models.py` 聚合本地 jsonl、`scripts/homepage.py` 抓 PyPI/Badge（对方实测）：把自己当产品做度量并公开呈现。与我方 `CHANGELOG.md` + PR body 里的动画 SVG 是同一传播纪律的两种形态，不新增行动项。
7. **`GitRepo.commit()` 的归属矩阵写成 docstring**（对方实测，`repo.py`）：`--attribute-author` / `--attribute-committer` / `Co-authored-by` 三种组合各自的 Author/Committer 结果列成表贴在函数上。我方若将来做提交信息生成器（§4.1 的副产物），署名策略应以同样的形式写进 `doc/session-rail.md` 的 `Decisions`——现在的 rail 设计明确**不传 `--no-verify`**（hook 照跑），这条已经比 aider 多了一层尊重用户 hook 的纪律，值得守。

## 8. 复核命令

```sh
# 我方现状（本轮实测）
grep -rn "warm_cache\|keepalive" packages/ai/src packages/core/src --include=*.ts     # 只命中入站 SSE keepalive
grep -n "BREAKPOINT_CAP\|RESPECTS_INLINE_HINTS\|applyCachePolicy" packages/ai/src/cache-policy.ts
grep -n "promptCacheKey\|cache: {" packages/core/src/session/model-request.ts
grep -rn "repetition\|loopDetect\|isLoop\|stuck\|malformedCount" packages/core/src --include=*.ts   # 空 = 无计数
grep -n "MAX_NUDGES\|STALL_LIMIT\|ESCALATE_AFTER" packages/core/src/session/runner/unfinished.ts
grep -n "const exhaustive: never" packages/ai/src/provider-error.ts                   # 编译期穷尽 = aider _load() 的更强等价物
grep -n "Formatter.file\|reflected\|lint" packages/core/src/formatter.ts              # 只有 formatter，失败仅记日志
grep -n "resolve({ ...context.session, model: agent.model }" packages/core/src/session/compaction.ts
grep -rn "commitMessage\|dirty_commits\|gitignore" packages/core/src --include=*.ts    # 空 = 无提交生成器/无脏检查/无 gitignore 逻辑
grep -rn "config.json\|\"\$schema\"" packages/web/src/content/docs/*.mdx | head        # 手写 mdx 引用
find packages/web/src/content/docs -name '*.mdx' | wc -l

# aider 承重符号（本轮实测，逐条对得上本文）
grep -n "lazy_prompt\|overeager_prompt" /d/code/github/aider/aider/coders/base_prompts.py
grep -n "lazy:\|overeager:" /d/code/github/aider/aider/models.py
for k in edit_format use_repo_map lazy overeager weak_model_name editor_model_name; do
  printf "%s " "$k"; grep -c "$k" /d/code/github/aider/aider/resources/model-settings.yml; done
grep -n -A6 '"--cache-prompts"' /d/code/github/aider/aider/args.py                     # default=False
grep -n -A4 '"--cache-keepalive-pings"' /d/code/github/aider/aider/args.py             # default=0
grep -n "max_reflections\|num_reflections\|num_malformed_responses" /d/code/github/aider/aider/coders/base_coder.py
grep -n "def check_for_dirty_commit\|def dirty_commit\|need_commit_before_edits" /d/code/github/aider/aider/coders/base_coder.py
grep -n "lint_edited\|Ran the linter\|Attempt to fix test errors" /d/code/github/aider/aider/coders/base_coder.py
grep -n "raise ValueError" /d/code/github/aider/aider/exceptions.py                    # 依赖错误类漂移断言
grep -n "lower_bound\|upper_bound\|best_tree" /d/code/github/aider/aider/repomap.py     # 预算二分
grep -n "falling back to memory cache" /d/code/github/aider/aider/repomap.py
grep -n "lazy_comments\|chat_hashes\|--replay" /d/code/github/aider/benchmark/benchmark.py
grep -n "pct_diff_children" /d/code/github/aider/benchmark/refactor_tools.py
grep -n "auto_env_var_prefix\|MarkdownHelpFormatter" /d/code/github/aider/aider/args.py
```

## 9. 建议行动顺序

1. **立即**（P0，各半天量级）：§3.3 畸形产出计数（与既有断路器共用 fold 骨架，先只加判据种类）→ §3.4 配置面 codegen（`config.json` 无生成器是已核实缺陷）。
2. **先量再改**（P0，需要实测背书）：§3.1 cache 保活 ping——先用 `script/session-efficiency.ts --json` 量出「审批/长工具间隙导致的 TTL 过期」在真实会话里到底占多少成本，再决定默认值；**记账口径（`source: "cache-warm"`）与代码同批提交**，否则违反 `doc/usage-stats.md` 的不虚构原则。§3.2 编辑后验证闭环——先与我方确认「验证属于循环还是属于模型」这个架构取向，再落通道形状。
3. **下一批**（P1，需设计）：§4.1 侧任务模型路由（从 `title` 起，`compaction` 待实测 cache 影响）→ §4.3 预算二分（先在压缩面替换百分比阶梯）→ §4.2（先复核非 worktree 路径是否真会混提交）。
4. **大件，需排期与共识**：§4.5 评测闭环，且严格分两步——先建出版本库里的成功判据台账，再谈把结论编译进 `model-compatibility.ts`。
5. **暂缓（需产品决策）**：§4.4 文件内 `AI!` 协议、§6 表里的客户端遥测采样。
6. **随手**：§7 的 1、2；§7 的 3 先做一次核对我方现状。
