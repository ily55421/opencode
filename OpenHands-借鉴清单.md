# OpenHands（Agent Canvas）借鉴清单

- 分析时间：2026-11-01
- 来源仓库：`D:\code\github\OpenHands`（分支 `main`，HEAD `80ddd49ef`，`package.json` version `1.34.0`，`config/defaults.json` `versions.agentCanvas: 1.34.0`）
- 对照仓库：本仓 `loop-reliability-docs` @ `81738639df`，版本 `2.2.0-fork.10`
- **本文只做分析，未改任何代码。**
- 证据分级：**[对方实测]** = 本轮我直接在 OpenHands 文件里读到并复述其内容；**[实测]** = 本轮我亲自打开本仓该文件并复述；**[子代理]** = 子代理报告、我未逐行复核（动手前必须复核）；**[UNVERIFIED]** = 搜索范围不足以断言存在或不存在。
- 对账声明：已与 adm / kimi-code / codex / cline / gemini-cli / aider / goose / codewhale / ZCode / oh-my-pi / reasonix / dsh-superagent 十二轮及合并稿 `借鉴技术方案-cline-gemini.md`（L 号）逐项对账。**已在他轮立项的主题在第三节撤下**并注明在哪一轮；第四节是本轮明确不学；第五节是本轮实测对本仓的补充（其中两条是本仓缺陷，不是借鉴项）。

---

## 一、结论框架

**1. 这个仓库不是你以为的那个 OpenHands。** 本地这份是 `@openhands/agent-canvas` —— OpenHands 的**前端产品**（React Router 7 + React 19 + Tailwind 4 + HeroUI + zustand + TanStack Query + Monaco + xterm，外加一个 Electron 壳和一组 Node 编排脚本）。agent 循环、压缩算法、安全分析器、成本计算、模型目录全在兄弟仓（`openhands-software-agent-sdk`、`agent-server`，Python）里，经 `@openhands/typescript-client@1.59.0` 进来，**本仓看不到**。所以本轮的对照面只有两层：

- **客户端产品形态**（事件渲染、面板、composer、通知、主题、i18n、a11y）—— 对我们 `packages/app` / `packages/desktop` / `packages/tui` 直接可比。
- **工程纪律与交付编排**（版本单一真源、契约守卫测试、mock-LLM 端到端、桌面打包、CI 闸门）—— 可比。
- **不可比**：session loop、durable 事件、权限折叠、上下文经济学。这些我们的模型更完整，对方在本仓根本没有这一层。**任何"它的 loop 比我们好/差"的判断都是无据的**，本文不做。

**2. 真正值钱的只有三件事。** 逐条核完之后的排序很陡：

- **桌面/后端版本纪律**（OH-1）。我们这块是**已知痛点**且**实测有静默采纳**：`packages/desktop/src/main/service/cli-version.ts` 在 `mode === "reconnect"` 时直接 `return undefined`，任何在跑的 CLI 版本都被接受。对方用「一个 JSON 真源 + 构建期守卫 + 启动期下限断言 + 三个稳定错误码」把同一件事钉死。这是本轮唯一的 P0。
- **反向工具契约**（OH-4）。让**前端把 UI 交给模型操作**，配一套「结果回灌 + 重放幂等栅栏 + 密钥永不带值」的协议。我们已经有半条腿（TUI 侧 client-hosted MCP），缺的是把它变成能力面。这是本轮唯一的新方向。
- **交付纪律的几个小机关**（OH-8/OH-9/OH-11）：自写 AST 规则守分层、主题跨渲染器穷举映射、mutation 测试"先 report-only 不设阈值"。每条都是几十行的事。

**3. 其余大多是"我们已有更强形式"。** 对方的审批只有整次动作 accept/reject、没有 per-tool 规则、没有 always-allow（我们 M1/M3/L19/L21 已立项，比它完整）；对方的乐观消息靠**发送文本 trim 后当 key** 匹配回显（我们用客户端铸造的 item id + 幂等准入）；对方的压缩完成判定是**前端猜**（监听 `Condensation` 事件 + 等 2.5s 指标沉降），我们走 `session.compaction.*` durable 事件 + `NOTHING_TO_COMPACT` 显式无操作。这些不列为借鉴项，只在第四节留下它们**踩过的坑作为反面证据**。

**4. 两条是本仓缺陷，顺手记下来。** 第五节的 (a) `source: "title"` 的辅助调用成本不进任何报表、(b) i18n 各语种字典的类型约束两套混用（部分语种 `satisfies Partial<...>` 允许缺键），都不是"要不要学 OpenHands"，是"对照时照出来的自己的洞"。

---

## 二、可借鉴项（按 价值/代价 排序）

### OH-1 后端版本的单一真源 + 启动期下限断言 + 版本不符必须可见 【P0】

**它的机制** [对方实测]

- `config/defaults.json` 是唯一真源，逐字段带注释：`versions.agentServer: "1.59.0"`、`versions.agentCanvas: "1.34.0"`、`compatibility.minimumAgentServer: "1.59.0"`。同一个文件被 `bin/agent-canvas.mjs`、`scripts/dev-*.mjs`、`docker/entrypoint.sh` 和 CI 一起读。
- `scripts/check-sdk-version-sync.mjs` 校验本地 `@openhands/typescript-client` 的 pin 必须**等于** `versions.agentServer`，并且用 `/^[0-9]/` **拒绝任何 range**（注释：range 会重新引入这个检查要抓的 skew）；再去拉 PyPI 的 `requires_dist` 校验 automation 包的四个 SDK 依赖一致。`sdk-version-sync.yml` 每 6 小时 cron 跑一次，另收兄弟仓的 `repository_dispatch`。
- `src/api/agent-server-compatibility.ts`：启动时 `GET /server_info`（5s 超时）→ `assertAgentServerVersionIsSupported` → 抛三种各带稳定 code 的错误（`AGENT_SERVER_UNSUPPORTED_VERSION` / `UNKNOWN_VERSION` / 不可用），全部继承同一基类，所以 `src/root.tsx` 只有一个阻塞分支。**版本解析失败/`"unknown"` 当作失败，不当作通过。** 自带无依赖的 semver 比较，预发布顺序正确（`1.47.0 > 1.47.0-rc.2`），有专门的 prerelease 测试。缓存 `{info, host}`，host 变了或被拒绝时清空。
- 守卫测试断言"打进包里的 pin"与"兼容性下限"必须一致，两者漂移就红。

