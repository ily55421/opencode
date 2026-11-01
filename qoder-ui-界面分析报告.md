# Qoder CN UI 界面分析报告

> 分析对象:Qoder CN 0.4.11(stable,win32-x64,Electron 43.1.1,build 82468212,2026-10-23 构建)
> 分析范围:`C:\Users\dds\AppData\Local\Qoder CN\Qoder CN Launcher`(外置 Launcher)与 `C:\Users\dds\AppData\Local\Programs\Qoder CN`(主程序安装目录,含 181 MB 的 `resources/app.asar`,已全量解包)
> 方法:asar 解包 + 渲染层/主进程 minified 代码静态检索 + 资源目录盘点;文中判断均给出可复查的证据路径,推测项已标注"(推断)"

---

## 1. 一句话结论

Qoder CN **不是** VS Code fork,而是一套**完全自研的 React 19 "Agent 工作台"**(官方自述 "Agent workbench for human and AI software teams"):渲染层由 Vite 打包的 560 个 chunk 组成,样式层是 Tailwind CSS v4 加一套约 425 个混淆命名的自有语义 token 和 10 套主题;除主工作台外还有灵动岛、桌宠、实时语音悬浮窗、独立速记板等多窗口 Surface 体系;更新走"外置 .NET Launcher + 双版本目录 + pending-asar 原子切换"的方案。

---

## 2. 安装目录结构

### 2.1 外置 Launcher(`AppData\Local\Qoder CN\Qoder CN Launcher`)

| 文件/目录 | 说明 |
|---|---|
| `Qoder CN Launcher.exe`(131 KB) | C#/.NET 程序集(二进制含 `Qoder.Space.WindowsLauncher` 元数据与阿里云代码签名证书),不是 Go/Rust/Tauri |
| `install.ini` / `state.ini` | schemaVersion=3;记录 `installDir`、`appExecutable`、`targetVersion=0.4.11`、`status`(idle/healthy) |
| `state.ini.writers/` | 写者锁协调目录(文件级互斥,当前为空) |
| `i18n/zh-CN.properties`、`en-US.properties` | Launcher 全部 UI 文案,仅 12 个键,覆盖 7 种状态:更新中 / 更新未完成恢复 / 应用缺失 / 启动失败 / System 更新向导等待 / System 恢复 / 安装失败 |
| `launcher-diagnostics.log` | 滚动日志,阶段为 `process_started → context_loaded → mutex_checked → process_exited`(code 71 = 已有实例) |

Launcher 职责:互斥体 `Local\QoderSpaceWindowsLauncher-qoder-cn` 防多开;CLI 参数 `--apply-update=`、`--query-state-lock-owner`、`--sync-installed-version`(协议版本 `QODER_LAUNCHER_PROTOCOL=5`);维护 NSIS 安装标记与"更新修复标记";广播 `WINDOWS_LAUNCHER_STATE_CHANGED` 命名事件。更新等待窗口是一个 520×260 的沙箱 BrowserWindow(见 `out/main/index.js`,该文件做了字符串混淆)。

### 2.2 主程序(`AppData\Local\Programs\Qoder CN`)

```
Qoder CN.exe                     225 MB(Electron 壳,含 0.4.11)
resources/app.asar               181 MB(应用本体,解包后 271 MB / 7132 个文件)
resources/app.asar.unpacked/     原生模块(sharp 等)
resources/extensions/            10 个内置插件(见 §7)
resources/bundled-resources/     首启静默安装包(逐文件 sha256 清单 + archives)
resources/dynamic-text/          服务端可热更的 UI 文案 qoder-cn.json(模型标签等)
resources/fast-update/           快速更新基线(逐文件 sha256)+ Authenticode 签名校验器 trust.exe
resources/launcher/              安装目录内置的同版本 Launcher 副本
resources/bin/                   原生插件:.node(DJI 麦克风按钮、剪贴板、通知权限)+ 截图修饰键监控
resources/node-repl/             @ali/node-repl + browser-use SDK 沙箱运行时
resources/qoder-helper/          内置 Agent 技能包(SKILL.md + evals)
resources/native-messaging-host/ 浏览器扩展 Native Messaging 宿主
resources/umid/                  阿里设备指纹/风控 SDK(sgsdk.dll 7.3 MB)
resources/tray/、application-icons/  托盘与应用图标(含 qoduck 鸭子彩蛋图标)
.qoder-versions/0.5.1/           完整新版本副本(待切换,pending)
.qoder-update/downloads/         已清空的下载缓存
```

