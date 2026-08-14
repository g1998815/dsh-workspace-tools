# dsh-workspace-tools 插件设计文档

- **日期**：2026-08-14
- **状态**：已确认（用户逐节审批通过）
- **类型**：DSH（DeepSeek Harness）第三方插件
- **位置**：`/Volumes/data/code/dsh-workspace-tools`（与 `dsh_desktop` 同级，独立 git 仓库）
- **目标平台**：macOS + Windows

---

## 1. 背景与目标

DSH Desktop（Electron 壳，仓库 `dsh_desktop`）把 DSH 的 Web GUI 封装为桌面应用。用户希望在 GUI 上补充三个面向本地代码开发的工具能力，且明确要求**以 DSH 插件的形式实现**（不修改 DSH 上游源码、不 hack Electron 壳层）。

三个功能：

1. **Git Diff**：查看工作区代码文件的修改 diff。
2. **文件浏览器**：侧边栏浏览工作区文件，右键提供"复制绝对路径 / 发送到对话框"。
3. **控制台**：底部可开关、可多开、类 VS Code 的交互式 shell 终端面板。

目标：三功能共享同一套插件地基（host 服务 + client UI + RPC + 安装脚本），可独立验证、跨平台可用、不侵入 DSH 上游。

## 2. 需求确认（决策记录）

### 2.1 Git Diff

| 项 | 决策 |
|---|---|
| 入口形态 | **变更列表 + 文件 diff**（类 VS Code 源代码管理）：侧边栏"变更"页签列出所有变更，点文件看 diff |
| 变更范围 | **所有变更，含未跟踪文件**（`git status` 语义；`??` 未跟踪文件也列出，点击显示全文"全新增"diff） |
| 基线 | 工作树 vs HEAD；暂存区差异**合并进修改显示**，不单独分组 |
| diff 渲染 | 自定义轻量渲染：统一格式（unified），行号 + 红绿高亮（加/删/上下文行）；**side-by-side 列为后续可选项** |
| 刷新策略 | 切换工作区时刷新 + 手动刷新按钮 + 展开时刷新；**文件监听（watch）列为后续** |

### 2.2 文件浏览器

| 项 | 决策 |
|---|---|
| 入口 | 侧边栏"文件"页签（与"会话 / 变更"三页签并列） |
| 根目录 | 当前工作区 cwd；**切换工作区 → 重新挂载树** |
| 读取方式 | host `workspaceFs` 服务，client **懒加载**子目录（展开时请求），避免大目录卡顿 |
| 浏览模式 | **只读**：不做内容预览/编辑、不做文件操作（新建/重命名/删除/Finder 集成全部不做） |
| 隐藏规则 | 默认隐藏 `.git` 目录与 `.DS_Store`（规则跨平台统一） |
| 右键菜单 | 仅两项：**复制绝对路径**（系统剪贴板）、**发送到对话框**（相对路径插入对话输入框） |
| 空态 | 无工作区/目录不存在时显示提示文案 |

### 2.3 控制台

| 项 | 决策 |
|---|---|
| 类型 | **交互式 shell 终端**（PTY 驱动，可输入命令），非日志视图 |
| 位置 | 插件**自绘底部面板**（DSH 框架无底部面板）：flex 布局 + 可拖拽高度，标题栏开关按钮"点击出现/再点关闭"；侧边栏底部另设一个同步状态的快捷入口按钮 |
| 多开 | 标签栏 + "+" 新建按钮，每标签一个独立 PTY 会话 |
| 默认 shell | macOS：`$SHELL`；Windows：探测 `pwsh` → `powershell.exe` → 回退 `cmd` |
| cwd | 新建时 = **当前工作区根目录**；每个控制台**独立保持自己的 cwd**，切换工作区不影响已有标签 |
| 关闭 | SIGTERM → 超时 SIGKILL 兜底（复用 `dsh-terminal` 的 awaited cleanup） |
| 异常退出 | 标签显示退出码，可一键重开 |
| 渲染 | `@xterm/xterm` + `@xterm/addon-fit`，esbuild 打进 client bundle（自包含） |

## 3. 架构总览