**我们的现状** [实测]

- `packages/desktop/src/main/service/cli-version.ts`：`if (input.mode === "reconnect") return undefined` —— 重连场景**不要求版本**，任何在跑的后台服务都被采纳；只有非 reconnect 且非隔离 beta 才返回 `input.version`。
- 不匹配时的替换路径（`packages/client/src/service.ts` 的 `EnsureReason "version-mismatch"`、`packages/client/src/service-probe.ts` 的 `decide`）只有 `Effect.logInfo`，**没有用户可见提示，`doc/` 里也没有桌面 CLI 版本这一节**（`grep doc/` 无命中）。
- 这正是记忆里已经付过学费的坑（同版本桌面构建复用旧暂存 CLI，覆盖安装后后端未更新，须手工替换并重启服务）。我们现在的规避手段是"每次本地发布都 bump `N`"，那是**流程约定，不是机械保证**。

**落点**：`packages/desktop/src/main/service/cli-version.ts`（重连也要校验，失败降级为"警告 + 可用"而非静默通过）、`packages/client/src/service.ts`（把 `EnsureReason` 提上来给 UI）、新增一个构建期守卫（`packages/desktop` 的 `resources/opencode-cli.version` 必须等于根 `package.json` version），以及 `doc/` 里补一节桌面版本解析（按 `doc/conventions.md` 的 change map 定位）。

**代价**：小-中。三处改动 + 一节文档；`opencode-cli.version` 已经在 `extraResources` 的 filter 里 [实测]，所以构建期守卫几乎是免费的。

**验收**：故意让暂存 CLI 与打包 CLI 版本差一个 prerelease，`opencode service status` 与桌面首屏都要显示不一致；守卫测试在 `resources/opencode-cli.version` 被改成别的值时红。

**风险**：fork 版本永远不等于上游（`agents.md` Version Numbers），所以校验必须是**区间/下限**而不是"等于 latest"，否则每次检查都报更新、`auto` 策略会把 fork 换成上游二进制。对方的教训正好是反向例子：它把下限和 pin 钉成同一个数 `1.59.0`，我们**不能**照抄这个耦合。

---

### OH-2 桌面自带/至少明确诊断 stdio MCP 所需运行时 【P0-】

**它的机制** [对方实测]

`electron/main.mjs` 有两段带注释的 PATH 注入：`injectBundled uv`（`process.env.PATH = binDir + sep + PATH`，按 `process.arch` 选 `bin-<arch>` 以支持 universal 构建）和 `injectBundled Node`。Node 那段的注释写得很直白——打包成 `.app` 后系统 PATH 极小，用户在配置里写 `command: "npx"` 的 stdio MCP 服务器会 ENOENT，SDK 只能报一个含糊的连接失败。dev 模式**故意 no-op**（用户终端本来就有 PATH），找不到时"大声 warn 且不动 PATH"，让失败模式保持可解释。`electron-builder.config.mjs` 用 `extraResources` 把 `resources/{bin,node}` 一起打进包。

**我们的现状** [实测 + 子代理]

- `packages/desktop/electron-builder.config.ts` 的 `extraResources` 只带 `["opencode-cli", "opencode-cli.exe", "opencode-cli.version"]` [实测]；`packages/desktop` 全目录 `grep` 无 `npx`、无 `process.env.PATH` 赋值 [实测]。
- `packages/desktop/src/main/lifecycle/environment.ts`：`preferApplicationEnvironment` 在 `process.platform === "win32"` 时把 shell 置 `null`，**Windows 不做 shell 环境探测** [实测]；macOS/Linux 靠 `loadShellEnv` 合并登录 shell 环境，所以 nvm 装的 node 一般还在。
- 子代理报告：MCP local 走 `packages/core/src/mcp/stdio.ts` + `CrossSpawnSpawner`（`cross-spawn`，Windows 能解 `npx.cmd` 垫片），缺命令时 ENOENT→`NotFound`→`ConnectError`→ status `failed`，`/mcps` 与 `opencode mcp list` 会带 stderr 尾 [子代理，动手前复核]。

**落点**：**不抄"打包 Node"**（体积 + 与 Bun 单文件 CLI 的职责重叠）。抄它的**第二半**——把"命令找不到"变成有名字的诊断：`packages/core/src/mcp/stdio.ts` 的失败分类里加一条 `runtime-missing`（ENOENT 与"命令存在但退出码非零"分开），`/mcps` 对话框和 `opencode mcp list` 给出可操作文案（"PATH 里没有 npx；桌面版从 Windows 注册表 PATH 取值，nvm/fnm/volta 装的 node 不在其中"）。这正好接在 OH-10 的分类改造上，同一个 PR 组。

**代价**：小。**验收**：配一个 `command: "npx -y 不存在的包"` 与一个 `command: "绝对不存在的命令"`，两者状态与文案要不同。

