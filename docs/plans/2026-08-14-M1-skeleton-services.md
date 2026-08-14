# M1 骨架 + 服务 实现计划（dsh-workspace-tools）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 dsh-workspace-tools 插件包骨架，实现 host 侧三个服务（`gitDiff` / `workspaceFs` / `console`）的纯函数核心 + 单测，以及 `build.mjs` 与跨平台安装脚本 `scripts/install.mjs`，并完成命令行 smoke 验证。M1 不实现 client UI（M2–M4 交付）。

**Architecture:** 插件为 DSH（Cordis）第三方插件：host 端以 ESM 模块实现，三个服务的业务逻辑抽为**不依赖 Cordis ctx 的纯函数模块**（`lib/services/*.js`），`lib/index.js` 插件入口负责把它们注册为 Cordis Service 供 RPC 调用。client 端源码暂为空壳，由 `build.mjs`（esbuild）打包为自包含 `client.js`（M1 仅打通构建管线）。安装通过 `scripts/install.mjs` 链接进 profile node_modules 并在 `cordis.patch.yml` 幂等追加 insert 行。

**Tech Stack:** Node.js ≥ 22（ESM，`"type": "module"`）、`node:test` 单测、esbuild（devDependency）、`@deepseek-ai/cordis`（peer）、`@deepseek-ai/dsh-terminal`（peer，console 服务）、git CLI（`-c core.quotepath=false`）。

**设计决策（本计划定稿，覆盖 spec 中的开放点）：**
- spec §4.1 命令修正：工作树 vs HEAD 基线用 `git diff HEAD -- <file>`（`git diff -- <file>` 只含未暂存部分，与 §2.1"暂存区合并显示"矛盾）。
- host 服务业务逻辑尽量纯函数化（接受 `cwd` 参数），插件入口仅做 Cordis 包装 → 单测与命令行 smoke 均不依赖 DSH 运行时；依赖 DSH 服务的部分（console PTY、RPC、WS）采用**依赖注入**，单测传 fake，生产由插件入口注入 ctx 服务。
- 结构化错误统一 `{ code, message }`（spec §8），纯函数以 reject 抛 `{ code, message }` 对象；ctx.fs 的 `FS_*` 错误码在插件入口翻译为插件码。
- 平台分支集中在 `scripts/install.mjs`（symlink vs junction）与 shell 探测（console 服务），业务逻辑与平台无关。

**§12 host 侧验证结论（2026-08-14，子代理 4cffa5fd 报告，源码基线 dsh_desktop node_modules 0.1.0-rc.6）：**
- **PTY 控制台**：不用 `ctx.terminals`（owner=Agent、无 resize、无输出事件、单 active send，属模型面）。正路是 `ctx.subprocess.spawnTerminal({ argv, cwd, env, rows, cols, graceMs, signal })` → `handle`（`output` Readable UTF-8 流、`write(data)`、`signalForeground(sig)`、`terminate()` 内置 SIGTERM→graceMs→SIGKILL 兜底，graceMs 默认 3000ms）。**无 resize API**：spawn 时固定 rows/cols，动态 resize 需 M4 评估 node-pty 直连。
- **流式推送**：`dsh-client-connection` 只有一元 RPC（`connection.rpc.handle(channel, handler, {authority})` / client `call`），无流式；第三方流式基座是 `ctx.webServer.registerUpgrade({path, handler})`（自建 WebSocket，参考 dsh-client-connection 的 WebSocketDownlinks）+ loopback trust 校验（`req.socket.remoteAddress`）。
- **fs 复用**：直接复用 `ctx.fs`（`dsh-fs-sandbox` SandboxedFileSystem，读零拦截；`resolve`/`listDir`（一层懒加载）/`lstat`（symlink 标记）现成）；`.git`/`.DS_Store` 过滤需自实现（`name.startsWith(".")`）；`FsTarget.targetKey` 是不透明 key（存 resolve 结果，不拼字符串）。
- **git**：DSH 无 git 包；git 命令不受 fs 权限策略管辖 → 插件入口须约束 cwd（取自当前 workspace）。
- **Windows**：`spawnTerminal` 在 win32 必抛（`createProcessInspector` 未实现 win32，dsh-subprocess-local/lib/index.js:295-299）→ M1/M4 的 PTY 控制台在 Windows 不可用（真机验证列为验收项；绕开 seam 直连 node-pty 为 M4+ 备选）。gitDiff/workspaceFs 不受影响（纯 Node/git CLI）。

**§12 client 侧验证结论（2026-08-14，子代理 1dc9c01c 报告，基线 0.1.0-rc.6）：**
- **sidebar 挂载（M2 用）**：`sidebar` slot 由 dsh-client-ui-sidebar 声明，children 三孔：`sidebar.workspaces`（single/root，大浏览区）、`sidebar.settings`（single）、`sidebar.footer.action`（list）。三段切换条（会话/文件/变更）注册进 **`sidebar.workspaces`** 且 **`priority: -1` 必须**（shipped ui-workspace 为默认 0；single 孔同 priority 重复注册直接 throw；数字越小越先渲染=遮蔽 shipped browser）。页签内容自绘/自管理（无框架 tab 语义）。
- **输入插入（M2/M3 用）**：右键插入推荐 `inputActions.setDraft(draft + path + " ")`（`useInput()` 标准 hook 读 `{draft, draftRev}`；setDraft 走完整 machine 事务、无 CAS、一次 undo 步）；或官方事件路径 `ctx.sessions.scope(sessionId)` → `actx.bail(actx, "slash/input-insert-text", { text, span: { start, end, draftRev } })`——**span 必须带当前 draftRev 否则 CAS 拒绝**（返回 true/false 判断）。caret 未发布（只在编辑器 DOM），"光标处插入"需插件读 composer DOM 或退化为追加末尾。
- **client 包契约（Task 1/2 已落地）**：`dsh.client` = `{ platform: "web"（必填）, inject: string[]（仅加载/预取元数据）, immediately?: boolean }`，**无 entry/main**；束路径走 `exports["./client"]`；加载协议 `GET /plugins/<id>/client.js?rev=` → `window.__DSH_BOOT__` → `window.__ModuleLoader__.load({id, factory})`；factory 内 require 只认 seed(react)+图内 client 包（全部 peer + external）。
- **cwd 获取（M2 用）**：host 服务名 **`ctx.workspaceRegistry`**（`ctx.workspace` 不存在）+ `ctx.sessions.get(id)?.header.cwd`；client 侧 `useSessions(s => s.byId[s.current]?.cwd)` + `useWorkspaces`（snapshot store 自动投影 `host/workspace-changed` 等帧，组件自动重渲染）；host 无"当前活动工作区"概念 → host 服务签名显式传 cwd。