### 3.1 插件包结构

```
dsh-workspace-tools/
├── package.json              # 声明 dsh.client.inject、main 入口、peerDependencies
├── lib/index.js              # host 插件（跑在 DSH 服务进程，Node 侧）
│                              #   · gitDiff 服务    —— 执行 git 命令
│                              #   · workspaceFs 服务 —— 列目录/文件信息/读文件
│                              #   · console 服务     —— 复用 dsh-terminal PTY 会话缝
├── src/                      # client 端源码（React 组件：文件树/变更列表/diff/终端面板）
├── client.js                 # client 打包产物（esbuild 产出，注册进 window.__ModuleLoader__）
├── build.mjs                 # esbuild 打包脚本（client 侧自包含依赖）
├── scripts/install.mjs       # 跨平台安装脚本（symlink / junction + cordis.patch.yml）
└── test/                     # node:test 单测（host 服务为主）
```

### 3.2 双端职责划分

- **host 端**（Node，运行于 DSH 服务进程）：一切有副作用的操作——git 执行、fs 读取、PTY 会话。通过 `dsh-client-connection` 的 RPC（`call`/`request`）暴露给浏览器端。
- **client 端**（浏览器）：全部 UI。通过 `dsh-client-ui-slots` 挂载组件；调用 host 服务走 RPC；复制绝对路径用 `navigator.clipboard`（`http://127.0.0.1` 为安全上下文，用户手势触发可写）；"发送到对话框"走 `ctx.inputTriggers` 的 composer 插入机制（不 hack DOM）。

### 3.3 安装 / 开发流程

1. `npm install`（插件依赖；DSH 相关为 peerDependencies，运行时从 profile 的 `node_modules` 解析）。
2. `node build.mjs` 产出 client 包。
3. `node scripts/install.mjs`：
   - 把插件链接进 `~/.dsh/profiles/node_modules`（macOS/Windows 详见 §7）。
   - 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加 `- insert: { id: dsh-workspace-tools, name: 'dsh-workspace-tools' }`（与现有 MCP 挂载方式一致，幂等：已存在则跳过）。
4. 重启 DSH 服务生效；client 侧开发可依赖 `dsh-client-hmr` 热更新，host 侧改动需重启。

### 3.4 UI 挂载策略（关键约束）

- DSH 主框架为**三栏结构**：`sidebar`（左）/ `conversation`（中）/ `details`（右）；**无内置底部面板**；`ctx.layout` 只管理 sidebar/details 开合（`toggleSidebar/openDetails/closeDetails`）。
- **侧边栏**：`sidebar` slot 由 `dsh-client-ui-sidebar` 声明，children slot 含 `sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action` 等。插件自绘"会话 / 文件 / 变更"三段切换条（类 VS Code 活动栏语义）挂入侧边栏体系，三个面板各自独立。
- **底部控制台**：框架无底部面板 → 插件自绘（flex + resize handle + 开关按钮），状态由插件自身管理。
- **发送到对话框**：复用 input-trigger 的 controller 插入（`ctx.inputTriggers`），光标处插入相对路径。

## 4. 功能一：Git Diff（详情）

### 4.1 host 服务 `gitDiff`

以工作区 cwd 为根执行，全部 `git` 命令带 `-c core.quotepath=false`（中文/特殊文件名可读）：

- `listChanges(cwd)`：`git status --porcelain -z` → 变更清单（状态码 + 路径），未跟踪（`??`）也返回。
- `getDiff(cwd, file, { untracked })`：
  - 已跟踪修改：`git diff -- <file>`（工作树 vs HEAD，含暂存区差异合并显示）。
  - 未跟踪文件：读全文，构造"全新增"diff（模拟 `git diff --no-index /dev/null <file>` 的语义）。
  - 删除文件：`git diff -- <file>` 输出删除行。

### 4.2 client 变更视图（侧边栏"变更"页签）

- 文件列表：状态徽标（`M` 修改 / `??` 未跟踪 / `D` 删除），按目录分组，可折叠。
- 点击文件 → diff 详情：
  - 自定义轻量渲染器：unified diff，行号 + 红绿高亮（加/删/上下文行）。
  - 未跟踪文件显示完整内容（全新增视图）。