**风险**：`[UNVERIFIED]` Windows 桌面版实际是否失败——Explorer 会把 `HKCU\Environment` 的 PATH 合并进 GUI 进程，所以"npx 一定找不到"不成立；真正找不到的是 shell profile 里追加的条目。**动手前先在本机实测一次桌面 + npx MCP**，别按这条清单直接改。

---

### OH-3 反向工具：前端把 UI 交给模型，配重放幂等栅栏 【P1，新方向】

**它的机制** [对方实测，部分子代理]

- `src/api/canvas-ui-client-tool.ts` 等四个文件定义 `ClientToolSpec{name, description, parameters, annotations{readOnlyHint, destructiveHint, idempotentHint, openWorldHint}}`，在 `buildStartConversationRequest` 里**随启动载荷下发**给服务端（`agent-server-adapter.ts`，仅特定 agent kind）[对方实测（annotations 与下发点见文件；调用点为子代理报告）]。
- 动作事件名由 SDK 生成 `ClientAction_<tool-name>`；WS 收到后在浏览器侧执行真实副作用（切 tab、打开文件、开预览）。
- 结果回传**没有正规通道**：`services/client-tool-result.ts` 把结果作为带前缀的 `user` 消息回灌，聊天里靠 `should-render-event.ts` 的 `isClientToolResult` 把原文隐藏 [子代理]。
- 真正值得抄的是 `src/utils/claim-client-tool-call.ts` [对方实测]：`claimClientToolCall(ledgerKey, toolCallId)` 用 localStorage 记账，已 claim 返回 `false`，**账本 JSON 损坏时不阻塞调用、起新账本**（注释写明）。它挡的是 `resend_mode: "all"` 重连和 REST/WS 竞态造成的非幂等重复执行。
- `src/services/secret-request.ts` [对方实测]：回传给模型的结果只有 `{status, name, guidance}` 三态（`saved` / `not_saved` / `error`），**永不含值**；`not_saved` 的 guidance 原文是"用户关掉了表单没保存。问他要怎么走；**绝不要让他把密钥贴进聊天**"。
- `scripts/runtime-services-info.mjs` [对方实测]：把"本机哪些服务/端口在跑"生成 `<RUNTIME_SERVICES>` 块，经 `/server_info.runtime_services` → 前端 → agent 系统提示，让模型**不用探测就知道能连什么**；注释里拒绝"把未校验的值原样写进系统提示"。

**我们的现状** [子代理，动手前必须复核]

- TUI 已有 `ClientMcp`（`packages/tui/src/context/client-mcp.tsx`）通过 `connectClientMcp` → `MCP.attach` 挂一个 client-hosted MCP 服务器 `tui`，只暴露 `open_terminal` / `write_terminal` 两个工具。
- GUI 侧插件契约 `Browser.open/openFile`（`packages/plugin/src/gui/browser.ts`）、`Command`/`Panel`/`Slot`（`registries.ts`）存在，但**没有任何一条被桥成模型可见的工具**。
- 幂等栅栏我们**已有更好的形式**：`packages/app/src/shell/notifications/coordinator.ts` 的 `claim`（Set + localStorage 500 条 + Web Locks 跨 tab），由 `notification.tsx` 传入 `event.id`。

**落点**：把 GUI 的既有前端能力（切面板、打开文件、定位到某个事件、预览端口）经同一套 client-hosted MCP 机制暴露出来，而不是新造协议；`packages/core/src/mcp/index.ts` 的 attach 路径 + `packages/plugin/src/gui/*`。**必须一次带三件**：工具 annotations（决定它进哪个权限档）、幂等 claim（复用 notification coordinator 那套）、结果回灌走**合成 inbox 项/控制项而不是假 user 消息**。后一点是我们的架构比对方强的地方——`agents.md` 里"Reusing a user or synthetic inbox item ID is idempotent…Cross-Session or cross-type reuse fails"已经把对方用文本前缀隐藏回灌结果的那个妥协从根上消掉了。

**代价**：中-大（安全面）。**验收**：重连后同一 `toolCallId` 不重复执行；模型能打开一个文件；用户能在权限面板里看到这些工具属于哪个档。

**风险**：`doc/permissions.md` 的档位语义要为"UI 写操作"新增分类，不能直接塞进现有 filesystem 档；`runtime-services` 那半截（把端口写进系统提示）会撞 codex 轮已立项的 L17/L34 prompt-cache 确定性纪律——**清单文本必须字节稳定**，否则每次会话首条都失效。

---

### OH-4 事件组的"当前动词 → N/M 完成"两段式摘要 【P1，小】

**它的机制** [对方实测]

`src/components/conversation-events/chat/group-events.ts`：`EVENT_GROUP_MIN_SIZE = 2`，FinishAction / ThinkAction / MessageEvent / TaskTrackerObservation / markdown artifact / 错误都是**组断点**。`event-message-components/event-group.tsx` 的注释把两种形态写死了：组还是**live tail**（`isFinalized=false`）时主位显示当前动作标题、副位显示 `"{completed}/{total} actions completed"` + 右侧 spinner；一旦被后面的条目"超过"（`isFinalized=true`），`"{count} actions completed"` **升为主位**并带成功勾。另有"思考提升"规则：带 reasoning 的可分组事件会先冲刷当前组、自己单列成一个 `thought` 项，**保证推理不会被折进折叠组里消失**。

配套 `src/components/features/chat/typing-indicator.tsx` 的 `deriveLiveActivity(events)` [对方实测]：纯函数，反向遍历事件、用 `resolvedActionIds.add(event.action_id)` 解出唯一未回答的动作，兜底 `"Thinking…"`，渲染成 `role="status"` 的活体提示——**不需要后端支持**。

**我们的现状** [子代理]