## Global Constraints

- 仓库位置：`/Volumes/data/code/dsh-workspace-tools`（独立 git 仓库，本计划的全部改动都在此目录内）。
- 目标平台：macOS + Windows；`process.platform` 分支集中，业务逻辑平台无关（spec §7）。
- 不修改 DSH 上游源码、不修改 `~/.dsh/profiles/web/cordis.yml`（该文件为空列表，注释明确"Edit cordis.patch.yml, not this file"）；只追加 `cordis.patch.yml`，幂等（已存在则跳过）。
- DSH 相关依赖全部为 `peerDependencies`，运行时从 profile 的 `node_modules` 解析（spec §3.3）；esbuild / @xterm 等构建期与 client 运行时依赖由插件仓库自装。
- git 命令一律带 `-c core.quotepath=false`（spec §4.1）。
- 全部 host 服务保持只读/无侵入：gitDiff 只读 git 状态与 diff；workspaceFs 只读目录；console 为独立 PTY 会话（owner = 本插件，与 agent bash 工具互不干扰）。
- 错误：host 服务统一返回/抛出 `{ code, message }`，code 取值含 `git-not-found`、`not-a-repo`、`fs-permission`、`dir-not-found`、`shell-not-found`（spec §8）。
- 本机开发环境事实：node = `/Users/onyh/.nvm/versions/node/v22.22.1/bin/node`（nvm，PATH 不含）；git = `/usr/bin/git`（2.50.1）；profile = `/Users/onyh/.dsh/profiles/`；DSH 包版本线 `0.1.0-rc.6`（peer 版本对齐参考 `@deepseek-ai/dsh-workspace` 的 package.json）。

---

### Task 1: 包结构 + package.json

**Files:**
- Create: `package.json`
- Create: `.gitignore`（追加条目）
- Create: `README.md`（项目说明 + 安装命令；M1 验收时按实际命令复核）

**Interfaces:**
- Produces: `package.json` 的 `name: "dsh-workspace-tools"`、`main: "lib/index.js"`、`"type": "module"`；`dsh.client` 字段与 peer 依赖列表以 §12 验证报告定稿（见 Task 6/7 依赖说明）。

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "dsh-workspace-tools",
  "version": "0.1.0",
  "description": "DSH 第三方插件：Git Diff 变更列表 / 文件浏览器 / PTY 控制台",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-input-trigger",
        "@deepseek-ai/dsh-client-connection"
      ]
    }
  },
  "private": true,
  "scripts": {
    "build": "node build.mjs",
    "install:plugin": "node scripts/install.mjs",
    "test": "node --test test/"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-terminal": "0.1.0-rc.6",
    "@deepseek-ai/dsh-subprocess": "0.1.0-rc.6",
    "@deepseek-ai/dsh-fs": "0.1.0-rc.6",
    "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-connection": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-input-trigger": "0.1.0-rc.6",
    "@deepseek-ai/dsh-workspace": "0.1.0-rc.6"
  },
  "devDependencies": {
    "esbuild": "^0.25.0"
  }
}
```

> 说明（§12 client 侧报告 1dc9c01c）：`dsh.client` 无 `entry/main` 字段，client 束路径由 `exports["./client"]` 解析（`dsh-client-modules` 的 `clientExportOf`）；`dsh.client.inject` 仅作加载/预取元数据（bundle 依赖边），**实际注入以 client 束 factory 的 `exports.inject` 为准**（Task 2 起随 src 维护）。peer 版本已实测核对 profile node_modules 全部 `0.1.0-rc.6` / cordis `4.0.1`。

- [ ] **Step 2: 追加 .gitignore**

当前 `.gitignore` 已含 `node_modules/`，追加 `client.js`（esbuild 构建产物）：

```
client.js
```

- [ ] **Step 3: 写 README.md**

```markdown
# dsh-workspace-tools

DSH（DeepSeek Harness）第三方插件：Git Diff 变更列表 / 文件浏览器 / PTY 控制台。

- 设计文档：`docs/specs/2026-08-14-dsh-workspace-tools-design.md`
- 安装：`npm install && node build.mjs && node scripts/install.mjs`（然后重启 DSH 服务）
```

- [ ] **Step 4: 验证**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && npm install --no-audit --no-fund && npm ls esbuild`
Expected: `esbuild@^0.25.0` 已装；`node_modules/` 生成。

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore README.md
git commit -m "chore: scaffold dsh-workspace-tools package"
```

---

### Task 2: build.mjs（client 打包管线）

**Files:**
- Create: `build.mjs`
- Create: `src/index.js`（空壳占位，M2 起填充）

**Interfaces:**
- Produces: `npm run build` → `client.js`（esbuild 产物）；M2 起 src 由 React 组件填充。

- [ ] **Step 1: 写空壳 src/index.js**

```js
// M1 空壳：client 端 UI 自 M2（文件浏览器）起填充。
// 打包后必须自包含 classic script，并以 window.__ModuleLoader__.load({id, factory}) 收尾
// （收尾由 build.mjs 的 footer 注入；M2 起本文件导出 { name, inject, apply }，factory 返回它）。
export {};
```

- [ ] **Step 2: 写 build.mjs**

```js
// build.mjs —— client 束打包（esbuild，自包含 classic script）
// 契约（§12 client 侧报告 1dc9c01c）：
//   · client 束路径由 package.json exports["./client"] 解析（dsh-client-modules 的 clientExportOf）
//   · 产物以 window.__ModuleLoader__.load({ id, factory }) 收尾；factory 返回本插件导出对象
//   · peer 依赖（react + @deepseek-ai/*）一律 external，运行时经 __ModuleLoader__ 的 makeRequire 解析
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.js"],
  outfile: "client.js",
  bundle: true,
  format: "iife",
  globalName: "__dshwt",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  external: ["react", "react/jsx-runtime", "@deepseek-ai/*"], // M2 起实际生效
  footer: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-workspace-tools", factory: (require) => __dshwt });',
  },
  logLevel: "info",
});
```

- [ ] **Step 3: 验证**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node build.mjs && tail -c 300 client.js && echo`
Expected: 构建无错误，`client.js` 生成（含 sourcemap），末尾含 `window.__ModuleLoader__.load({ id: "dsh-workspace-tools", factory: (require) => __dshwt });`。