- 刷新：切换工作区刷新 + 手动刷新按钮 + 展开时刷新。

## 5. 功能二：文件浏览器（详情）

### 5.1 host 服务 `workspaceFs`

- `listDir(cwd, relPath)` → 目录项数组：`{ name, isDir, size, mtime }`，client 懒加载。
- `resolvePath(cwd, relPath)` → 绝对路径（用于"复制绝对路径"）。
- 复用策略：实现期确认 host 侧是否已有可复用的 fs 服务（如 `ctx.fs` / `dsh-fs`）；有则优先复用，否则用 `node:fs/promises` 自实现（保持只读操作）。

### 5.2 client 文件树（侧边栏"文件"页签）

- 根 = 当前工作区 cwd；**工作区切换 → 重新挂载**。
- 目录优先、可折叠；文件类型图标（少量常见类型区分，默认通用图标）。
- 默认隐藏 `.git`、`.DS_Store`。
- 点击文件仅选中（只读）。

### 5.3 右键菜单（两项）

- **复制绝对路径**：`navigator.clipboard.writeText(绝对路径)`。
- **发送到对话框**：相对路径（相对工作区 cwd）→ `ctx.inputTriggers` controller 插入当前对话输入框（光标处）。

## 6. 功能三：控制台（详情）

### 6.1 host 服务 `console`

复用 `dsh-terminal`（"Persistent PTY session seam"：owner-scoped ids、backend registry、interactive sends、reads、signals、awaited cleanup）：

- `create({ cwd })` → 会话 id（owner = 本插件，与 agent 的 bash 工具互不干扰）。
- `write(sessionId, data)` / `resize(sessionId, cols, rows)` / `kill(sessionId)`。
- stdout/stderr 流经 `dsh-client-connection` 流式 RPC 回推 client。

### 6.2 client 终端面板

- 底部面板：自绘、可拖拽高度；标题栏含开关按钮 + 标签栏 + "+" 新建。
- 每标签一个 `@xterm/xterm` 实例（`@xterm/addon-fit` 自适应），esbuild 打进 client bundle。
- 会话生命周期：新建（默认 shell + cwd=工作区根）→ 交互 → 关闭（SIGTERM → SIGKILL 兜底）；异常退出显示退出码，可重开。
- 每控制台独立保持 cwd。

## 7. 跨平台设计（macOS / Windows）

`process.platform` 分支集中在少数点，业务逻辑与平台无关：

| 关注点 | macOS | Windows |
|---|---|---|
| 默认 shell | `$SHELL`（默认 zsh） | 探测 `pwsh` → `powershell.exe` → 回退 `cmd` |
| 路径 | `node:path`（join/relative/sep）统一处理 | 同左（`path.win32` 语义由 node 自动处理，不硬编码 `/`） |
| 安装脚本链接 | `symlink` 进 `~/.dsh/profiles/node_modules` | 目录 **junction**（`mklink /J`，免管理员权限） |
| profile 路径 | `~/.dsh/profiles/web/`（`os.homedir()` 拼接） | 同左（`%USERPROFILE%\.dsh\profiles\web`） |
| git 可用性 | 系统自带/常见 | 需 Git for Windows 在 PATH；缺失时给出明确报错（结构化错误） |
| 剪贴板 / 输入插入 | 浏览器 API，无平台差异 | 同左 |
| PTY | `dsh-terminal`（node-pty） | 同左；实现期验证 Windows 后端行为（PowerShell 交互兼容性） |

## 8. 错误处理

- host 服务统一返回结构化错误 `{ code, message }`：
  - `git-not-found`（git 不在 PATH）、`not-a-repo`（非 git 仓库）、`fs-permission`（权限不足）、`dir-not-found`（目录不存在）、`shell-not-found`（默认 shell 探测失败）等。
- client 侧渲染为**面板内联提示**（文案，不弹系统框）。
- PTY 异常退出不视为错误：标签内显示退出码。

## 9. 测试策略