TUI 已有 `packages/tui/src/routes/session/grouping/session.ts` 的 `GroupKind`（`activity|reasoning|exploration|instructions`）与 `completed`，`activity-summary.ts` 的 `summarizeActivity`/`activitySummary` 产出 "3 commands, 1 edit, 2 reads"、`busyLabel` 产出 "Running command…" —— 是**分类计数**，不是 **k/n 进度**。GUI 只有 `todo-pill.tsx` 有 N/M。

**落点**：`packages/tui/src/routes/session/activity-summary.ts` 与 `group-view.tsx`（以及 `packages/session-ui/src/timeline/activity-chips.tsx`），给未定尾的组加 k/n，定尾后降回单数摘要。

**代价**：小。**验收**：长串工具调用的会话里，跑动中的行显示"已完成 3/7"，过后显示"7 步"。**约束**：`token-speed-requirement` 记忆要求输入框下方 tok/s/缓存命中/上下文必须保留 —— 这条只动组内摘要行，不动状态行。

---

### OH-5 主题跨渲染器穷举映射 + 对比度写成规则 【P1，小】

**它的机制** [对方实测]

`src/themes/README.md`：三套渲染系统必须同时被主题覆盖——**scoped CSS/HeroUI**、**Prism + Monaco**、**xterm**。语法高亮与 Monaco 的映射表是**穷举 `Record<ColorThemeKey, …>`**，README 明写理由："new themes cannot silently inherit a dark palette"（新增主题漏配就编译不过，而不是悄悄继承深色）。xterm 映射覆盖全部 16 个 ANSI 色；CSS 自定义属性**无法**传给 Monaco/xterm，所以它们要具体色值（`getColorThemeCss` + `COLOR_THEME_BOOTSTRAP_SCRIPT` 用同一个生成器做 hydration 前的 head 注入，避免闪烁）。对比度写成硬规则：`focus` 达 3:1、`feedback-*` 达 4.5:1、"字面白色保留给特定用途"。5 套命名调色板（3 dark + light-plus + solarized-light）。

**我们的现状** [实测 + 子代理]：本仓主题走"运行时派生缺失 token"——`packages/theme/src/tui/expand.ts` 的 `expandTheme`、`packages/ui/src/theme/v2/resolve.ts` 的 `mapV2Semantics`/`mergeV2Tokens` 兜默认值（子代理报告，我未逐行读）；GUI 主题 JSON 由 `desktop-theme.schema.json`（`additionalProperties: false`）校验 [实测存在，schema 文件由子代理指出]。`packages/desktop/src/main` 里 `grep` 无 `prefers-color-scheme`/`color-scheme` 注入 [实测]，所以"跟随系统主题"是否有 hydration 前的闪白路径，**未确认**。近期刚加了 Indigo 主题与 rail 主题切换（`82efecf`/`3558c4c`），正是这条最贴合的时候。

**落点**：给内置主题加一个**穷举守卫测试**——新增 `ColorThemeKey` 或新增 v2 token 时，若任一内置调色板/任一渲染器（Monaco、终端色）没配就红；这与 `agents.md` 的 TUI Theme Tokens 规则（"缺 token 就先扩 schema/defaults/resolution/types，不许挪用相近 token"）是同一件事的**机械化版本**，现在只靠人自觉。

**代价**：小。**验收**：临时在 `indigo.json` 删一个必需 token，守卫测试要红。

---

### OH-6 依赖方向与契约禁令用自写 AST 规则 + 守卫测试双保险 【P1，小】

**它的机制** [对方实测]

- `src/api/no-direct-agent-server-calls.test.ts` 递归走 `src/`，用若干正则禁掉所有"手写 HTTP"（裸 `axios(`、`fetch('/api/`、`new HttpClient(`、深 import SDK 的 http-client），违规输出 `"path: reason"` 人话；豁免是**相对路径 allowlist**（3 个文件）而不是散落的 `eslint-disable`；排除 mocks/生成物；`relative(...).replace(/\\/g,"/")` 专门处理 Windows 路径分隔符。配套散文规则在 `src/api/README.md`："缺端点就先去 `@openhands/typescript-client` 加，别在前端手写"。
- **并且**在 `eslint.config.js` 里自带一条 AST 规则 `local/no-direct-agent-server-fetch`（`createNoDirectAgentServerFetchRule()`，`eslint.config.js` 注册为 `"error"`），实现里会**展开 `TemplateLiteral` 的 quasis 求静态 URL**——补上正则抓不到的模板字符串绕过。

**我们的现状** [实测]：`agents.md` 写了分层方向（Schema → Core/Protocol → Core+Protocol → Server；Client 只依赖 Schema 和 Protocol），也有 `bun script/doc-refs.ts` 这类形态守卫，但**没有机械强制的分层/依赖方向检查**（ZCode 轮第五节已自我更正过一次：只有 GUI 侧有 oxlint）。

**落点**：本轮不提供新立项，只给**机制**——把 ZCode 轮记下的那条缺口用「一条守卫测试 + 一条自写 lint 规则」实现；`script/doc-refs.ts` 的现成形态可以直接套（同样的文件遍历、同样的人话违规串、同样处理 Windows 分隔符）。

**代价**：小。**验收**：在 `packages/client` 里 import 一个 `@opencode/core` 符号，检查要红。

---

### OH-7 受影响测试选择 + 工具链自身也要测 【P1】

**它的机制** [对方实测，规模数字来自子代理]