asar 内部:`out/main`(主进程)、`out/preload`(3 个 cjs)、`out/renderer`(UI 本体)、`node_modules`(运行时依赖)。`package.json` 确认技术栈:React 19.2、Tailwind 系的 design-system、framer-motion 12、gsap 3、@tanstack/react-virtual、xterm 6、shiki 4、i18next 25、pdfjs-dist、mammoth/xlsx(Office 解析)。

---

## 3. 进程与渲染层架构

### 3.1 进程模型

| 进程/入口 | 文件 | 体积 | 说明 |
|---|---|---|---|
| 主进程 | `out/main/electronMain.js` | 17.8 MB | **未混淆**,可读;窗口工厂、托盘、协议、utilityProcess 分发 |
| 主进程辅助 | `pluginHost.js` / `dataDirectoryProcess.js` / `remoteControlProcess.js` / `remoteSdkDaemonBridge.js` | 小 | utilityProcess 子进程;dataDirectoryProcess 有字符串混淆 |
| 预加载 | `out/preload/index.cjs` + `pluginViewRuntime.cjs`(2.6 MB)+ `pluginViewDiagramRuntime.cjs`(3.4 MB) | 6.2 MB | IPC 桥;两个大 cjs 是插件视图沙箱(内含 React、echarts、mermaid、KaTeX) |
| 渲染层 | `out/renderer/index.html` + `assets/`(560 JS + 11 CSS + 874 webp + 59 woff2/woff + 20 ttf + 42 svg) | 86.8 MB | Vite 构建,入口 `DYPmN0NN.js`,最大 chunk `Cux9x6wn.js` 15 MB(主工作台) |

### 3.2 渲染层入口与 Surface 路由

`index.html` 是手写引导页(202 行,含完整内联 CSS):CSP 白名单 + 自绘 boot splash。splash 是一个 72px 的 logo 线稿(`assets/qoder-loading-line-Bq9ip4M2.svg` 作 CSS mask),叠加"呼吸 + 高光扫过"双层动画,跟随 `prefers-color-scheme`,并尊重 `prefers-reduced-motion`。HTML 注释解释了两处工程决策:img-src 放行外站图片是给外链预览;**故意不写 `<title>`,否则 Electron 会忽略各窗口的 title**。

入口按 URL 查询参数 `?surface=` 分发,并写入 `document.documentElement.dataset.surface`:

| surface 参数 | 独立 CSS | 用途 |
|---|---|---|
| (默认) | index-*.css | 主工作台 |
| `first-launch-onboarding-overlay` | FirstLaunchOnboardingSurface(18 KB) | 首启沉浸引导(身份卡/角色揭示,带 overlaySafe{Top,Right,Bottom,Left} 安全区) |
| `live-voice-overlay` | LiveVoiceOverlay(37 KB) | 实时语音悬浮字幕窗 |
| `desktop-pet` | DesktopPetSurface | 桌面宠物 |
| `dynamic-island` | DynamicIslandSurface + DynamicIslandPanel | 灵动岛式伴飞 HUD |
| `companion-activity` | CompanionActivitySurface | 宠物/伴飞的任务状态横幅 |
| `quick-note-window` | QuickNoteWindow | 独立速记板窗口 |
| `onboarding-role-reveal-demo` | OnboardingOverlayDemo | 引导动画演示(开发用) |

### 3.3 主进程窗口清单(4 处 BrowserWindow 工厂 + overlay 服务)