- [ ] **Step 4: Commit**

```bash
git add build.mjs src/index.js client.js
git commit -m "feat: add esbuild client bundle pipeline"
```

---

### Task 3: scripts/install.mjs（跨平台安装）

**Files:**
- Create: `scripts/install.mjs`

**Interfaces:**
- Consumes: 本插件根目录绝对路径（`import.meta.dirname` 上溯一级）。
- Produces: `node scripts/install.mjs` 完成后——`~/.dsh/profiles/node_modules/dsh-workspace-tools` 链接存在；`~/.dsh/profiles/web/cordis.patch.yml` 含 `- insert: { id: dsh-workspace-tools, name: 'dsh-workspace-tools' }`（且幂等）。

- [ ] **Step 1: 写 install.mjs**

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/ -> 插件根
const profiles = join(homedir(), ".dsh", "profiles");
const modulesDir = join(profiles, "node_modules");
const patchPath = join(profiles, "web", "cordis.patch.yml");
const linkTarget = join(modulesDir, "dsh-workspace-tools");

const PLUGIN_ID = "dsh-workspace-tools";
const PATCH_LINE = `    - id: ${PLUGIN_ID}\n      name: '${PLUGIN_ID}'\n`;

function linkPlugin() {
  if (existsSync(linkTarget)) {
    console.log(`[install] already linked: ${linkTarget}`);
    return;
  }
  mkdirSync(modulesDir, { recursive: true });
  if (process.platform === "win32") {
    // junction：免管理员权限
    execFileSync("cmd", ["/c", "mklink", "/J", linkTarget, pluginRoot], { stdio: "inherit" });
  } else {
    symlinkSync(pluginRoot, linkTarget, "dir");
  }
  console.log(`[install] linked: ${linkTarget} -> ${pluginRoot}`);
}

function patchCordis() {
  if (!existsSync(patchPath)) {
    throw new Error(`cordis.patch.yml not found: ${patchPath}`);
  }
  const orig = readFileSync(patchPath, "utf8");
  if (orig.includes(`id: ${PLUGIN_ID}`)) {
    console.log(`[install] patch already contains ${PLUGIN_ID}, skip`);
    return;
  }
  // 备份一次（仅当备份不存在时），然后追加 insert 块
  const bak = `${patchPath}.bak-before-workspace-tools`;
  if (!existsSync(bak)) writeFileSync(bak, orig);
  writeFileSync(patchPath, orig + `\n# ── dsh-workspace-tools 插件 ────────────────────────────────────────\n- insert:\n${PATCH_LINE}`);
  console.log(`[install] patched: ${patchPath}`);
}

linkPlugin();
patchCordis();
console.log("[install] done. Restart DSH service to load the plugin.");
```

- [ ] **Step 2: 验证幂等性**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node scripts/install.mjs && node scripts/install.mjs`
Expected: 第一次输出 `linked` + `patched`；第二次输出 `already linked` + `patch already contains ... skip`；`cordis.patch.yml` 只含一条 `dsh-workspace-tools` insert。

- [ ] **Step 3: 验证链接与 patch 内容**

Run: `ls -la ~/.dsh/profiles/node_modules/dsh-workspace-tools && tail -8 ~/.dsh/profiles/web/cordis.patch.yml`
Expected: 链接指向 `/Volumes/data/code/dsh-workspace-tools`；patch 尾部含 `- insert:` + `id: dsh-workspace-tools`。

- [ ] **Step 4: Commit**

```bash
git add scripts/install.mjs
git commit -m "feat: add cross-platform install script (symlink/junction + cordis.patch.yml)"
```

---

### Task 4: host 服务 gitDiff（纯函数 + 单测）

**Files:**
- Create: `lib/services/git-diff.js`
- Create: `test/git-diff.test.js`

**Interfaces:**
- Produces:
  - `listChanges(cwd) → Promise<{ changes: Array<{ status: string, path: string, untracked: boolean }> }>`
  - `getDiff(cwd, file, { untracked }) → Promise<{ diff: string }>`（unified；未跟踪文件返回全新增视图；删除文件返回删除 diff）
  - 错误：reject `{ code: 'git-not-found' }` / `{ code: 'not-a-repo' }` / `{ code: 'fs-permission' }` / `{ code: 'dir-not-found' }` / `{ code: 'file-not-found' }`

- [ ] **Step 1: 写失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listChanges, getDiff } from "../lib/services/git-diff.js";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-git-"));
  const git = (args, cwd = dir) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, stdio: "pipe" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(dir, "a.txt"), "line1\nline2\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("listChanges: modified / untracked / deleted", () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED\n");
    writeFileSync(join(repo.dir, "new.txt"), "hello\n");
    repo.git(["rm", "-q", "--cached", "a.txt"]); // 制造 staged 变更，验证合并进修改显示
    repo.git(["add", "a.txt"]);
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED2\n"); // staged + unstaged 同时存在
    const { changes } = await listChanges(repo.dir);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
    assert.equal(byPath["a.txt"].status, "M");
    assert.equal(byPath["a.txt"].untracked, false);
    assert.equal(byPath["new.txt"].status, "??");
    assert.equal(byPath["new.txt"].untracked, true);
  } finally {
    repo.cleanup();
  }
});