- `tests/e2e/mock-llm/test-mapping.json`（`$schema` 字段自述用途）+ `scripts/resolve-affected-tests.mjs`：源码 glob → e2e 子目录，**改了 spec 也解析回所属功能目录**。
- `__tests__/scripts/` 有约 43 个"工具链自身"的测试（`docs-version-sync`、`docker-script-imports`「Dockerfile 漏 COPY 即失败」、`electron-builder-config`、`lint-staged-portability`、`inline-styles-lint` 等 lint-the-lint）；`ci-script-tests.yml` 给 CI 脚本跑 pytest，**并把 workflow 里 `script:` 的原文交给 `.cjs` 测试**。
- `docker/smoke-test.sh`：容器起来后轮 `/health`，再观察 `STABLE_SECONDS=30` 秒稳定窗口，然后断言 `/server_info` 报告的版本**和** `importlib.metadata` 读到的系统 Python 版本都等于发布 pin，最后 `pip check`。脚本头注释直接引 issue 号说明"单测抓不到漏 COPY"。
- mock LLM 是真后端 + 假模型：`tests/e2e/mock-llm/scripts/mock-llm-server.py` 带管理 API（`/admin/reset`、`/admin/trajectory/register|activate`、`GET /admin/requests` 可断言实际请求体），`PREFLIGHT_PING_TEXT="ping"` 让 profile 预检不消耗剧本，`ERROR_MAP` 把 SDK 异常映射成 401/429/408/503。

**我们的现状** [实测 + 子代理]：`turbo.json` + `bun turbo test --affected` 是**包粒度**；`.github/workflows/check-test.yml` 用 `turbo ls --affected --filter=...` 门 e2e；`script/lint-changed.ts` 只做 changed→oxlint；无 CI-脚本自身的测试。构建侧我们其实**已有等价物**（codewhale 轮"保存前 patterns 预览"、`bun run check`），缺的是 `defaults.json` 那种**单一版本真源**（OH-1）和"编排脚本自身有测试"。

**落点**：两个小件，各一个 PR：(a) `file → test subset` 的映射表，覆盖 `packages/app/e2e` 与 `packages/stories`；(b) 给 `script/*.ts` 和桌面 `pack`/`stage` 脚本加自测（尤其是 `script/pack.ts` 与 `.github/release/tag-release.sh`——它们重写全 workspace 版本号，出错静默且难归因）。

**代价**：中（(a) 需要维护映射表）。**验收**：只改 `packages/tui` 时 e2e 不启动。

---

### OH-8 mutation 测试以 report-only 起步（**对账更正**） 【P2，但要改既有结论】

**它的机制** [对方实测]：`stryker.config.mjs` 只 `mutate: src/**`，排除测试/`.d.ts`/`.types.ts`/`.gen`/`declaration.ts`/fixtures/mocks/dev，开 `vitest.related: true`（只跑相关测试），**完全没有阈值**；文档明说"report-only，先建立基线"。`scripts/stryker-diff.mjs` 用 `git diff --name-only base...HEAD` 过滤生产文件后 `stryker run --incremental --force --mutate <files>`；进程边界处用 `// Stryker disable all`。三个 script：`test:mutation` / `:diff` / `:incremental`。

**对账**：合并稿/优势清单曾以「覆盖率、mutation、SBOM、PR-size 门 **三家都没有** → 不算相对劣势」撤下这条。**本轮事实推翻了撤下理由**（OpenHands 有，且是无阈值的低成本形态）。撤下结论本身可以保留，但**理由要改**：不再是"没人有"，而是"我们有 `fast-check` 属性测试和语料防自欺守卫（reasonix 第 5 项），mutation 的边际收益取决于前两者抓不到的那类变异"。这是本轮唯一一次对既有轮次的**事实性更正**，按 `agents.md`「发现文档与事实不符的人负责改」的取向，应写进台账而不是悄悄改掉。

**落点**：如果做，就照它的低成本姿势——**不设阈值、不接 CI、先只跑 `packages/core/src/session/stats.ts` 这类纯折叠代码**，用 diff 模式。

---

### OH-9 MCP 探测结果的诚实分类 【P2】

**它的机制** [子代理；`src/api/mcp-health/` 我未逐行读]：手写 module store 且**故意不落 localStorage**（"健康判定只和探测一样新鲜"）；`beginMcpHealthCheck` / `resolveMcpHealthCheck(checkId)` 组成单调栅栏，慢的旧探测不能覆盖新探测，被编辑/删除的服务器的过期结果丢弃；`probe-mcp-server-health.ts` 用正则把被误分类成 connection 的 401/403/invalid-token **重标为 credentials**；`verified` 只有当 catalog 声明的**只读探针工具真的被广告且调用未出错**才成立，否则诚实标 `connectivity-only`。

**我们的现状** [子代理]：`packages/core/src/mcp/index.ts` 的 `Status` 有 `pending|connected|failed|needs_auth|disabled`，`NeedsAuthError` 已把 auth 与 connection 分开，有 `watch`/`recover`，UI 面是 `/mcps` 与 `opencode mcp list`。**缺**：并发探测的过期结果栅栏、"connected 但一个工具都没暴露"这类诚实分级、周期 ping、任一 UI 里的 per-server 工具列表。

**落点**：`packages/core/src/mcp/index.ts` 状态机 + `/mcps` 对话框；和 OH-2 的诊断分类同组做。

---

### OH-10 面板拖拽期间的全屏 shield 【P2，先复现】

**它的机制** [子代理；`src/hooks/use-resizable-panels.ts` 我未读]：拖拽时注入一个全屏 `aria-hidden` 的 shield div（z-index 200），理由是 iframe/Monaco/xterm 会**吞掉 mousemove**；拖拽期间把 `transitionProperty` 设 `none`，结束后恢复；`LayoutGroup` 的 `motion.button layout="position"` 在拖拽时通过 `suppressLayoutAnimation` 抑制。另有 `use-breakpoint` **只在跨越断点时重渲染**（注释：避免拖拽期间逐像素抖动）。