| 窗口 | 关键配置 |
|---|---|
| 主工作台 / Artifact 预览 | workbench 1320×800(min 720×540);artifact-preview 900×700;`show:false` 先建后显;`sandbox:true` + contextIsolation |
| 登录窗 | 690×446 固定尺寸 |
| 语音悬浮 "Qoder Live Voice" | `frame:false, transparent:true, hasShadow:false`,alwaysOnTop + skipTaskbar + `focusable:false`,不节流后台渲染;mac 上为 panel 类型 |
| 速记板 "Quick Notes" | 400×720(min 320×600 / max 480×800),alwaysOnTop;win 用 `backgroundMaterial:"mica"`,mac 用 `vibrancy:"sidebar"` + 自定义红绿灯位置 |
| 数据迁移进度窗 | 520×260,`sandbox:true`,index.js 混淆保护 |
| 灵动岛 / 桌宠 / 伴飞横幅 | 走 overlay/surface 服务体系(companionOverlayService、dynamicIslandService),标题 "Qoder Desktop Pet"/"Qoder Companion Activity" |

另有 2 类 `WebContentsView`:懒加载的会话预热视图,和按 URL 管理的内嵌网页视图池(bounds/favicon/导航状态机)。托盘图标支持明暗两套并跟随 `nativeTheme` 切换,Windows 下还有 `qoduck-*-windows.png` 鸭子吉祥物图标(对应内置 `desktop-pet-skill` 插件)。

---

## 4. 主工作台功能域(渲染层证据)

从 15 MB 主 chunk 与 1.1 MB i18n 文件中确认的功能域(**i18n 命中即证据**,中文为界面实际文案):

**会话与智能体**
- 会话即"任务":`newChat:"开始一个新任务"`、欢迎页 slogan **"不止于编程"**
- 输入模式:`goalMode:"目标/Goal"`、`planMode:"计划/Plan"`、spec 模式(`data-chat-composer-spec-mode`)
- **Agent Team**(108 处):多智能体协作,含"队长 Agent",成员分 human/agent 两种 kind;团队名额提示"人和 Agent 共用名额"
- **Subagent**(57 处):`loadChatSubagentTranscript`、`refreshInstalledSubagents`
- **后台代理**(backgroundAgent 137 处)与后台进程面板
- **云端自动化**:定时任务(`cloudAutomation:"创建在自动化任务中运行的定时任务"`,cron 99 处)
- Memory 记忆(界面文案"记忆已更新";有 `Memory · 暂未开放` 灰态)
- 工具审批规则(allow/deny,"配置免审批执行的工具")

**编辑器与工程**
- 编辑器为 **CodeMirror + Shiki**(非 Monaco,monaco 仅 5 处残留引用)
- tab 类型:`file` / `terminal` / `spec` / `review` 等;Spec 即"计划文档"(`newSpec:"Open plan"`、`specOrdinal:"Plan {{ordinal}}"`)
- 代码 Review 面板(reviewEditor/reviewComments,562 处)
- Git **Worktree** 深度集成(328 处,含 worktreeRestore 恢复流程)
- 终端:xterm.js
- MCP 连接器(mcp 599 处)、Skills(248 处)/ Plugins(91 处)市场,"发现 Skills/Plugins/Connectors"

**内容与多窗口**
- **演示文稿编辑器**(presentationEditor,预览/编辑双模式)
- Office/PDF 预览:.NET WebAssembly 版 OfficeReader + pdf.js + 阿里云 IMM WebOffice 域名白名单
- 内嵌可视化(inlineVisualization)、Canvas 画布插件
- 语音:LiveVoice 悬浮窗 + AudioWorklet 采集(`liveVoiceCaptureWorklet`)
- 手机遥控电脑(`mobileAppDownload`)
- CN 特色计费:"China Mobile Token plan"/"消耗移动算力套餐额度"(中国移动云算力)
- SSH 远程开发:主机信任对话框、密码/私钥配置

**设置中心**:General / Models / MCP / Memory / Skills / Plugins / Notifications / Privacy / Update / Account / Team / About Qoder。

### 4.1 i18n 组织