test("getDiff: tracked file shows unified diff including staged changes", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED\n");
    repo.git(["add", "a.txt"]);
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED2\n");
    const { diff } = await getDiff(repo.dir, "a.txt", { untracked: false });
    assert.match(diff, /^diff --git/);
    assert.match(diff, /CHANGED2/); // 工作树 vs HEAD：含暂存差异
  } finally {
    repo.cleanup();
  }
});

test("getDiff: untracked file returns full-added view", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "new.txt"), "hello\nworld\n");
    const { diff } = await getDiff(repo.dir, "new.txt", { untracked: true });
    assert.match(diff, /--- \/dev\/null/);
    assert.match(diff, /\+\+\+ b\/new\.txt/);
    assert.match(diff, /\+hello/);
  } finally {
    repo.cleanup();
  }
});

test("getDiff: non-repo dir rejects not-a-repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-norepo-"));
  try {
    await assert.rejects(getDiff(dir, "a.txt", { untracked: false }), (e) => e.code === "not-a-repo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/git-diff.test.js`
Expected: FAIL（`Cannot find module '../lib/services/git-diff.js'`）。

- [ ] **Step 3: 写实现**

```js
// lib/services/git-diff.js
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileP = promisify(execFile);

function gitBase(cwd) {
  return ["-c", "core.quotepath=false"];
}

async function runGit(cwd, args) {
  try {
    const { stdout } = await execFileP("git", [...gitBase(cwd), ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    if (err.code === "ENOENT") throw { code: "git-not-found", message: "git 不在 PATH 中" };
    const stderr = String(err.stderr ?? "");
    if (/not a git repository/i.test(stderr)) throw { code: "not-a-repo", message: "目录不是 git 仓库" };
    if (err.code === "EACCES" || /permission denied/i.test(stderr)) throw { code: "fs-permission", message: "权限不足" };
    throw { code: "git-error", message: stderr.trim() || err.message };
  }
}

function parsePorcelainZ(buf) {
  // -z 格式：普通项 `XY <path>\0`；重命名/复制为 `XY <new>\0<old>\0`（双路径）。
  // 复合状态（MM/AM…）归一化为首个状态码（index 优先，空格则取工作树码）。
  const items = [];
  const parts = buf.split("\0");
  for (let i = 0; i < parts.length; ) {
    const head = parts[i];
    if (!head) {
      i += 1;
      continue;
    }
    const xy = head.slice(0, 2).replace(/ /g, "");
    const path = head.slice(3); // "XY " 之后为路径（-z 模式原始字节、不引用）
    const untracked = xy === "??";
    if (xy === "R" || xy === "C") {
      items.push({ status: xy, path, oldPath: parts[i + 1] ?? "", untracked: false });
      i += 2;
    } else {
      const status = untracked ? "??" : xy[0] || xy;
      items.push({ status, path, untracked });
      i += 1;
    }
  }
  return items;
}

export async function listChanges(cwd) {
  await stat(cwd).catch(() => {
    throw { code: "dir-not-found", message: `目录不存在: ${cwd}` };
  });
  const out = await runGit(cwd, ["status", "--porcelain", "-z"]);
  return { changes: parsePorcelainZ(out) };
}

export async function getDiff(cwd, file, { untracked = false } = {}) {
  if (untracked) {
    const content = await readFile(join(cwd, file), "utf8").catch((e) => {
      if (e.code === "ENOENT") throw { code: "file-not-found", message: `文件不存在: ${file}` };
      if (e.code === "EACCES") throw { code: "fs-permission", message: `无法读取: ${file}` };
      throw e;
    });
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const body = lines.map((l) => `+${l}`).join("\n");
    return { diff: `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}${lines.length ? "\n" : ""}` };
  }
  const out = await runGit(cwd, ["diff", "HEAD", "--", file]);
  if (out === "") {
    // HEAD 与工作树一致且文件存在 → 可能是"已删除但从未提交"之外的空 diff，保持原样
    return { diff: out };
  }
  return { diff: out };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/git-diff.test.js`
Expected: 4 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/services/git-diff.js test/git-diff.test.js
git commit -m "feat: gitDiff host service (listChanges/getDiff, structured errors)"
```

---

### Task 5: host 服务 workspaceFs（纯函数 + 单测）

**Files:**
- Create: `lib/services/workspace-fs.js`
- Create: `test/workspace-fs.test.js`

**Interfaces:**
- Produces:
  - `listDir(cwd, relPath) → Promise<{ entries: Array<{ name, isDir, size, mtime }> }>`（过滤 `.git` 与 `.DS_Store`；relPath 为相对 cwd 的目录，`""` 表示根）
  - `resolvePath(cwd, relPath) → { absolute }`（`path.resolve` 规范化）
  - 错误：`dir-not-found` / `fs-permission` / `path-escape`（relPath 越出 cwd，防御性检查）
- 实现选择：**以 `node:fs/promises` 自实现**（只读）。若 §12 验证报告确认 host 已有可直接复用的只读 fs 服务（`ctx.fs`/`dsh-fs`），则 M1 保留纯函数实现作为 fallback，插件入口注册时按验证报告决定是否切换（见 Task 7 说明）。

- [ ] **Step 1: 写失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDir, resolvePath } from "../lib/services/workspace-fs.js";

test("listDir: returns entries with metadata and filters hidden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "a.txt"), "x");
    writeFileSync(join(dir, ".DS_Store"), "y");
    const { entries } = await listDir(dir, "");
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["a.txt", "sub"]);
    const a = entries.find((e) => e.name === "a.txt");
    assert.equal(a.isDir, false);
    assert.equal(a.size, 1);
    assert.equal(typeof a.mtime, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listDir: nested relative path works", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "z");
    const { entries } = await listDir(dir, "sub");
    assert.deepEqual(entries.map((e) => e.name), ["b.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listDir: missing dir rejects dir-not-found", async () => {
  await assert.rejects(listDir("/nonexistent-dshwt", ""), (e) => e.code === "dir-not-found");
});

test("listDir: path escape rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    await assert.rejects(listDir(dir, "../.."), (e) => e.code === "path-escape");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePath: returns normalized absolute path", () => {
  const dir = "/tmp/dshwt/root";
  assert.equal(resolvePath(dir, "sub/a.txt").absolute, "/tmp/dshwt/root/sub/a.txt");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/workspace-fs.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```js
// lib/services/workspace-fs.js
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const HIDDEN = new Set([".git", ".DS_Store"]);

function assertInside(cwd, relPath) {
  if (relPath === "" || relPath === ".") return cwd;
  const target = resolve(cwd, relPath);
  const rel = relative(cwd, target);
  if (rel.startsWith("..") || (rel !== "" && rel.startsWith(`..${sep}`))) {
    throw { code: "path-escape", message: "路径越出工作区" };
  }
  return target;
}

export async function listDir(cwd, relPath = "") {
  const target = assertInside(cwd, relPath);
  const st = await stat(target).catch((e) => {
    if (e.code === "ENOENT") throw { code: "dir-not-found", message: `目录不存在: ${target}` };
    if (e.code === "EACCES") throw { code: "fs-permission", message: `无法访问: ${target}` };
    throw e;
  });
  if (!st.isDirectory()) throw { code: "dir-not-found", message: `不是目录: ${target}` };
  const names = await readdir(target).catch((e) => {
    if (e.code === "EACCES") throw { code: "fs-permission", message: `无法读取: ${target}` };
    throw e;
  });
  const entries = [];
  for (const name of names) {
    if (HIDDEN.has(name)) continue;
    const full = join(target, name);
    let e;
    try {
      e = await stat(full);
    } catch {
      continue; // 竞态删除等，跳过
    }
    entries.push({ name, isDir: e.isDirectory(), size: e.size, mtime: e.mtimeMs });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { entries };
}

export function resolvePath(cwd, relPath = "") {
  return { absolute: resolve(cwd, relPath) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/workspace-fs.test.js`
Expected: 5 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/services/workspace-fs.js test/workspace-fs.test.js
git commit -m "feat: workspaceFs host service (lazy listDir/resolvePath, hidden filters)"
```

---

### Task 6: host 服务 console（POSIX PTY 封装，依赖注入 + 单测）

**Files:**
- Create: `lib/services/console.js`
- Create: `test/console.test.js`

**Interfaces:**
- Produces:
  - `detectShell({ platform, env }) → string`（纯函数：非 win32 用 `$SHELL` → `/bin/zsh`；win32 顺序 `pwsh` → `powershell.exe` → `cmd`——M1 只落地探测顺序，Windows PTY 不落地，见下）
  - `createShellSession(deps, { cwd, rows, cols }) → Promise<{ sessionId, handle, write, kill }>`（`deps = { spawnTerminal, shell?, sessionId?, graceMs? }`；生产由插件入口注入 `ctx.subprocess.spawnTerminal`；`write(data)` 委托 `handle.write`、`kill()` 委托 `handle.terminate()`；`handle.output` Readable 流由插件入口泵给 client）
  - 错误：`{ code: 'shell-not-found' }`（spawn ENOENT）、`{ code: 'pty-spawn-failed' }`
- **验证结论（4cffa5fd 报告）**：PTY 用 `ctx.subprocess.spawnTerminal({ argv, cwd, env, rows, cols, graceMs, signal })`（不用 `ctx.terminals`——owner=Agent、无 resize、无输出事件、单 active send）。`terminate()` 内置 SIGTERM→graceMs(默认 3000ms)→SIGKILL 兜底，awaited 到进程树 quiescent。**无 resize API** → spawn 时固定 rows/cols，动态 resize 留 M4（评估 node-pty 直连）。**Windows 上 `spawnTerminal` 必抛**（`createProcessInspector` 未实现 win32，dsh-subprocess-local/lib/index.js:295-299）→ 本任务实现 POSIX 路径；Windows 真机验证列为 M1 验收项，绕开 seam 直连 node-pty 为 M4+ 备选。

- [ ] **Step 1: 写失败测试（detectShell + createShellSession 依赖注入，不依赖真实 PTY）**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { detectShell, createShellSession } from "../lib/services/console.js";

test("detectShell: respects SHELL env on non-win32", () => {
  assert.equal(detectShell({ platform: "darwin", env: { SHELL: "/bin/bash" } }), "/bin/bash");
  assert.equal(detectShell({ platform: "linux", env: {} }), "/bin/zsh");
});

test("detectShell: win32 returns pwsh first (powershell.exe/cmd fallback is M1 probe-order only)", () => {
  assert.equal(detectShell({ platform: "win32", env: {} }), "pwsh");
});

test("createShellSession: calls spawnTerminal with shell argv, cwd and fixed size", async () => {
  const calls = [];
  const fakeHandle = {
    output: Readable.from(["hi"]),
    write: (d) => calls.push(["write", d]),
    terminate: () => calls.push(["terminate"]),
  };
  const deps = {
    shell: "/bin/zsh",
    sessionId: "s1",
    spawnTerminal: async (opts) => {
      calls.push(["spawn", opts]);
      return fakeHandle;
    },
  };
  const s = await createShellSession(deps, { cwd: "/tmp", rows: 40, cols: 120 });
  assert.equal(s.sessionId, "s1");
  assert.deepEqual(calls.find(([k]) => k === "spawn")[1].argv, ["/bin/zsh", "-i"]);
  assert.equal(calls.find(([k]) => k === "spawn")[1].cwd, "/tmp");
  assert.equal(calls.find(([k]) => k === "spawn")[1].rows, 40);
  assert.equal(calls.find(([k]) => k === "spawn")[1].cols, 120);
  assert.equal(calls.find(([k]) => k === "spawn")[1].graceMs, 3000);
  s.write("x");
  s.kill();
  assert.deepEqual(calls.filter(([k]) => k !== "spawn"), [["write", "x"], ["terminate"]]);
});

test("createShellSession: ENOENT maps to shell-not-found", async () => {
  const deps = {
    shell: "/bin/nope",
    spawnTerminal: async () => {
      const err = new Error("spawn /bin/nope ENOENT");
      err.code = "ENOENT";
      throw err;
    },
  };
  await assert.rejects(createShellSession(deps, { cwd: "/tmp" }), (e) => e.code === "shell-not-found");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/console.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现（探测纯函数 + spawnTerminal 依赖注入封装）**

```js
// lib/services/console.js
// PTY 用 ctx.subprocess.spawnTerminal（验证结论 4cffa5fd：不用 ctx.terminals——owner=Agent、无 resize、无输出事件）。
// 无 resize API：spawn 时固定 rows/cols（M1）；动态 resize 留 M4 评估 node-pty 直连。
// Windows：spawnTerminal 在 win32 必抛（process-inspector 未实现）→ 本实现为 POSIX 路径。
import { platform } from "node:os";

export function detectShell({ platform: plat = platform(), env = process.env } = {}) {
  if (plat !== "win32") {
    return env.SHELL || "/bin/zsh";
  }
  // 探测顺序：pwsh -> powershell.exe -> cmd（Windows PTY 未落地，仅保留顺序逻辑）
  return "pwsh";
}

export async function createShellSession(deps, { cwd, rows = 80, cols = 24 } = {}) {
  const shell = deps.shell ?? detectShell();
  const argv = [shell, "-i"];
  let handle;
  try {
    handle = await deps.spawnTerminal({
      argv,
      cwd,
      rows,
      cols,
      env: { ...process.env, TERM: "xterm-256color" },
      graceMs: deps.graceMs ?? 3000,
    });
  } catch (err) {
    if (err && (err.code === "ENOENT" || /ENOENT/.test(String(err?.message ?? err)))) {
      throw { code: "shell-not-found", message: `shell 不可用: ${shell}` };
    }
    throw { code: "pty-spawn-failed", message: String(err?.message ?? err) };
  }
  const sessionId = deps.sessionId ?? `tty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    sessionId,
    handle,
    write: (data) => handle.write(data),
    kill: () => handle.terminate(),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/console.test.js`
Expected: 4 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/services/console.js test/console.test.js
git commit -m "feat: console host service (detectShell + spawnTerminal DI wrapper, SIGTERM/SIGKILL via terminate)"
```

---

### Task 7: lib/index.js 插件入口（RPC 桥接 + WebSocket 泵 + ctx.fs 复用）

**Files:**
- Create: `lib/index.js`

**Interfaces:**
- Consumes: `lib/services/git-diff.js`（`listChanges`/`getDiff`）、`lib/services/workspace-fs.js`（`resolvePath` fallback）、`lib/services/console.js`（`createShellSession`/`detectShell`）；host 服务 `ctx.connection.rpc.handle`（一元 RPC，loopback authority）、`ctx.webServer.registerUpgrade`（自建 WebSocket）、`ctx.fs`（优先复用，读零拦截）、`ctx.subprocess.spawnTerminal`。
- Produces: Cordis 插件默认导出（`export default { name, inject, apply(ctx) {...} }`）：
  - RPC 端点 `connection.rpc.handle(channel, handler, { authority: 'loopback' })` 暴露 6 个 op：`git.listChanges` / `git.getDiff` / `fs.listDir` / `fs.resolvePath` / `console.create` / `console.write` / `console.kill`；
  - WebSocket 泵 `/plugins/dsh-workspace-tools/console`（`webServer.registerUpgrade`）：把会话 `handle.output` 文本 chunk 泵给浏览器（M4 起 client 消费），loopback 校验 + 标准握手；
  - 会话 Map 随 ctx dispose 清理（`ctx.effect` disposer）。
- **验证结论（4cffa5fd 报告）**：`connection.rpc.handle` 为一元 RPC（无流式）；流式输出走自建 WebSocket；`ctx.fs` 读操作零拦截（`resolve`/`listDir`/`lstat`，`FsTarget` 不透明 key 用 `processPath` 取绝对路径）；git 不受 fs 策略管辖 → cwd 由 client 显式传入（RPC 已限 loopback；上线前可加"cwd 必须等于当前 workspace"校验）。`inject` 服务名（connection/webServer/fs/subprocess）与 client 侧 call 端点格式以 §12 client 侧报告核对（见 Step 3 说明）。

- [ ] **Step 1: 写插件入口**

```js
// lib/index.js
import { createHash } from "node:crypto";
import { listChanges, getDiff } from "./services/git-diff.js";
import { resolvePath } from "./services/workspace-fs.js";
import { createShellSession } from "./services/console.js";

const RPC_CHANNEL = "/rpc/workspace-tools";
const WS_PATH = "/plugins/dsh-workspace-tools/console";

function translateFsError(err) {
  // ctx.fs 的 FS_* 错误码翻译为插件结构化错误（spec §8 风格）
  if (err && typeof err.code === "string" && err.code.startsWith("FS_")) {
    const map = {
      FS_NOT_FOUND: "dir-not-found",
      FS_NOT_DIRECTORY: "dir-not-found",
      FS_PERMISSION_DENIED: "fs-permission",
      FS_SANDBOX_DENIED: "fs-permission",
    };
    return { code: map[err.code] ?? "fs-error", message: err.message ?? err.code };
  }
  return err;
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export default {
  name: "dsh-workspace-tools",
  // 服务名已按 §12 报告定稿（connection/webServer/fs/subprocess）。
  // 注：工作区服务名是 ctx.workspaceRegistry（本插件不 inject，cwd 由 client 显式传入 RPC payload）。
  inject: ["connection", "webServer", "fs", "subprocess"],
  apply(ctx) {
    const sessions = new Map();

    // ── 1) 一元 RPC：client -> host 调用三服务 ──────────────────────────
    ctx.connection.rpc.handle(
      RPC_CHANNEL,
      async (payload) => {
        try {
          switch (payload?.op) {
            case "git.listChanges":
              return await listChanges(payload.cwd);
            case "git.getDiff":
              return await getDiff(payload.cwd, payload.file, { untracked: payload.untracked });
            case "fs.listDir": {
              // 优先 ctx.fs：resolve 防越界 + listDir 一层懒加载；过滤 dot 文件
              const root = await ctx.fs.resolve(payload.cwd);
              const target = payload.relPath ? await ctx.fs.resolve(payload.relPath, { cwd: root }) : root;
              const entries = await ctx.fs.listDir(target);
              return {
                entries: entries
                  .filter((e) => !e.name.startsWith("."))
                  .map((e) => ({ name: e.name, isDir: e.type === "directory", absolute: ctx.fs.processPath(e.target) })),
              };
            }
            case "fs.resolvePath":
              return { absolute: resolvePath(payload.cwd, payload.relPath).absolute };
            case "console.create": {
              const s = await createShellSession(
                { spawnTerminal: (opts) => ctx.subprocess.spawnTerminal(opts) },
                { cwd: payload.cwd },
              );
              sessions.set(s.sessionId, s);
              return { sessionId: s.sessionId };
            }
            case "console.write": {
              const s = sessions.get(payload.sessionId);
              if (!s) return { error: "session-not-found" };
              s.write(payload.data);
              return { ok: true };
            }
            case "console.kill": {
              const s = sessions.get(payload.sessionId);
              if (!s) return { error: "session-not-found" };
              s.kill();
              sessions.delete(payload.sessionId);
              return { ok: true };
            }
            default:
              return { error: "unknown-op" };
          }
        } catch (err) {
          return translateFsError(err);
        }
      },
      { authority: "loopback" },
    );

    // ── 2) console 输出流：自建 WebSocket 泵（M4 client 消费）────────────
    ctx.webServer.registerUpgrade({
      path: WS_PATH,
      handler: (req, socket) => {
        if (!isLoopback(req)) {
          socket.destroy();
          return;
        }
        const key = req.headers["sec-websocket-key"];
        if (!key) {
          socket.destroy();
          return;
        }
        // 标准 WS 握手（RFC 6455）
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        // 帧泵：会话输出 -> 文本帧（0x81 + len + payload）
        const frame = (data) => {
          const buf = Buffer.from(data, "utf8");
          const len = buf.length;
          let header;
          if (len < 126) header = Buffer.from([0x81, len]);
          else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(len, 2);
          } else {
            header = Buffer.alloc(10);
            header[0] = 0x81;
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
          }
          socket.write(Buffer.concat([header, buf]));
        };
        const attach = (sessionId) => {
          const s = sessions.get(sessionId);
          if (!s) return;
          const onData = (chunk) => frame(chunk.toString("utf8"));
          const onExit = () => {
            frame(JSON.stringify({ type: "exit" }));
            cleanup();
          };
          const cleanup = () => {
            s.handle.output.off("data", onData);
            s.handle.output.off("end", onExit);
            s.handle.output.off("error", onExit);
            socket.destroy();
          };
          s.handle.output.on("data", onData);
          s.handle.output.on("end", onExit);
          s.handle.output.on("error", onExit);
          socket.on("close", cleanup);
          socket.on("error", cleanup);
        };
        // 首个客户端帧携带 { sessionId }（M4 定义 client 协议）
        socket.on("data", (buf) => {
          try {
            const msg = JSON.parse(buf.toString("utf8").replace(/^\x81.\x00?/, ""));
            if (msg.sessionId) attach(msg.sessionId);
          } catch {
            /* 非 JSON 帧忽略（M4 完善协议） */
          }
        });
      },
    });

    // ── 3) 清理：dispose 时终止所有会话 ─────────────────────────────────
    ctx.effect(() => () => {
      for (const s of sessions.values()) s.kill();
      sessions.clear();
    });
  },
};
```

- [ ] **Step 2: 语法验证 + 纯函数 smoke**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check lib/index.js && node --check lib/services/git-diff.js && node --check lib/services/workspace-fs.js && node --check lib/services/console.js`
Expected: 无语法错误（4 个文件全部通过 `node --check`）。

- [ ] **Step 3: 核对点定稿（§12 client 侧报告 1dc9c01c 已到达，2026-08-14）**

按报告逐项落定：
1. **inject 服务名**：`connection` / `webServer` / `fs` / `subprocess` 均为有效 host 服务名（dsh-client-connection / dsh-host-webserver / dsh-fs / dsh-subprocess）。**工作区服务名是 `ctx.workspaceRegistry`（不是 `workspace`）**——本 Task 不 inject 它（M1 RPC 的 `payload.cwd` 由 client 显式传入）；若后续加"cwd 必须属于当前 workspace"校验，用 `ctx.workspaceRegistry` + `ctx.sessions.get(id)?.header.cwd`（host 无"当前活动工作区"概念）。
2. **RPC channel**：`/rpc/workspace-tools` 命名保留；client 面（M2 起）经 `ctx.connection` 直连 RPC，工作区/会话查询走 `ctx.connection.api.workspace.list({})` / `api.sessions.list({})`。
3. **cwd 来源（client 侧）**：`useSessions(s => s.byId[s.current]?.cwd)`（`SessionSummary.cwd`）+ `useWorkspaces` 监听工作区变化——M2 的 RPC `payload.cwd` 由此而来；host 服务签名显式传 cwd（本计划纯函数设计正确）。
4. **dsh.client 字段**：已按报告写入 Task 1（`{ platform: "web", inject: [...] }`，无 entry/main，束路径走 `exports["./client"]`，产物以 `__ModuleLoader__.load` 收尾）——**无需再改**。

- [ ] **Step 4: Commit（Step 3 核对完成后）**

```bash
git add lib/index.js package.json
git commit -m "feat: plugin entry with RPC bridge + WebSocket pump + ctx.fs reuse"
```

---

### Task 8: 命令行 smoke 验证（M1 验收）

**Files:**
- Create: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: 三服务纯函数。
- Produces: 不依赖 DSH 运行时的命令行验证输出（spec §10 M1 验收："命令行验证服务可调用"）。

- [ ] **Step 1: 写 smoke 脚本**

```js
// scripts/smoke.mjs —— M1 验收：命令行验证三服务可调用（不依赖 DSH 运行时）
import { listChanges, getDiff } from "../lib/services/git-diff.js";
import { listDir, resolvePath } from "../lib/services/workspace-fs.js";
import { detectShell } from "../lib/services/console.js";

const cwd = process.cwd();
console.log(`[smoke] cwd = ${cwd}`);

try {
  const { changes } = await listChanges(cwd);
  console.log(`[smoke] gitDiff.listChanges -> ${changes.length} change(s)`);
  for (const c of changes.slice(0, 5)) console.log(`  ${c.status}  ${c.path}`);
  if (changes.length) {
    const first = changes[0];
    const { diff } = await getDiff(cwd, first.path, { untracked: first.untracked });
    console.log(`[smoke] gitDiff.getDiff(${first.path}) -> ${diff.split("\n").length} lines`);
  }
} catch (e) {
  console.log(`[smoke] gitDiff: ${e.code ?? "error"} — ${e.message ?? e}`);
}

try {
  const { entries } = await listDir(cwd, "");
  console.log(`[smoke] workspaceFs.listDir -> ${entries.length} entries`);
  console.log(`[smoke] workspaceFs.resolvePath("") -> ${resolvePath(cwd, "").absolute}`);
} catch (e) {
  console.log(`[smoke] workspaceFs: ${e.code ?? "error"} — ${e.message ?? e}`);
}

console.log(`[smoke] console.detectShell -> ${detectShell()}`);
console.log("[smoke] done");
```

- [ ] **Step 2: 在插件仓库根目录运行**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node scripts/smoke.mjs`
Expected: 输出三行 `[smoke]` 成功信息；当前仓库不是 git 仓库时 `gitDiff` 分支输出 `not-a-repo` 结构化错误（行为正确，非失败）。

- [ ] **Step 3: 在临时 git 仓库运行**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && mkdir -p /tmp/dshwt-smoke && cd /tmp/dshwt-smoke && git init -q && echo hi > f.txt && git add f.txt && git commit -qm init && echo change >> f.txt && node /Volumes/data/code/dsh-workspace-tools/scripts/smoke.mjs`
Expected: `gitDiff.listChanges -> 1 change(s)`、`M  f.txt`、`gitDiff.getDiff(f.txt) -> N lines`、`workspaceFs.listDir -> ...`。

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test: add CLI smoke verification for M1"
```

---

## 里程碑验收清单（M1）

- [ ] `npm install && node build.mjs && node scripts/install.mjs` 在 macOS 可重复执行（幂等）。
- [ ] `cordis.patch.yml` 追加 `- insert: { id: dsh-workspace-tools, name: 'dsh-workspace-tools' }`，`cordis.yml` 未被修改。
- [ ] `node --test test/` 全绿（gitDiff 4 例、workspaceFs 5 例、console 4 例：detectShell 2 + createShellSession 2）。
- [ ] `node scripts/smoke.mjs` 在 git 仓库与非 git 目录均输出正确结果（含 `not-a-repo` 结构化错误）。
- [ ] Task 7 Step 3 核对点定稿（§12 双报告已并入：inject 服务名 / RPC channel / cwd 来源 / `dsh.client` 字段同步 Task 1）。
- [ ] 重启 DSH 服务后插件行出现在 profile 插件清单（可选验证，若环境允许）。

## 后续（非 M1 范围）

- **M2 文件浏览器**（client 侧边栏三段页签 + 文件树 + 右键菜单）——前置结论已确认（§12 client 报告）：
  - 三段切换条注册 `sidebar.workspaces` + `priority: -1`（遮蔽 shipped browser）；页签内容自绘。
  - cwd：根组件 `useSessions(s => s.byId[s.current]?.cwd)` + `useWorkspaces`；RPC `payload.cwd` 由此来。
  - 右键"复制绝对路径"用 `navigator.clipboard`；"发送到对话框"用 `inputActions.setDraft` 或 `slash/input-insert-text`（带 draftRev）。
  - client 包骨架：Task 1/2 已定（`exports["./client"]` + `__ModuleLoader__.load` 收尾 + peer external）。
- **M3 变更 + diff**（client 变更列表 + diff 渲染）：host `gitDiff` 纯函数（Task 4）已就绪；client 复用 M2 的 RPC 管线与文件树组件。
- **M4 控制台**（client 底部面板 + 多标签 PTY + @xterm/xterm 打进 bundle）：
  - host `console` 服务（Task 6）已就绪（`ctx.subprocess.spawnTerminal` + `terminate()` 清理）。
  - 输出流：Task 7 的自建 WebSocket 泵（`/plugins/dsh-workspace-tools/console`）已注册，M4 实现 client 消费 + 帧协议完善（当前为 `{sessionId}` 首帧 + 文本帧 + `{type:"exit"}`）。
  - **无 resize API**：spawn 固定尺寸；动态 resize 需 M4 评估 node-pty 直连（或接受 fit 失效）。
  - 底部面板框架无内置：自绘（flex + resize handle），落点可选 `sidebar.workspaces` 内自绘或 `shell.overlay` list 孔浮层；**不推荐**遮蔽 `conversation`（single 孔，代价大）。
  - Windows：`spawnTerminal` 必抛 → M4 的 Windows 真机验证列验收项，绕开 seam 直连 node-pty 为备选。