**我们的现状** [实测]：`packages/ui/src/components/resize-handle.tsx`（115 行）用 `document.addEventListener("mousemove"/"mouseup")`，文件里**没有 shield 层、没有 pointer capture、没有拖拽期禁 transition** 的痕迹。是否真出问题取决于拖拽路径下是否有 iframe/webview 或原生控件——**[UNVERIFIED]**，先按 `gui-validation-expectations` 的纪律在真实窗口复现（拖过去会不会卡住）再决定。

**落点**：`packages/ui/src/components/resize-handle.tsx`。代价小，但**必须先有复现**。

---

### OH-11 i18n 完整性用生成 enum + 拒绝"英文原样复制" 【P2】

**它的机制** [对方实测]：`src/i18n/translation.json` 是 `2207 键 × 16 语种`（本轮用 node 数过）；`scripts/make-i18n-translations.cjs` 既扇出 `public/locales/<lng>/<ns>.json`，又**生成 `src/i18n/declaration.ts` 里的 `export enum I18nKey`** —— 每次 `t()` 的键都是编译期校验；`scripts/check-translation-completeness.cjs` 挂在 lint-staged 上，既查缺语种，又**拒绝把英文原样复制进其它语种**，例外必须进 `IDENTICAL_VALUE_ALLOWLIST`（品牌/技术串）；`eslint-plugin-i18next` 的 `no-literal-string` 以 `mode: "jsx-only"` 开启，连 `aria-label`/`placeholder` 都查。

**我们的现状** [实测]：我们**已有 i18n 框架**（这点和很多轮的"全系列零项"记录相反，需要更新台账）：`packages/ui/src/i18n/*.ts` 约 60 个语种文件、`packages/app/src/runtime/i18n/*`、`packages/desktop/src/main/native/translations.ts`。但键约束**两套混用**：`packages/ui/src/i18n/no.ts` 是 `export const dict: Record<Keys, string>`（缺键编译失败），而 `bs.ts`、`de.ts`、`tr.ts`、`am.ts` 等是 `satisfies Partial<Record<Keys, string>>`（**缺键静默回退**）。TUI 完全没有 i18n，界面串是英文字面量。

**落点**：不是"引入 i18n"（已有），而是把 `Partial` 那批统一到穷举 `Record<Keys, string>`，并加一条"缺译 vs 原样复制英文"的完整性检查。范围很小，是纯 lint 级改动。**不提议做 TUI i18n**——那需要 OpenTUI 侧的字形宽度处理，CJK 计费那条已落地，但界面翻译不是本轮的事。

---

## 三、与既有轮次对账后撤下的项（不再推荐）

| 本轮看到、但不另立项 | 归属 | 说明 |
|---|---|---|
| 依赖发布冷却与供应链闸门（`AGENTS.md` 把"发布后等满 7 天"写成硬规则 + Dependabot `cooldown.default-days: 7` + `npm install --min-release-age=7` + 自动 bump Debian snapshot） | **codex M2** | 供应链那一轮已立项。本轮只补一个事实：这条纪律**同时写进 AGENTS.md 和 CI**，是"双写"的范例，可作为 M2 的措辞参照。 |
| 自更新（它**故意不自动更新**，只打 npm `latest` dist-tag + 设置页给出字面命令 `npm i -g` / `docker pull`，两个 tab + 2s "copied"） | **L39** | L39 主张"后台下载 + 下次启动应用 + 回滚"，比它强。本轮价值仅是**决策点 13 的参照**：fork 版本永远不等于上游 latest，对方的"只给命令"恰好绕开了 `auto` 会把 fork 换成上游二进制的坑（`agents.md` Local Release Builds 已记）。不作为独立项。 |
| 分层/依赖方向的机械强制 | **ZCode 第五节**（已自我更正"我方无强制"） | 见 OH-6，本轮只给实现机制，不重立项。 |
| 工具审批规则、per-tool allow、always-allow | **M1/M3、L19/L21/L31** | 对方**更弱**：全局二元 `confirmation_mode` → `NeverConfirm`/`AlwaysConfirm`/`ConfirmRisky{threshold:"HIGH", confirm_unknown:true}`，审批只有"整次动作 accept/reject"，无规则、无持久 allowlist。见第四节反面。 |
| 断线重连与 seq 续传 | **codex §4 判"不学 protocolVersion"、M7-P3 验证性小件** | OH 侧 `createSeqCursor` 的"最高且其下无空洞 + `ahead` 集合 + `MAX_AHEAD=1024`"设计漂亮 [对方实测]，但我们走 `server.connected` 强制 resync + 45s idle watchdog + 全量 refetch，语义更保守。仅作为"先量重连 refetch 成本"的候选，见第七节末位。 |
| 流式增量批处理 | **codex M7-4** | `src/utils/streaming-delta-batcher.ts` [对方实测] rAF 每帧最多提交一次、非 delta 帧前必 `flush()`。M7-4 已判"评估而非照搬（OpenTUI 全量树渲染是架构分叉）"，本轮不改判。 |
| 压缩算法、condenser 阈值、cost 计算、模型目录 | 对方**后端仓**（Python） | 本仓不可见；我们的对应面是 `doc/context-economics.md` + L6/L29/L32。本文不评价不可见的东西。 |

## 四、明确不学