- **单文件内联双语**:`assets/QWhgX92t.js`(1.1 MB)= i18next 核心 + zh/en 全部资源,按模块命名空间组织(acceptEdits、agentWorkspaces、chatTimeline、cloudAutomation、collaborationUi、desktopPet、dynamicIsland、presentationEditor、settings、sidebarView 等 30+),另有内联双语错误码字典(`"102":{actions:[{id:"retry",…}],message:{"en-US":…,"zh-CN":…}}`)。
- 语言选择持久化在 localStorage,并监听 `storage` 事件**跨窗口同步**(速记板等独立窗口因此与主窗同步语言)。
- **服务端热更文案层**:`resources/dynamic-text/qoder-cn.json` 承载可热更的模型标签,当前收录 Auto/Lite/Ultimate/Efficient/Performance 档位与 GLM-5.3、GLM-5.3-Flash、DeepSeek-V4-Pro/Flash、Kimi-K2.7-Code、MiniMax-M3、Qwen3.7-Plus、Qwen3.8-Flash、Cantus 等模型文案(运行时按网关区域选 `gateway.qoder.com.cn` 或 `center.qoder.sh`)。

---

## 5. 设计系统与视觉体系

### 5.1 Token 架构(核心发现)

样式层 = **Tailwind CSS v4 机制层 + 自有语义 token 层**:

1. 机制层:`:root` 定义标准 Tailwind v4 变量(oklch 颜色、`--spacing:.25rem`、`--text-xs`、`--radius-*`、`--ease-*`、`--blur-*`、容器断点),生成 `--tw-*` 运行时变量。
2. 语义层:**425 个 `--qXXXXXX` 混淆命名的自有 token**(主 CSS 中 304 个;混淆应是防第三方主题仿制的有意行为,亦造成可读性代价)。结构分四层:`:root` 机制层 → 共享浅色组/共享深色组(各 157 个)→ 单主题增量块(forest-light 仅 7 个,light-parchment 多达 102 个)→ `data-platform` / `data-forest-noise-background` 修饰层。accent 槽位是 `--q9128fb`。
3. 组件层:少量 `loop-chrome-*` 前缀类(window/shell/sidebar/content/corner + `loop-rich-editor`,窗口 chrome 内部代号 "loop")+ 46 种 `data-*` 状态钩子 + Tailwind 工具类为主体。

### 5.2 主题体系(10 套)

通过 `html[data-theme=...]` 切换,`data-theme$=-dark` 后缀匹配统一处理深色派生:

| 主题 | 主色(取自变量块) |
|---|---|
| light | 绿 #4d9868,中性 #141414/#838280 |
| dark | 通用深色 |
| light-parchment | 陶土橙 #c96442(羊皮纸暖色调,变量增量最大) |
| forest-light / forest-dark | 绿系;深色 accent #8ee5a1;支持 `data-forest-noise-background=on` 噪点纹理,win32 下有专属微调 |
| mint-light / mint-dark | 薄荷绿 #2a7b68 / #75d7b7 |
| bee-light / bee-dark | 蜂蜜渐变壁纸(保留绿 accent);深色 accent #e6ce6a |
| parchment-dark | 暖深色,accent #e79576 |