- **框架**：`node:test`（与 `dsh_desktop` 的 `dsh-process` 测试同风格）。
- **host**：
  - `gitDiff`：临时 git 仓库（init + commit + 修改文件 + 新增未跟踪文件）验证 status/diff/未跟踪/删除路径。
  - `workspaceFs`：临时目录验证 listDir（含隐藏规则、懒加载契约）。
  - `console`：验证 spawn / write / exit 生命周期与清理（SIGTERM → SIGKILL 兜底）。
- **client**：核心逻辑抽为纯函数（变更清单解析、相对路径转换、shell 探测顺序），单测覆盖。
- **跨平台**：shell 探测顺序与安装脚本的路径逻辑做纯函数化测试；Windows 真机验证列为验收项。

## 10. 里程碑

每步可独立验证：

- **M1 骨架 + 服务**：插件包结构、`build.mjs`、`scripts/install.mjs`（跨平台）、host 三服务 + 单测；命令行验证服务可调用。
- **M2 文件浏览器**：侧边栏三段页签 + 文件树（懒加载）+ 右键菜单两项。
- **M3 变更 + diff**：变更列表 + diff 渲染（含未跟踪全文视图）。
- **M4 控制台**：底部面板 + 开关 + 多标签 PTY 终端。

## 11. 非目标（YAGNI，明确不做）

- 文件复制/粘贴、新建/重命名/删除、在 Finder/资源管理器中显示。
- 文件内容预览与编辑。
- 暂存区/未暂存区分组（合并显示）。
- side-by-side diff（列为后续可选项）。
- git 文件监听/watch（手动刷新 + 工作区切换刷新）。
- 日志输出视图（控制台仅交互式终端）。
- 修改 DSH 上游源码或 Electron 壳层。

## 12. 实现期待确认的开放问题

进入实现计划前需在插件仓库内快速验证（不影响本设计的正确性）：

1. **侧边栏挂载点**：`sidebar` slot 的 children 槽位具体名称与挂载方式（自绘三段切换条应挂哪个槽；或注册新的 keyed entry）。
2. **输入插入 API**：`ctx.inputTriggers` controller 插入 composer 的确切调用方式（注册 trigger source vs 直接调用 insert）。
3. **PTY owner 语义**：`dsh-terminal` 的 owner-scoped 会话如何由第三方插件注册 backend 并创建会话。
4. **fs 复用**：host 侧是否已有可复用的 fs 服务（`ctx.fs` / `dsh-fs`），决定 `workspaceFs` 是复用还是自实现。
5. **client 包装载契约**：`dsh.client` 声明字段（inject 列表）与 `/plugins/<id>/client.js` 的提供路径，外部插件如何对齐（参照现有 `dsh-client-ui-*` 的 package.json）。
6. **工作区 cwd 获取**：client 如何拿到当前活动工作区 cwd（host `dsh-workspace` 服务 RPC vs client 侧事件/会话对象）。
7. **Windows PTY**：`dsh-terminal`/node-pty 在 Windows 的 PowerShell 交互兼容性验证。

## 13. 调研到的 DSH 能力清单（复用依据）

| 能力 | 包 | 用途 |
|---|---|---|
| PTY 会话缝（spawn/读写/信号/清理） | `@deepseek-ai/dsh-terminal` | 控制台 host 服务 |
| client↔host RPC | `@deepseek-ai/dsh-client-connection` | client 调 host 服务 |
| slot 挂载体系 | `@deepseek-ai/dsh-client-ui-slots` | 组件挂入布局 |
| 布局/面板控制 | `@deepseek-ai/dsh-client-ui-layout` | sidebar/details 开合、三栏结构认知 |
| 输入触发/composer 插入 | `@deepseek-ai/dsh-client-ui-input-trigger` | "发送到对话框" |
| 工作区（cwd） | `@deepseek-ai/dsh-workspace` | 文件树根、控制台初始 cwd |
| 插件注册 | `~/.dsh/profiles/web/cordis.patch.yml` + profile node_modules | 安装机制 |
| client 模块加载 | `@deepseek-ai/dsh-client-modules`（`window.__ModuleLoader__`） | client 包装载 |