1. **把客户端工具结果当 user 消息回灌、再靠前缀匹配从聊天里隐藏**（`client-tool-result.ts` + `should-render-event.ts`）。它没有正规结果通道才出此下策；我们的合成 inbox 项 + 幂等 ID 规则是结构性解法。参见 OH-3。
2. **靠文本前缀匹配剔除 goal loop 注入的 re-prompt**，注释自承 `Brittle by design` [对方实测：`should-render-event.ts` 的 `GOAL_REPROMPT_PREFIXES`]。
3. **用 emoji 正则检测 agent 自建技能**（`^✅ Successfully installed '<name>'` 匹配 bash 输出）[子代理]。
4. **压缩完成判定靠前端猜**（`use-await-context-compaction.ts`：ack 只代表"已开始"，于是等 `Condensation` 事件 + 等 2.5s 指标沉降 + 90s 超时判失败）。它的**问题意识值得学**（"ack ≠ 完成"，baseline 必须在 POST **之前**取），但我们有 `session.compaction.started/delta/ended/failed` 与显式 `compaction.unavailable`，**不需要猜**。只把那条注释纪律（baseline 的取点顺序）作为参考。
5. **未连接时把消息暂存在前端内存**（`heldMessagesRef`，socket 打开后 flush，按序列化 JSON 去重）[对方实测存在，语义为子代理]。我们的 `session.inbox` 是 durable 行，"admit 与 execute 分离"是写下的决定；把待发消息留在内存里会丢掉可恢复性。
6. **事件账本 O(n²)**：`appendEvent` 每事件 `new Set(state.eventIds).add(id)` [子代理]。以及 metrics 聚合逻辑**两份实现**（REST 版 `utils/conversation-metrics.ts` 与 WS 版内联 reduce，注释自承是 Python `get_combined_metrics` 的等价物）。
7. **收了不显示**：类型里有 `reasoning_tokens`、`LLMMetrics.costs[]`、`token_usages[]`、`response_latencies[]`，但 `reasoning_tokens` 在整个 `src/` 里只出现在类型声明那一行 [实测：单次命中]。协议面先行扩张而读模型不跟进，正是我们 `agents.md`「enrich projections and read models」要避免的半成品形态。
8. **审批无规则、无 always-allow**，只有 accept/reject 整次动作；被拒后 `UserRejectObservation` 保留原 action 于 transcript。我们的四出口拒绝措辞（L3）与折叠代数更强。
9. **长对话不做虚拟化**，只靠后端分页 + `preserveScrollPosition` 补偿。我们是长跑 TUI + 桌面，不能照这个取舍。
10. **`as unknown as PluginsManagementClient` 绕过未发布的 SDK 方法** [子代理]，与"缺端点就去 SDK 加"的自家 README 规则冲突。
11. **banner 重试按钮靠错误文案字符串相等判断**（`onRetry` 仅当 `message === SERVER_CONNECTION_ERROR_MESSAGE`）[子代理]。
12. **`/goal` 无人值守 judge 循环**（`GoalStatus{iteration,max_iterations,verdict{score,complete,missing}}`）。与 dsh §5 撤下的理由同源：无人值守前提与我们交互式交付正交；我们的 step allowance + todo nudge + loop guard 已在 `doc/session-loop.md` 定型。
13. **打包 Node 进桌面包**（见 OH-2，只借诊断，不借体积）。
14. **2207 键 × 16 语种的全量翻译投入**。我们要的是它的**约束机制**（OH-11），不是它的规模。

## 五、本轮实测对本仓的补充（不是借鉴项，是照出来的自己的洞）

**(a) `source: "title"` 的辅助调用成本不进任何报表** [实测]

`packages/schema/src/session-event.ts` 的 `UsageRecorded` 是 `source: Schema.Literals(["title", "compaction"])`；`packages/core/src/session/title.ts` 确实按 `source: "title"` 发布用量。但 `packages/core/src/session/stats.ts` 里**唯一**读 `UsageRecorded` 的那趟查询带着 `sql\`json_extract(...,'$.source') = 'compaction'\`` 过滤——`title` 的行既不进 `totals.tokens`/`totals.cost`（那趟查询是 totals 的唯一补充来源），也不进 `activity`。`doc/usage-stats.md` 只写了"`tokens` also folds … whose `source` is `compaction`"，**没有任何一句说明 title 被排除**。

这不属于"要不要学 OpenHands"，属于我们自己的账单诚实性纪律缺口（合并稿 L 系与 `doc/usage-stats.md` 的 `not_recorded` 取向同源）。落点：要么并进 totals 并按 `doc/usage-stats.md` 写清"不进日点云"，要么显式命名为 `not_recorded` 并解释。验收：`packages/core/test/session-stats.test.ts` 已发布一条 `source: "title"` 的 0.5 USD 事件，断言里加它的去向即可。OpenHands 的对照价值：它按 `usage_to_metrics` 的**任意 key**聚合、`condenser` 与 `profile:<name>:<uuid>` 分账都并入总额，`context_window`/`per_turn_token` 取 `Math.max` [对方实测：`src/utils/conversation-metrics.ts`]——即"辅助调用的钱一定进总账"。

**(b) 重连静默采纳任意后端版本，且无文档** —— 已并入 OH-1，此处只是把它记成**本仓事实**而不是"对方的做法"。

**(c) i18n 键约束两套混用（`Record<Keys,string>` vs `satisfies Partial<Record<Keys,string>>`）** —— 已并入 OH-11。另需更正既有台账：**"i18n 全系列零项"这句话已经过时**，本仓 GUI/desktop 有完整 i18n 框架，缺的是 TUI 与完整性执法。

**(d) `resize-handle.tsx` 无拖拽 shield** —— 已并入 OH-10，**待复现**，不作为结论。

## 六、本轮未能升级为 [实测] 的项（动手前必须复核）