另有多彩功能色板(粉 #ff7892、黄 #ffe06b、青 #79efd9、蓝 #86a5ff、紫 #d98bff 等)用于 agent/语言/状态标识。主题切换走 **View Transitions API**(自定义 `view-transition-old/new` 动画 + `qoder-theme-transition-fade-*`),并有全局主题过渡淡入淡出兜底。

### 5.3 字体

| 字体 | 用途 |
|---|---|
| Inter + Instrument Sans | 双 UI 无衬线(后者经 @fontsource 打包,多字重 woff/woff2) |
| Crimson Pro | 衬线(标题/仪式感场景) |
| KaTeX(20 族 ttf) | 公式渲染 |
| qoder-seti 文件图标字体 | 文件树图标 |
| 灵动岛专用可变 Inter 字体 | Dynamic Island 独立打包 |
| 等宽栈 | SFMono/Menlo/Consolas 标准栈 |

字体文件共 138 个(59 woff2 + 59 woff + 20 ttf),按族-字重-字符集切片。

### 5.4 动效体系(59 个 @keyframes)

- **滚动渐隐**:6 个 `scroll-fade-*` 用 **CSS scroll-driven animation**(`animation-timeline:scroll`)实现,零 JS。
- **语音浮窗**:30 个 `aura-buddy-*` 声波/光环动画(37 KB 专属 CSS)。
- 聊天:`chat-assistant-avatar-generating`(生成中头像)、`chat-composer-placeholder-enter/exit`、`chat-timeline-scroll-generating-arrow-breath`。
- JS 动画:framer-motion(558 个文件引用)+ gsap + lottie;boot splash 与 logo 用纯 CSS。
- 全局尊重 `prefers-reduced-motion`。

### 5.5 窗口 chrome 与质感

- 无边框自绘:`.loop-chrome-window` + **`corner-shape: squircle`**(Chromium 新特性)+ `data-native-window-corner-profile=large` 控制圆角档位,`workbench-content-corner` 圆角 1rem。
- 无系统 vibrancy;毛玻璃全部用 backdrop-blur 工具类实现;速记板在 win 上额外用系统 Mica 材质。
- 滚动条、行内渐隐遮罩、拖拽区(`-webkit-app-region:drag`)均为自绘。

### 5.6 资产规模

874 张 webp(产品插图/引导图/空态)、42 个 svg、7 个 ico、4 个 wav(音效)、1 个 mp4;图片资产占渲染层体积近半,是这套 UI "重插画、重氛围"风格的物质基础。

---

## 6. Worker 与沙箱(内容渲染栈)

| 组件 | 体积 | 用途 |
|---|---|---|
| `workspaceSyntaxWorker` | 479 KB | Shiki/TextMate 工作区语法高亮 |
| `markdownCodeSyntaxWorker` | 168 KB | 聊天 markdown 代码块高亮 |
| `presentation-render.worker` | 2.73 MB ×2 | PPTX/幻灯片渲染,加载 .NET WASM 版 OfficeReader(`pptxRenderWorker` loader + `office-render-worker.js` 解析 slides/sheets/tables/charts 描述) |
| `pdf.worker.min.mjs` | 1 MB | Mozilla pdf.js |
| `liveVoiceCaptureWorklet` | 0.5 KB | AudioWorklet 语音采集 |
| `pluginViewRuntime.cjs` / `pluginViewDiagramRuntime.cjs` | 2.6 / 3.4 MB | 插件视图/图表沙箱(React + echarts + mermaid + KaTeX) |
| `cpp-*.js` 等语言 chunk | 各 ~0.8 MB | 按语言懒加载的 Shiki grammar |

---

## 7. 插件体系与内置插件

插件清单 `resources/extensions/catalog.v1.json`(schemaVersion=1),10 个内置插件:`qoder.canvas`(Canvas 画布,`file.preview` 位置视图 + `.canvas.tsx` 实时预览)、`qoder.communication`、`qoder.computer-control`、`qoder.desktop-pet-skill`、`qoder.find-extensions`、`qoder.knowledge.center`、`qoder.office`、`qoder.security`、`qoder.sites`。插件 manifest 含 `activationEvents`、细粒度 `permissions`(如 `telemetry.write`、`chat.createSession`、`files.readSessionResource`)、`filePreviewers`、`qoderAgentSdk` 挂载点。另有 `bundled-resources/` 以"ensure-minimum"策略首启静默安装 context-plugin 与 rg.exe。

---

## 8. 更新与启动链路

1. **启动**:`Qoder CN Launcher.exe` → 互斥体检查 → 读 `state.ini`(targetVersion)→ 启动对应版本主 exe → 主进程创建主窗(先 `show:false`)→ 渲染层 boot splash(纯 CSS logo 动画)→ React 挂载 → splash 120ms 淡出。
2. **更新**(双版本 + 原子切换):electron-updater(generic provider `static.qoder.com.cn/qoder-app/releases`)下载 → 校验 → 写入 `.qoder-versions/0.5.1/` 完整副本,新 asar 以 **`app.asar.qoder-pending`** 暂存(`payloadLayout:"pending-asar-v1"`)→ `.qoder-versions/0.5.1.qoder-update-ready.json`(含 archiveSha256)作为切换凭据 → Launcher 负责切换/回滚/修复。`fast-update/` 提供逐文件 sha256 基线 + 自研 Authenticode 校验器,支撑免全量的快速更新通道。
3. **托盘常驻**:明暗双图标 + 鸭子彩蛋图标,菜单含 Open Qoder / Check for Updates / Quit。
4. **深链**:`qoder-cn://` 协议,白名单主机 `qoder.knowledge.center`、`qoder.sites`;监控上报走自定义 `rum-event://` 特权协议(阿里 RUM)。

---

## 9. 安全与工程化观察

**做得好的**
- 渲染层 CSP 完整(`default-src 'self'`;frame-src 仅本地 Surface + Qoder 域 + 阿里云 IMM);所有窗口 `contextIsolation` + `sandbox:true`;will-navigate 全部 deny。
- `prefers-reduced-motion`、滚动驱动动画、View Transitions 等新特性使用激进但都有兜底。
- i18n 跨窗口同步、dynamic-text 服务端热更文案(模型上新无需发版)是聪明的解耦。
- 更新链路有完整的"暂存-凭据-原子切换-修复标记"设计,更新失败路径(含"关闭浏览器再重装"这种 Native Messaging 相关的具体指引)都有专门文案。

**代价与风险**
- 语义 token 混淆(`--q9128fb`)+ 组件内部代号(loop、Cantus)显著提高了第三方扩展/主题生态的可接入性成本。
- 主进程单一 17.8 MB bundle + 渲染层单 15 MB chunk,首包体积大;靠 `show:false` + splash 掩盖。
- 部分入口(index.js)字符串混淆,增加崩溃排障难度(诊断日志也只到 stage 级)。
- umid 设备指纹 SDK 与 RUM 常驻上报,隐私敏感用户需在设置里关闭对应项。

---

## 10. 可迁移的设计点(供参考)

1. **Surface 路由模式**:单 renderer 入口 + `?surface=` 参数 + 独立 CSS per surface,同一套主题/token 复用到灵动岛、桌宠、速记板等所有窗口,值得借鉴。
2. **`?surface=` 窗口特征表**:主窗 1320×800、速记板 400×720(320×600~480×800)、登录 690×446 固定,以及 per-platform 材质(win: mica / mac: vibrancy)。
3. **Token 四层结构**:机制层 → 共享明暗组 → 单主题增量 → 平台/纹理修饰,新主题只需增量变量(forest-light 仅 7 个)。
4. **CSS scroll-driven animation 做滚动渐隐**、View Transitions 做主题切换,均无 JS 成本。
5. **双版本 + pending-asar 原子更新**与 **dynamic-text 服务端热更文案**。

---

## 11. 实际界面校验(运行截图对照)

依据两张 0.4.11 实际运行截图(任务对话页、欢迎页)对上文代码推导做 ground-truth 校验。

### 11.1 代码证据 ↔ 实际界面 确认项

| 代码证据(§引用) | 实际界面中的呈现 |
|---|---|
| `welcome:"不止于编程"`(§4) | 欢迎页主标语,下挂"在 <项目> ∨ 用 Qoder ∨ 创造了不起的事物"双下拉 |
| `mobileAppDownload:"手机遥控电脑"`(§4) | 欢迎页顶部胶囊入口 |
| 侧栏底部 站点/自动化/扩展(§7 插件) | 左侧栏底部四个入口:站点、自动化、扩展、更多 —— 与 `qoder.sites`、cloudAutomation、extensions 插件一一对应 |
| Skills/MCP(§4) | 右栏"技能与 MCP"分区,带"5条建议"徽标与技能清单 |
| 产出/来源(session resources,§4.1) | 右栏"产出"(wsl_install_log.txt 等)与"来源"(image.png)分区 |
| dynamic-text 模型文案(§4.1) | 输入区模型选择器"DeepSeek-Flash 最大"(模型标签 + 档位) |
| `agentToolRules` 审批规则(§4) | 输入区红色"完全访问"权限芯片(带警告三角) |
| LiveVoice 语音(§3.2) | 输入框占位文案"长按鼠标语音输入文字" + 麦克风/声波按钮 |
| 会话统计(§2 `@arms/rum`、usage) | 欢迎页"会话 / Credits"标签 + GitHub 式年度热力图 |
| worktree/分支(§4) | 状态栏"没有可用的本地分支"、本地/本地模式标识 |
| `applicationMenuService`(§3.3) | 原生菜单栏:文件 / 编辑 / 视图 / 帮助,带前进后退与侧栏开关 |
| 0.5.1 pending 更新(§8) | 侧栏底部用户名旁的蓝色下载角标(更新已就绪) |
| 合规要求 | AI 回复右下角"由 AI 生成"水印(生成内容标识) |

### 11.2 对前文结论的修正

1. **默认观感是暖白亮色**,不是深色 IDE(§5 的 10 套主题中,实际默认落在 light 系,色调整体偏暖,接近 parchment/暖中性灰)。
2. **主 surface 是"任务对话流"而非三栏 IDE**:默认布局 = 左侧任务栏 + 居中对话流 + 右侧上下文面板 + 底部输入区;编辑器与终端不在默认视口(应在其它视图状态或宽屏布局出现,与 §3.2 的多 Surface 设计一致)。
3. **右栏内容**是"上下文卡片(带更新时间与摘要)+ 技能与 MCP + 产出 + 来源",不是 Agent Team 成员列表(Agent Team 入口在别处)。
4. 左侧栏按**项目分组**组织任务(文件夹图标 + 项目名 + 缩进任务项),顶部有"编程"模式芯片(旁有一个第二模式图标);§4 的"任务即会话"得到印证。
5. 窗口 chrome 是**原生菜单栏 + 系统标题按钮**,自绘程度低于 §3.3 代码所暗示的水平;`loop-chrome` 圆角体系应主要用于独立 Surface(灵动岛、速记板等)。

> 概念架构示意(按代码还原的三栏工作台)与实际界面还原图已分别做成两个可交互 mockup:前者见对话中的"Qoder 工作台(架构示意)",后者见"Qoder CN 实际界面还原"。

---

## 附录:关键文件索引

| 内容 | 路径 |
|---|---|
| 渲染层入口 | `out/renderer/index.html`(asar 内,下同) |
| Surface 路由器 | `out/renderer/assets/DYPmN0NN.js` |
| 主工作台 chunk | `out/renderer/assets/Cux9x6wn.js`(15 MB) |
| 设计系统主 CSS | `out/renderer/assets/index-D9GrZPsV.css`(380 KB) |
| i18n 双语资源 | `out/renderer/assets/QWhgX92t.js`(1.1 MB) |
| 主进程 | `out/main/electronMain.js`(17.8 MB) |
| 混淆的迁移进度窗进程 | `out/main/index.js` + `out/main/dataDirectoryProcess.js` |
| 插件沙箱 | `out/preload/pluginViewRuntime.cjs`、`pluginViewDiagramRuntime.cjs` |
| 内置插件清单 | `resources/extensions/catalog.v1.json` |
| 热更文案 | `resources/dynamic-text/qoder-cn.json` |
| Launcher 文案 | `AppData\Local\Qoder CN\Qoder CN Launcher\i18n\*.properties` |
| 待激活新版本 | `.qoder-versions/0.5.1/`(+ `0.5.1.qoder-update-ready.json`) |

*分析缓存:`C:\Users\dds\AppData\Local\Temp\qoder-ui-analysis\app-extract\`(asar 全量解包),复核报告结论可直接查该目录。*