- **本仓**：`ClientMcp` 只暴露 `open_terminal`/`write_terminal`（OH-3 的现状半边）；`expandTheme`/`mapV2Semantics` 的运行时兜底细节（OH-5）；MCP `Status` 状态机与 `/mcps` 的具体分类文案（OH-9）；`activity-summary.ts` 是否已有 k/n（OH-4）；notification `claim` 的 500 条与 Web Locks 语义（OH-3 的复用面）。
- **对方**：`use-resizable-panels.ts` 的 shield 实现细节与 z-index 取值（OH-10）；`mcp-health-store.ts` 的 checkId 栅栏代码（OH-9）；`mock-llm-server.py` 的管理 API 与 `ERROR_MAP`（OH-7）；`client-tool-result.ts` 的回灌是否真的走 user 消息（OH-3/四.1）；`.agents/skills/` 九个 skill 的 frontmatter 触发短语写法（第八节给了枚举命令，值得和我们的 `.opencode/skills` 对照一次）。
- **[UNVERIFIED]**：Windows 桌面版 `npx` 类 stdio MCP 的实际可用性（OH-2 的风险条）；Electron 首屏是否有主题闪白（OH-5）。

## 七、建议动手顺序

1. **OH-1 桌面版本纪律**（含第五节 (b)）。P0，且是我们已经付过学费的坑；先做构建期守卫（`opencode-cli.version` == 根 version），再做 reconnect 校验 + 用户可见提示，最后补 `doc/` 一节。
2. **第五节 (a) title 成本落账**。实测已定，纯补洞，一个 PR 带测试和文档。
3. **OH-6 分层守卫测试 + 自写 lint 规则**。小、独立、立刻减少一类回归。
4. **OH-5 主题穷举守卫** + **OH-11 i18n 键约束统一**。都刚好处在 Indigo 主题/rail 切换刚落地的窗口期。
5. **OH-4 事件组 k/n**（TUI + GUI）。先复核第六节列的现状两条。
6. **OH-2 + OH-9 同一 PR 组**（MCP 失败分类 + 探测诚实分级）。**先在本机实测桌面 npx MCP 到底会不会失败**，再决定是否只补诊断。
7. **OH-3 反向工具**。唯一的新方向，也唯一需要先做权限档位设计（挂 M1/M3 的结论）；**必须先复核** `ClientMcp` 与 GUI 插件契约的现状。回灌走合成控制项，不许抄假 user 消息。
8. **OH-7 受影响测试映射 + 工具链自测**（`script/pack.ts`、`tag-release.sh` 优先）。
9. **OH-10 shield** —— 有复现才做。
10. **OH-8 mutation** —— 只做本地 diff 模式、不设阈值、不接 CI；并把第三节"三家都没有"的撤下理由改写成有据版本。

## 八、复核命令

```sh
# 对方：版本单一真源 + 拒绝 range + 打包 pin 等于下限
grep -nE 'agentServer|minimumAgentServer' D:/code/github/OpenHands/config/defaults.json
grep -nE 'range|versionsEqual' D:/code/github/OpenHands/scripts/check-sdk-version-sync.mjs
# 对方：重连游标的空洞栅栏
grep -nE 'MAX_AHEAD|ahead|highest' D:/code/github/OpenHands/src/utils/session-seq-cursor.ts
# 对方：客户端工具幂等记账 + 密钥永不带值
grep -nE 'claim|localStorage' D:/code/github/OpenHands/src/utils/claim-client-tool-call.ts
grep -nE 'status|guidance|never' D:/code/github/OpenHands/src/services/secret-request.ts
# 对方：事件组两段式摘要 / live activity 纯函数 / 重复事件不触发副作用
grep -nE 'EVENT_GROUP_MIN_SIZE' D:/code/github/OpenHands/src/components/conversation-events/chat/group-events.ts
grep -nE 'isFinalized|actions completed' D:/code/github/OpenHands/src/components/conversation-events/chat/event-message-components/event-group.tsx
grep -nE 'deriveLiveActivity' D:/code/github/OpenHands/src/components/features/chat/typing-indicator.tsx
grep -nE 'isDuplicateEvent' D:/code/github/OpenHands/src/contexts/conversation-websocket-context.tsx
# 对方：主题三渲染器穷举 + i18n 生成 enum + mutation 无阈值 + 分层禁令
grep -nE 'exhaustive|Monaco|xterm|Prism' D:/code/github/OpenHands/src/themes/README.md
grep -nE 'declaration|enum' D:/code/github/OpenHands/scripts/make-i18n-translations.cjs
grep -nE 'mutate|related' D:/code/github/OpenHands/stryker.config.mjs
grep -nE 'local/no-direct-agent-server-fetch|TemplateLiteral' D:/code/github/OpenHands/eslint.config.js
# 对方：桌面 PATH 注入与打包内容
grep -nE 'PATH|npx|node' D:/code/github/OpenHands/electron/main.mjs

# 我方：重连不校验版本 / 只打包 CLI / Windows 不探 shell env / title 成本不进报表 / i18n 两套约束
grep -nE 'reconnect|stageName' D:/code/opencode/packages/desktop/src/main/service/cli-version.ts
grep -nE 'extraResources' -A5 D:/code/opencode/packages/desktop/electron-builder.config.ts
grep -nE 'win32|loadShellEnv' D:/code/opencode/packages/desktop/src/main/lifecycle/environment.ts
grep -nE "source|compaction" D:/code/opencode/packages/core/src/session/stats.ts
grep -nE 'UsageRecorded|Literals' D:/code/opencode/packages/schema/src/session-event.ts
grep -nE 'folds.*source.*compaction' D:/code/opencode/doc/usage-stats.md
grep -rnE 'satisfies Partial<Record<Keys' D:/code/opencode/packages/ui/src/i18n
# 我方：resize 无 shield
grep -nE 'addEventListener|mousemove' D:/code/opencode/packages/ui/src/components/resize-handle.tsx
```
