# M2 文件浏览器实现计划（dsh-workspace-tools）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧边栏 `sidebar.workspaces` 注册三段切换条（会话/文件/变更）遮蔽 shipped browser，实现文件页签的懒加载文件树 + 右键菜单两项（复制绝对路径 / 发送到对话框），并修复 M1 潜伏的 host RPC 契约 bug（handler 签名 + ok/fail 信封），使 client↔host RPC 首次真正打通。

**Architecture:** client 侧沿用 M1 的"纯函数核心 + 薄 React 壳"模式：树行计算、RPC 解包、draft 拼接全部下沉到 `src/lib/*.js`（无 React 依赖，node:test 直测）；组件只做渲染与事件接线，注册进 `sidebar.workspaces`（`priority: -1` 遮蔽 shipped browser）。host 侧新增 `lib/rpc.js` 信封层与 `lib/constants.js` 共享常量，`lib/index.js` 的 RPC handler 改为真实契约（`(endpoint, payload)` + `ok/fail` 信封 + cwd 会话校验），并统一 dotfile 过滤策略。

**Tech Stack:** Node.js ≥ 22（ESM）、`node:test`、esbuild（同 M1）、React 18 + `react/jsx-runtime`（peer external，运行时由 `__ModuleLoader__` 解析）、`@deepseek-ai/dsh-client-runtime`（`useSessions` 标准 prop）、`@deepseek-ai/dsh-client-connection`（client `connection.rpc.call` / host `connection.rpc.handle`）。

**设计决策（本计划定稿）：**
- **RPC 契约实测定稿（2026-08-14，源码基线 `@deepseek-ai/dsh-client-connection@0.1.0-rc.6`）**——M1 的 handler 有两个潜伏 bug，M2 必须先修：
  1. host `rpcFetchHandler` 调用 handler 的签名是 **`handler(endpoint, payload, signal)`**（M1 写成 `(payload)` 且 switch `payload.op` → 实际永远走 default）。
  2. handler 返回值**直接**进入 `{type:"server-response", rpcId, result}`；client 端 `createWebConnectionRpc.call` 用 `serverResponseSchema` **严格解析** result 为 `{ok:true, value}` 或 `{ok:false, error:{code,message,details}}`——M1 直接返回 `{changes:...}` 会在 client 解析层抛 schema 异常。
  3. **`error.code` 是封闭枚举**（`rpcErrorSchema` 的 discriminatedUnion，共 40 个预置 code，含 `bad-request` / `cancelled` / `session-not-found` / `internal` 等）；插件自定义 code（`dir-not-found`、`git-not-found`…）**不能**原样进信封 → 统一映射为 `internal`，原 code 嵌入 message（`[dir-not-found] …`）。
- **cwd 校验（M2 落地 M1 终审遗留项；2026-08-15 用户裁定 fail-closed）**：client 每次 RPC 携带 UI 会话 `sessionId`；host 端带 cwd 的 op（git/fs/console.create）强制要求 sessionId——缺失 → `bad-request`、未知会话 → `session-not-found`、`ctx.sessions.get(sessionId)?.header.cwd` 与 `payload.cwd` 不一致 → `session-conflict`（枚举内 code，details `{sessionId, requestedCwd, existingCwd}`）。不再有"缺省跳过"的宽松路径。
- **dotfile 策略统一（M1 终审遗留项）**：纯函数 `listDir` 的 HIDDEN 集合（仅 `.git`/`.DS_Store`）与 RPC 路径 `startsWith(".")` 不一致 → 统一为**隐藏所有以 `.` 开头的条目**（spec §5.2 的两个名字是最低要求；全 dotfile 隐藏是文件浏览器标准行为，且与 ctx.fs RPC 路径现行为一致）。
- **"发送到对话框"= 追加末尾**（caret 未发布，M1 §12 已定退化方案）：经 `ctx.get("conversation").input.shell(sessionId).state.getSnapshot().draft` 读当前 draft，`shell.actions.setDraft(composeDraftInsert(draft, relPath))` 整草稿替换（走完整 machine 事务，无 CAS 问题）。`useInput`/`inputActions` 是 session-scope 标准 prop，`sidebar.workspaces` 是 root-scope，**拿不到**——这是 root 侧唯一干净路径（已实测 `ConversationController extends Service("conversation")`、`input.shell(id)`、`shell.state` snapshot store、`shell.actions.setDraft` 全部存在）。
- **size/mtime 不进 RPC**（YAGNI：树只显示名字；纯函数 `listDir` 已带 size/mtime 备用，spec §5.1 的完整字段后续需要时再补）。
- **会话页签 M2 最小实现**：仅标题列表 + 点击 `ctx.sessions.open(id)`（遮蔽 shipped browser 后必须有个可用落点；完整 browser 功能不属 M2 范围）。

## Global Constraints

- 仓库位置：`/Volumes/data/code/dsh-workspace-tools`（独立 git 仓库，本计划全部改动都在此目录内）。
- 目标平台：macOS + Windows；本计划无平台分支（client UI + host 纯逻辑，Windows 兼容由 M1 已定的 channel/路径规则保证）。
- 不修改 DSH 上游源码、不修改 `~/.dsh/profiles/web/cordis.yml`；client 插件 `inject` 声明与 `dsh.client` 元数据按需同步。
- client 束契约（M1 Task 1/2 已定）：`exports["./client"]` → `client.js`；产物以 `window.__ModuleLoader__.load({id, factory})` 收尾；`react`/`react/jsx-runtime`/`@deepseek-ai/*` 一律 external。**`client.js` 已入库（ZIP 用户需要构建产物），每次改动后必须重建并提交。**
- host RPC 契约（本计划 Task 1 定稿）：handler `(endpoint, payload, signal)`；返回值 `{ok:true, value}` 或 `{ok:false, error:{code,message,details}}`；error.code 仅限预置枚举。
- 错误：host 服务内部仍抛/回 `{code, message}`（spec §8），RPC 边界统一转信封（Task 1）。
- `RPC_CHANNEL`（`/workspace-tools`）与 `WS_PATH` 收敛到 `lib/constants.js` 单一来源，host 与 client 共用。
- 本机开发环境事实：node = `/Users/onyh/.nvm/versions/node/v22.22.1/bin/node`（nvm，PATH 不含）；harness = `dsh web` PID 5846 @ `http://127.0.0.1:3080`（serveBundle 每请求 readFile + `no-cache`，改 client.js 后浏览器刷新即生效，**无需重启 harness**）；profile node_modules 全部 `0.1.0-rc.6` / cordis `4.0.1`。
- 命令统一前置：`export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH`。

---

### Task 1: host RPC 契约修正（信封 + endpoint 分发 + cwd 会话校验）

**Files:**
- Create: `lib/constants.js`
- Create: `lib/rpc.js`
- Create: `test/rpc.test.js`
- Modify: `lib/index.js`（import 区、inject 行、整个 `ctx.connection.rpc.handle` 调用块；WS 泵与清理段不动）

**Interfaces:**
- Produces:
  - `lib/constants.js`: `export const RPC_CHANNEL = "/workspace-tools"`、`export const WS_PATH = "/plugins/dsh-workspace-tools/console"`
  - `lib/rpc.js`: `ok(value) → {ok:true, value}`；`fail(code, message, details={}) → {ok:false, error:{code,message,details}}`；`failFrom(err) → {ok:false, error:{code:"internal", message:"[<原code>] <原message>", details:{}}}`；`checkCwdGuard(session, payload) → {status:"ok"|"missing-session-id"|"session-not-found"|"conflict", requestedCwd?, existingCwd?}`（**fail-closed**：sessionId 非 string/空 → missing-session-id；session 不存在 → session-not-found；`session.header.cwd !== payload.cwd` → conflict；其余 → ok。2026-08-15 按用户裁定替换原 `assertCwdMatchesSession`）
  - `lib/index.js`：host inject 追加 `"sessions"`；RPC handler 签名 `(endpoint, payload)`，按 endpoint 分发，全部返回信封
- Consumes: 既有三服务纯函数（`listChanges`/`getDiff`/`resolvePath`/`createShellSession`）+ `ctx.fs`/`ctx.subprocess`/`ctx.sessions`。

- [ ] **Step 1: 写失败测试**

```js
// test/rpc.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { RPC_CHANNEL, WS_PATH } from "../lib/constants.js";
import { ok, fail, failFrom, checkCwdGuard } from "../lib/rpc.js";

test("constants: RPC_CHANNEL 为单级路径且非保留字", () => {
  assert.match(RPC_CHANNEL, /^\/[A-Za-z0-9._~-]+$/); // CHANNEL_PATTERN
  assert.notEqual(RPC_CHANNEL, "/api");
  assert.equal(WS_PATH, "/plugins/dsh-workspace-tools/console");
});

test("ok/fail: 信封形状满足 client serverResponseSchema", () => {
  assert.deepEqual(ok({ changes: [] }), { ok: true, value: { changes: [] } });
  assert.deepEqual(fail("internal", "boom", {}), {
    ok: false,
    error: { code: "internal", message: "boom", details: {} },
  });
});

test("failFrom: 插件结构化错误映射为 internal，原 code 嵌入 message", () => {
  const e = failFrom({ code: "dir-not-found", message: "目录不存在: /x" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, "internal");
  assert.equal(e.error.message, "[dir-not-found] 目录不存在: /x");
  assert.deepEqual(e.error.details, {});
});

test("failFrom: 无 code 的异常也能映射", () => {
  const e = failFrom(new Error("kaboom"));
  assert.equal(e.error.code, "internal");
  assert.match(e.error.message, /kaboom/);
});

test("checkCwdGuard: ok / conflict / session-not-found / missing-session-id 分派", () => {
  const session = { header: { cwd: "/a/b" } };
  assert.deepEqual(checkCwdGuard(session, { sessionId: "s1", cwd: "/a/b" }), { status: "ok" });
  assert.deepEqual(checkCwdGuard(session, { sessionId: "s1", cwd: "/a/c" }), {
    status: "conflict",
    requestedCwd: "/a/c",
    existingCwd: "/a/b",
  });
  assert.deepEqual(checkCwdGuard(undefined, { sessionId: "s1", cwd: "/a/b" }), { status: "session-not-found" });
  assert.deepEqual(checkCwdGuard(session, { cwd: "/a/b" }), { status: "missing-session-id" });
  assert.deepEqual(checkCwdGuard(session, { sessionId: "", cwd: "/a/b" }), { status: "missing-session-id" });
  assert.deepEqual(checkCwdGuard(session, undefined), { status: "missing-session-id" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/rpc.test.js`
Expected: FAIL（`Cannot find module '../lib/rpc.js'` 等）。

- [ ] **Step 3: 写实现（constants + rpc 信封层）**

```js
// lib/constants.js
// RPC channel 必须为单级路径（dsh-client-connection 的 CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/，
// 不含斜杠；"/api" 为保留字）。host（lib/index.js）与 client（src/lib/rpc.js）共用，勿单独改。
export const RPC_CHANNEL = "/workspace-tools";
export const WS_PATH = "/plugins/dsh-workspace-tools/console";
```

```js
// lib/rpc.js
// 与 @deepseek-ai/dsh-client-connection@0.1.0-rc.6 的 RPC 信封契约对齐（2026-08-14 源码实测）：
//   · host `connection.rpc.handle(channel, handler)` 中 handler 签名 = (endpoint, payload, signal)
//   · handler 返回值直接进入 `{type:"server-response", rpcId, result}`；client 端
//     `serverResponseSchema` 严格解析 result 为 `{ok:true, value}` 或 `{ok:false, error}`
//   · error.code 必须是封闭枚举（rpcErrorSchema 的 discriminatedUnion，40 个预置 code），
//     插件自定义 code 一律映射为 "internal"（枚举内），原 code 嵌入 message 保留可读性
export function ok(value) {
  return { ok: true, value };
}

export function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

export function failFrom(err) {
  const code = err?.code;
  const message = err?.message ?? String(err ?? "unknown error");
  return fail("internal", `[${code ?? "error"}] ${message}`);
}

// cwd 校验（fail-closed，用户裁定 2026-08-15）：带 cwd 的 op 必须携带当前 UI 会话 sessionId；
// 未知会话 / cwd 与会话 header 不一致一律拒绝。session 为 ctx.sessions.get(sessionId) 的结果
// （含 undefined），payload 为 RPC 入参。
export function checkCwdGuard(session, payload) {
  if (typeof payload?.sessionId !== "string" || payload.sessionId === "") {
    return { status: "missing-session-id" };
  }
  if (!session) return { status: "session-not-found" };
  if (session.header?.cwd !== payload.cwd) {
    return { status: "conflict", requestedCwd: payload.cwd, existingCwd: session.header.cwd };
  }
  return { status: "ok" };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/rpc.test.js`
Expected: 5 个用例 PASS。

- [ ] **Step 5: 改 lib/index.js（import、inject、RPC handler）**

改动 1 —— import 区（文件头部）：

```js
// lib/index.js
import { createHash } from "node:crypto";
import { listChanges, getDiff } from "./services/git-diff.js";
import { resolvePath } from "./services/workspace-fs.js";
import { createShellSession } from "./services/console.js";
import { RPC_CHANNEL, WS_PATH } from "./constants.js";
import { ok, fail, failFrom, checkCwdGuard } from "./rpc.js";
```

改动 2 —— 删除原文件内 `const RPC_CHANNEL` / `const WS_PATH` 两行（常量已收敛到 constants.js）。

改动 3 —— inject 行追加 `"sessions"`：

```js
export const inject = ["connection", "webServer", "fs", "subprocess", "sessions"];
```

改动 4 —— 用下面整块替换原 `ctx.connection.rpc.handle(` … `{ authority: "loopback" },);` 调用（WS 泵与 dispose 清理段保持不变）：

```js
    // ── 1) 一元 RPC：client -> host 调用三服务（契约见 lib/rpc.js）──────────
    // handler 签名 = (endpoint, payload, signal)；返回值必须是 ok/fail 信封。
    // cwd 校验（fail-closed，2026-08-15 用户裁定）：带 cwd 的 op 必须携带 UI 会话 sessionId；
    // 缺失→bad-request、未知→session-not-found、不一致→session-conflict（枚举内 code）。
    const cwdGuardResult = (payload) => {
      const session = payload?.sessionId ? ctx.sessions?.get(payload.sessionId) : undefined;
      return checkCwdGuard(session, payload);
    };
    const guardCwd = (payload) => {
      const g = cwdGuardResult(payload);
      if (g.status === "missing-session-id") return fail("bad-request", "sessionId 必须提供", { issues: [] });
      if (g.status === "session-not-found") return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
      if (g.status === "conflict") {
        return fail("session-conflict", `cwd 与当前会话工作区不一致: ${g.requestedCwd} ≠ ${g.existingCwd}`, {
          sessionId: payload.sessionId,
          requestedCwd: g.requestedCwd,
          existingCwd: g.existingCwd,
        });
      }
      return null;
    };
    ctx.connection.rpc.handle(
      RPC_CHANNEL,
      async (endpoint, payload) => {
        try {
          switch (endpoint) {
            case "git.listChanges": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await listChanges(payload.cwd));
            }
            case "git.getDiff": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await getDiff(payload.cwd, payload.file, { untracked: payload.untracked }));
            }
            case "fs.listDir": {
              // 优先 ctx.fs：resolve 防越界 + listDir 一层懒加载；隐藏全部 dot 条目
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              const root = await ctx.fs.resolve(payload.cwd);
              const target = payload.relPath ? await ctx.fs.resolve(payload.relPath, { cwd: root }) : root;
              const entries = await ctx.fs.listDir(target);
              return ok({
                entries: entries
                  .filter((e) => !e.name.startsWith("."))
                  .map((e) => ({ name: e.name, isDir: e.type === "directory", absolute: ctx.fs.processPath(e.target) })),
              });
            }
            case "fs.resolvePath": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok({ absolute: resolvePath(payload.cwd, payload.relPath).absolute });
            }
            case "console.create": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              const s = await createShellSession(
                { spawnTerminal: (opts) => ctx.subprocess.spawnTerminal(opts) },
                { cwd: payload.cwd },
              );
              sessions.set(s.sessionId, s);
              return ok({ sessionId: s.sessionId });
            }
            case "console.write": {
              const s = sessions.get(payload.sessionId);
              if (!s) {
                // 仅当 sessionId 为 string 时才可带 {sessionId} details（否则 client 严格 schema 解析失败）
                if (typeof payload.sessionId === "string") {
                  return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
                }
                return fail("bad-request", "sessionId 必须提供", { issues: [] });
              }
              s.write(payload.data);
              return ok(true);
            }
            case "console.kill": {
              const s = sessions.get(payload.sessionId);
              if (!s) {
                if (typeof payload.sessionId === "string") {
                  return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
                }
                return fail("bad-request", "sessionId 必须提供", { issues: [] });
              }
              s.kill();
              sessions.delete(payload.sessionId);
              return ok(true);
            }
            default:
              return fail("bad-request", `unknown endpoint: ${endpoint}`, { issues: [] });
          }
        } catch (err) {
          return failFrom(translateFsError(err));
        }
      },
      { authority: "loopback" },
    );
```

- [ ] **Step 6: 语法 + 全量单测**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check lib/index.js && node --check lib/rpc.js && node --check lib/constants.js && node --test`
Expected: 4 个 check 全部通过；`node --test` 全绿（rpc 5 + 既有 17）。

- [ ] **Step 7: Commit**

```bash
git add lib/constants.js lib/rpc.js lib/index.js test/rpc.test.js
git commit -m "fix: align host RPC with dsh-client-connection contract (endpoint dispatch + ok/fail envelope + cwd guard)"
```

---

### Task 2: dotfile 过滤策略统一（纯函数）

**Files:**
- Modify: `lib/services/workspace-fs.js`（HIDDEN 集合 → 前缀谓词）
- Modify: `test/workspace-fs.test.js`（新增 `.env` 用例锁定行为）

**Interfaces:**
- Consumes: 无（改动 `listDir` 内部过滤逻辑与导出的 `assertInside` 无关）。
- Produces: `listDir` 现在隐藏**所有**以 `.` 开头的条目；新增导出 `isHidden(name) → boolean`（`name.startsWith(".")`）。

- [ ] **Step 1: 写失败测试（追加到 workspace-fs.test.js 末尾）**

```js
test("listDir: hides all dotfiles (unified policy, not just .git/.DS_Store)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    writeFileSync(join(dir, ".env"), "SECRET=1");
    writeFileSync(join(dir, ".vscode-settings"), "x");
    writeFileSync(join(dir, "keep.txt"), "y");
    const { entries } = await listDir(dir, "");
    assert.deepEqual(entries.map((e) => e.name), ["keep.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isHidden: dotfile predicate", () => {
  const { isHidden } = await import("../lib/services/workspace-fs.js");
  assert.equal(isHidden(".git"), true);
  assert.equal(isHidden("a.txt"), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/workspace-fs.test.js`
Expected: FAIL（`.env` 出现在结果中 / `isHidden` 未导出）。

- [ ] **Step 3: 改实现**

`lib/services/workspace-fs.js` 中替换：

```js
const HIDDEN = new Set([".git", ".DS_Store"]);
```

为：

```js
// 统一 dotfile 策略：隐藏所有以 "." 开头的条目（与 host RPC 路径 ctx.fs 的过滤一致；
// spec §5.2 的 .git/.DS_Store 是最低要求，全 dotfile 隐藏为标准浏览器行为）
export function isHidden(name) {
  return name.startsWith(".");
}
```

并把 `listDir` 内 `if (HIDDEN.has(name)) continue;` 替换为 `if (isHidden(name)) continue;`。

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/workspace-fs.test.js`
Expected: 8 个用例 PASS（原 6 + 新增 2；原用例只造 `.git`/`.DS_Store`，不受影响）。

- [ ] **Step 5: Commit**

```bash
git add lib/services/workspace-fs.js test/workspace-fs.test.js
git commit -m "fix: unify dotfile filter to all leading-dot entries (pure fn = RPC path)"
```

---

### Task 3: client 纯逻辑层（RPC 解包 / 树行计算 / draft 插入）

**Files:**
- Create: `src/lib/rpc.js`
- Create: `src/lib/fs-tree.js`
- Create: `src/lib/insert.js`
- Create: `test/client-logic.test.js`

**Interfaces:**
- Produces（Task 4 组件直接消费，签名以此为准）:
  - `src/lib/rpc.js`: `export const RPC_CHANNEL`（re-export `../../lib/constants.js` 的 RPC_CHANNEL）；`unwrapResult(result) → value`（`result.ok === true` 返回 `result.value`；否则 throw `Error(result.error.message)` 且 `err.code = result.error.code`）；`callRpc(rpc, endpoint, payload) → Promise<value>`（`rpc.call(RPC_CHANNEL, endpoint, payload)` 后 `unwrapResult`）
  - `src/lib/fs-tree.js`: `parseEntries(raw) → Array<{name,isDir,absolute}>`；`joinRel(base, name) → string`（`""` 根拼接）；`toggleExpanded(expanded:Set, rel) → Set`（纯函数返回新集合）；`visibleRows(nodes:Map<rel,{status:"loading"|"ready"|"error",entries?,error?}>, expanded:Set) → Array<{rel,name,isDir,absolute,depth}>`（只展开 status==="ready" 且 expanded 中的目录；目录优先、按名排序在 host 已完成，这里保持 host 返回顺序）；`fileGlyph(name, isDir) → string`
  - `src/lib/insert.js`: `composeDraftInsert(draft, text) → string`（去尾部空白后追加 `" " + text`；draft 为空直接返回 text）
- Consumes: `RPC_CHANNEL`（constants.js）。

- [ ] **Step 1: 写失败测试**

```js
// test/client-logic.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { RPC_CHANNEL, unwrapResult, callRpc } from "../src/lib/rpc.js";
import { parseEntries, joinRel, toggleExpanded, visibleRows, fileGlyph } from "../src/lib/fs-tree.js";
import { composeDraftInsert } from "../src/lib/insert.js";

test("rpc: RPC_CHANNEL 与 host 常量一致", () => {
  assert.equal(RPC_CHANNEL, "/workspace-tools");
});

test("rpc: unwrapResult 透传 ok.value", () => {
  assert.deepEqual(unwrapResult({ ok: true, value: { entries: [] } }), { entries: [] });
});

test("rpc: unwrapResult 对 error 抛错并带 code/message", () => {
  assert.throws(
    () => unwrapResult({ ok: false, error: { code: "internal", message: "[dir-not-found] x", details: {} } }),
    (err) => err.code === "internal" && /dir-not-found/.test(err.message),
  );
});

test("rpc: unwrapResult 对畸形结果抛默认错误", () => {
  assert.throws(() => unwrapResult(undefined), /RPC 调用失败/);
});

test("rpc: callRpc 走 rpc.call 并解包", async () => {
  const calls = [];
  const rpc = {
    call: async (channel, endpoint, payload) => {
      calls.push([channel, endpoint, payload]);
      return { ok: true, value: { entries: [{ name: "a", isDir: false, absolute: "/x/a" }] } };
    },
  };
  const value = await callRpc(rpc, "fs.listDir", { cwd: "/x", relPath: "" });
  assert.deepEqual(calls, [["/workspace-tools", "fs.listDir", { cwd: "/x", relPath: "" }]]);
  assert.equal(value.entries[0].name, "a");
});

test("fs-tree: parseEntries 规范化 RPC 条目", () => {
  const out = parseEntries([{ name: "d", isDir: true, absolute: "/x/d" }, { name: "f", isDir: false }]);
  assert.deepEqual(out, [
    { name: "d", isDir: true, absolute: "/x/d" },
    { name: "f", isDir: false, absolute: "" },
  ]);
  assert.deepEqual(parseEntries(undefined), []);
});

test("fs-tree: joinRel 根与嵌套拼接", () => {
  assert.equal(joinRel("", "a"), "a");
  assert.equal(joinRel("src", "a.js"), "src/a.js");
});

test("fs-tree: toggleExpanded 纯函数增删", () => {
  const s = new Set(["src"]);
  const next = toggleExpanded(s, "src");
  assert.deepEqual([...next], []);
  assert.deepEqual([...s], ["src"]); // 原集合不变
  assert.deepEqual([...toggleExpanded(s, "lib")], ["src", "lib"]);
});

test("fs-tree: visibleRows 展开顺序与深度（目录优先由 host 排序保证）", () => {
  const nodes = new Map([
    ["", { status: "ready", entries: [
      { name: "a.txt", isDir: false, absolute: "/w/a.txt" },
      { name: "src", isDir: true, absolute: "/w/src" },
    ] }],
    ["src", { status: "ready", entries: [
      { name: "b.js", isDir: false, absolute: "/w/src/b.js" },
      { name: "deep", isDir: true, absolute: "/w/src/deep" },
    ] }],
    ["src/deep", { status: "loading", entries: [] }],
  ]);
  // 未展开：只两行
  let rows = visibleRows(nodes, new Set());
  assert.deepEqual(rows.map((r) => r.rel), ["a.txt", "src"]);
  assert.equal(rows[0].depth, 0);
  // 展开 src：src 目录下 children 出现（deep 处于 loading，不展开）
  rows = visibleRows(nodes, new Set(["src"]));
  assert.deepEqual(rows.map((r) => `${r.depth}:${r.rel}`), ["0:a.txt", "0:src", "1:src/b.js", "1:src/deep"]);
  // 展开 src + src/deep：deep 未 ready，不展开
  rows = visibleRows(nodes, new Set(["src", "src/deep"]));
  assert.deepEqual(rows.map((r) => r.rel), ["a.txt", "src", "src/b.js", "src/deep"]);
  // 根未加载：空
  assert.deepEqual(visibleRows(new Map(), new Set()), []);
});

test("fs-tree: fileGlyph 目录与常见扩展名", () => {
  assert.equal(fileGlyph("src", true), "📁");
  assert.equal(fileGlyph("a.js", false), "🟨");
  assert.equal(fileGlyph("a.xyz", false), "📄");
});

test("insert: composeDraftInsert 追加文本", () => {
  assert.equal(composeDraftInsert("", "src"), "src");
  assert.equal(composeDraftInsert("hello", "src"), "hello src");
  assert.equal(composeDraftInsert("hello  ", "src"), "hello src");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/client-logic.test.js`
Expected: FAIL（模块不存在 / `isHidden` 未导出等）。

- [ ] **Step 3: 写实现**

```js
// src/lib/rpc.js —— client 侧 RPC 封装（契约见 lib/rpc.js；常量与 host 共用 lib/constants.js）
import { RPC_CHANNEL } from "../../lib/constants.js";

export { RPC_CHANNEL };

export function unwrapResult(result) {
  if (result && result.ok === true) return result.value;
  const message = result?.error?.message ?? "RPC 调用失败";
  const err = new Error(message);
  err.code = result?.error?.code;
  throw err;
}

export function callRpc(rpc, endpoint, payload) {
  return rpc.call(RPC_CHANNEL, endpoint, payload).then(unwrapResult);
}
```

```js
// src/lib/fs-tree.js —— 文件树纯逻辑（无 React 依赖）
export function parseEntries(raw) {
  return (raw ?? []).map((e) => ({
    name: e.name,
    isDir: !!e.isDir,
    absolute: e.absolute ?? "",
  }));
}

export function joinRel(base, name) {
  return base === "" ? name : `${base}/${name}`;
}

export function toggleExpanded(expanded, rel) {
  const next = new Set(expanded);
  if (next.has(rel)) next.delete(rel);
  else next.add(rel);
  return next;
}

// nodes: Map<rel, {status:"loading"|"ready"|"error", entries?: Array<{name,isDir,absolute}>, error?: string}>
// expanded: Set<rel>（目录的 rel）
// 返回按 host 返回顺序展开的行；未 ready 的目录不展开（loading/error 由组件单独提示）
export function visibleRows(nodes, expanded) {
  const rows = [];
  const walk = (rel, depth) => {
    const node = nodes.get(rel);
    if (!node || node.status !== "ready") return;
    for (const e of node.entries) {
      const key = joinRel(rel, e.name);
      rows.push({ rel: key, name: e.name, isDir: e.isDir, absolute: e.absolute, depth });
      if (e.isDir && expanded.has(key)) walk(key, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

const GLYPHS = {
  js: "🟨", ts: "🟦", json: "📋", md: "📝", yml: "⚙️", yaml: "⚙️",
  py: "🐍", html: "🌐", css: "🎨", sh: "💻",
};

export function fileGlyph(name, isDir) {
  if (isDir) return "📁";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return GLYPHS[ext] ?? "📄";
}
```

```js
// src/lib/insert.js —— 追加路径到输入框 draft（caret 未发布，退化方案：追加末尾）
export function composeDraftInsert(draft, text) {
  const base = draft.replace(/\s+$/, "");
  return base === "" ? text : `${base} ${text}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/client-logic.test.js`
Expected: 11 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/rpc.js src/lib/fs-tree.js src/lib/insert.js test/client-logic.test.js
git commit -m "feat: client pure logic core (RPC unwrap / fs-tree rows / draft insert)"
```

---

### Task 4: client UI（三段页签 + 会话列表 + 懒加载文件树 + 右键菜单）+ 插件入口注册

**Files:**
- Create: `src/components/workspace-browser.js`
- Create: `src/components/session-list.js`
- Create: `src/components/file-tree.js`
- Modify: `src/index.js`（整体替换为 M2 入口）

**Interfaces:**
- Consumes: Task 3 的 `callRpc`/`joinRel`/`visibleRows`/`fileGlyph`/`parseEntries`/`composeDraftInsert`；标准 prop `useSessions`（`s.byId[s.current]?.cwd`、`s.current`、`s.ids/byId/current`）；注入 prop `rpc`（`ctx.connection.rpc`）、`openSession`（`ctx.sessions.open`）、`insertIntoComposer`。
- Produces: `client.js` 内含 `data-wt-*` 标记的组件与 `sidebar.workspaces` 注册（priority -1）。

- [ ] **Step 1: 写组件与入口（3 个组件文件 + 替换 src/index.js）**

```js
// src/components/workspace-browser.js
import { jsx } from "react/jsx-runtime";
import { useState } from "react";
import { SessionList } from "./session-list.js";
import { FileTree } from "./file-tree.js";

const TABS = [
  { id: "sessions", label: "会话" },
  { id: "files", label: "文件" },
  { id: "changes", label: "变更" },
];

// 三段切换条（会话/文件/变更）——页签内容自绘自管理（无框架 tab 语义，M1 §12 定稿）。
// 注册进 sidebar.workspaces（root scope）：标准 prop 只有 useSessions/useWorkspaces，
// 其余经 register 的 inject 传入（rpc/openSession/insertIntoComposer）。
export function WorkspaceBrowser({ useSessions, rpc, openSession, insertIntoComposer }) {
  const [tab, setTab] = useState("files");
  const current = useSessions((s) => s.current);
  const cwd = useSessions((s) => (s.current ? s.byId[s.current]?.cwd : undefined));

  return jsx("div", {
    "data-wt-sidebar": true,
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      fontSize: "13px",
      color: "var(--dsw-alias-text-primary, #ddd)",
    },
    children: [
      jsx("div", {
        "data-wt-tabs": true,
        style: {
          display: "flex",
          borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
          flexShrink: 0,
        },
        children: TABS.map((t) =>
          jsx("button", {
            key: t.id,
            type: "button",
            onClick: () => setTab(t.id),
            "data-active": tab === t.id || undefined,
            style: {
              flex: 1,
              padding: "8px 4px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "12px",
              color: tab === t.id ? "var(--dsw-alias-text-primary, #fff)" : "var(--dsw-alias-text-secondary, #999)",
              borderBottom: tab === t.id ? "2px solid var(--dsw-alias-accent, #4f8cff)" : "2px solid transparent",
            },
            children: t.label,
          }),
        ),
      }),
      jsx("div", {
        "data-wt-tabpanel": true,
        style: { flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" },
        children:
          tab === "sessions"
            ? jsx(SessionList, { useSessions, openSession })
            : tab === "files"
              ? jsx(FileTree, { key: cwd ?? "no-cwd", cwd, sessionId: current, rpc, insertIntoComposer })
              : jsx("div", { "data-wt-changes-placeholder": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "变更列表将在 M3 提供" }),
      }),
    ],
  });
}
```

```js
// src/components/session-list.js
import { jsx } from "react/jsx-runtime";

// M2 最小会话列表：标题 + 当前标记 + 点击切换（遮蔽 shipped browser 后的可用落点；
// 完整 browser 功能不在 M2 范围）。
export function SessionList({ useSessions, openSession }) {
  const { ids, byId, current } = useSessions((s) => s);
  return jsx("div", {
    "data-wt-sessions": true,
    children: ids.map((id) => {
      const s = byId[id];
      const active = id === current;
      return jsx("div", {
        key: id,
        role: "button",
        tabIndex: 0,
        "data-current": active || undefined,
        onClick: () => openSession(id),
        onKeyDown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openSession(id);
          }
        },
        style: {
          padding: "6px 10px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: active ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
        },
        children: s?.displayTitle ?? id,
      });
    }),
  });
}
```

```js
// src/components/file-tree.js
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { parseEntries, visibleRows, fileGlyph } from "../lib/fs-tree.js";

// 懒加载文件树：根 = 当前会话 cwd；key=cwd 由父组件控制 → 工作区切换重新挂载（状态清零）。
// 行右键菜单：复制绝对路径 / 发送到对话框（相对路径追加到输入框末尾）。
export function FileTree({ cwd, sessionId, rpc, insertIntoComposer }) {
  const [nodes, setNodes] = useState(() => new Map());
  const [expanded, setExpanded] = useState(() => new Set());
  const [selected, setSelected] = useState(null); // rel
  const [menu, setMenu] = useState(null); // {x, y, rel, name, absolute, isDir}
  const panelRef = useRef(null);
  const menuRef = useRef(null);

  // 根加载（cwd 变化 → 重新挂载语义：清空状态）
  useEffect(() => {
    let cancelled = false;
    setNodes(new Map());
    setExpanded(new Set());
    setSelected(null);
    setMenu(null);
    if (!cwd) return undefined;
    callRpc(rpc, "fs.listDir", { cwd, relPath: "", sessionId })
      .then((value) => {
        if (cancelled) return;
        setNodes((prev) => {
          const next = new Map(prev);
          next.set("", { status: "ready", entries: parseEntries(value.entries) });
          return next;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setNodes((prev) => {
          const next = new Map(prev);
          next.set("", { status: "error", error: String(err?.message ?? err) });
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, rpc, sessionId]);

  const loadDir = useCallback(
    (rel) => {
      setNodes((prev) => {
        if (prev.has(rel)) return prev;
        const next = new Map(prev);
        next.set(rel, { status: "loading", entries: [] });
        callRpc(rpc, "fs.listDir", { cwd, relPath: rel, sessionId })
          .then((value) => {
            setNodes((prev2) => {
              const next2 = new Map(prev2);
              next2.set(rel, { status: "ready", entries: parseEntries(value.entries) });
              return next2;
            });
          })
          .catch((err) => {
            setNodes((prev2) => {
              const next2 = new Map(prev2);
              next2.set(rel, { status: "error", error: String(err?.message ?? err) });
              return next2;
            });
          });
        return next;
      });
    },
    [cwd, rpc, sessionId],
  );

  const toggle = useCallback(
    (rel) => {
      if (expanded.has(rel)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(rel);
          return next;
        });
      } else {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(rel);
          return next;
        });
        loadDir(rel);
      }
    },
    [expanded, loadDir],
  );

  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
  const root = nodes.get("");

  // 右键菜单：面板内定位 + 外部点击/Escape 关闭
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (ev) => {
      if (menuRef.current && !menuRef.current.contains(ev.target)) setMenu(null);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = useCallback((ev, row) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    setMenu({ x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0), ...row });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onCopy = useCallback(async () => {
    if (!menu) return;
    try {
      await navigator.clipboard.writeText(menu.absolute || menu.rel);
    } catch {
      /* 剪贴板不可用（非安全上下文等）时静默失败 */
    }
    closeMenu();
  }, [menu, closeMenu]);

  const onInsert = useCallback(() => {
    if (!menu || !sessionId) {
      closeMenu();
      return;
    }
    insertIntoComposer(sessionId, menu.rel);
    closeMenu();
  }, [menu, sessionId, insertIntoComposer, closeMenu]);

  let body;
  if (!cwd) {
    body = jsx("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "当前会话没有工作目录" });
  } else if (!root || root.status === "loading") {
    body = jsx("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (root.status === "error") {
    body = jsx("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: root.error });
  } else {
    body = jsx("div", {
      "data-wt-tree": true,
      children: rows.map((row) => {
        const isOpen = row.isDir && expanded.has(row.rel);
        return jsx("div", {
          key: row.rel,
          role: "button",
          tabIndex: 0,
          "data-wt-row": true,
          "data-dir": row.isDir || undefined,
          "data-selected": selected === row.rel || undefined,
          onClick: () => {
            setSelected(row.rel);
            if (row.isDir) toggle(row.rel);
          },
          onContextMenu: (ev) => openMenu(ev, row),
          onKeyDown: (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              setSelected(row.rel);
              if (row.isDir) toggle(row.rel);
            }
          },
          style: {
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            paddingLeft: 8 + row.depth * 14,
            cursor: "pointer",
            whiteSpace: "nowrap",
            background: selected === row.rel ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
          },
          children: [
            jsx("span", { style: { width: 14, flexShrink: 0, display: "inline-block", textAlign: "center" }, children: row.isDir ? (isOpen ? "▾" : "▸") : "" }),
            jsx("span", { children: fileGlyph(row.name, row.isDir) }),
            jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: row.name }),
          ],
        });
      }),
    });
  }

  return jsx("div", {
    ref: panelRef,
    "data-wt-filetree": true,
    style: { position: "relative", minHeight: 0 },
    children: [
      body,
      menu &&
        jsx("div", {
          ref: menuRef,
          "data-wt-context-menu": true,
          style: {
            position: "absolute",
            left: menu.x,
            top: menu.y,
            zIndex: 30,
            minWidth: 150,
            background: "var(--dsw-alias-bg-float, #1f1f1f)",
            border: "1px solid var(--dsw-alias-border-l2, #333)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            padding: 4,
          },
          children: [
            jsx("div", {
              role: "menuitem",
              onClick: onCopy,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "复制绝对路径",
            }),
            jsx("div", {
              role: "menuitem",
              onClick: onInsert,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "发送到对话框",
            }),
          ],
        }),
    ],
  });
}
```

```js
// src/index.js —— client 插件入口（M2）
// 注册进 sidebar.workspaces（kind:single / scope:root）：
//   · priority: -1 遮蔽 shipped ui-workspace browser（单孔同 priority 重复注册会 throw，
//     数字越小越先渲染 —— dsh-client-ui-slots register 实测）
//   · root scope 拿不到 useInput/inputActions（session-scope 标准 prop）→ "发送到对话框"
//     经 conversation 服务直连 shell：ctx.get("conversation").input.shell(sessionId)
import { WorkspaceBrowser } from "./components/workspace-browser.js";
import { composeDraftInsert } from "./lib/insert.js";

export const name = "dsh-workspace-tools";
export const inject = ["slots", "sessions", "connection"];

export function apply(ctx) {
  ctx.slots.inject("sidebar.workspaces", () =>
    ctx.slots.register(
      {
        name: "sidebar.workspaces",
        priority: -1,
        inject: () => ({
          rpc: ctx.connection.rpc,
          openSession: (id) => ctx.sessions.open(id),
          insertIntoComposer: (sessionId, relPath) => {
            const conversation = ctx.get("conversation");
            if (!conversation) return false;
            try {
              const shell = conversation.input.shell(sessionId);
              const { draft } = shell.state.getSnapshot();
              shell.actions.setDraft(composeDraftInsert(draft, relPath));
              return true;
            } catch {
              return false;
            }
          },
        }),
      },
      WorkspaceBrowser,
    ),
  );
}

// 双保险：默认导出兼容按 default 解析的加载器（与 lib/index.js 同款）
export default { name, inject, apply };
```

- [ ] **Step 2: 语法检查 + 构建**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check src/index.js && node --check src/components/workspace-browser.js && node --check src/components/session-list.js && node --check src/components/file-tree.js && node build.mjs`
Expected: 4 个文件 `node --check` 通过；esbuild 构建无错误，`client.js` 更新。

- [ ] **Step 3: 静态验证 bundle 内容**

Run: `grep -c "data-wt-sidebar" client.js && grep -c "sidebar.workspaces" client.js && grep -c "priority" client.js && tail -c 200 client.js | grep -c "__ModuleLoader__.load"`
Expected: 均 ≥1（组件标记、slot 名、priority、ModuleLoader 收尾都在 bundle 内）；`grep -c "invalid plugin" client.js` = 0。

- [ ] **Step 4: 全量单测**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test`
Expected: 全绿（rpc 5 + workspace-fs 8 + git-diff 7 + console 4 + client-logic 11 = 35）。

- [ ] **Step 5: Commit**

```bash
git add src/index.js src/components/workspace-browser.js src/components/session-list.js src/components/file-tree.js client.js
git commit -m "feat: M2 file browser UI (3-tab sidebar, lazy file tree, context menu) + register sidebar.workspaces priority -1"
```

---

### Task 5: 验收验证与交付

**Files:**
- Modify: `docs/plans/2026-08-14-M2-file-explorer.md`（勾选完成项）
- 无新代码。

- [x] **Step 1: harness 实际 serve 新 bundle**

Run: `curl -s http://127.0.0.1:3080/plugins/dsh-workspace-tools/client.js | wc -c && curl -s http://127.0.0.1:3080/plugins/dsh-workspace-tools/client.js | grep -c "data-wt-sidebar"`
Expected: 字节数较 M1（1330）明显增大；`data-wt-sidebar` ≥1（serveBundle 每请求 readFile + no-cache，无需重启 harness）。
结果（2026-08-15）：**16341 字节**、`data-wt-sidebar`=1、`sidebar.workspaces`=2、HTTP 200 ✅。

- [ ] **Step 2: GUI 手动验收（浏览器刷新 127.0.0.1:3080）**

> ⚠️ **前置条件（2026-08-15 实测）**：当前 harness（PID 5846，17:50 启动）仍运行 **M1 host 插件**——client.js 每请求实时读盘已是新版，但 host RPC handler 需**重启 harness 后**才加载 Task 1 的契约修正（实测所有 `/workspace-tools/*` 调用返回旧版 `unknown-op`）。刷新浏览器可见三段页签与文件树骨架，但树数据需重启后加载。**重启会断开当前会话**，故由用户在适当时机执行后逐项勾选：

- [ ] 刷新后控制台无 `invalid plugin` / slot 报错；侧边栏出现 会话/文件/变更 三段切换条（shipped browser 被遮蔽）。
- [ ] 文件页签：显示当前会话 cwd 的目录树（目录优先、dot 条目隐藏）。
- [ ] 点击目录折叠/展开；深层目录首次展开有"加载中…"瞬时态（懒加载）。
- [ ] 点击文件仅选中（高亮），不打开任何东西。
- [ ] 文件右键 → 复制绝对路径：粘贴后为 `cwd` 下绝对路径。
- [ ] 文件右键 → 发送到对话框：相对路径追加到输入框 draft 末尾（带空格分隔）；draft 为空时直接填入。
- [ ] 会话页签：列出会话标题，当前会话高亮，点击切换会话。
- [ ] 切换工作区/会话后文件树重新加载（根跟随新 cwd，展开状态清零）。
- [ ] 变更页签显示"变更列表将在 M3 提供"占位。

- [ ] **Step 3: 提交 + 推送 GitHub（私有仓库）**

```bash
git add docs/plans/2026-08-14-M2-file-explorer.md
git commit -m "docs: M2 file explorer plan accepted"
TOKEN=$(grep -oE 'github_pat_[A-Za-z0-9_]+' ~/.dsh/profiles/web/cordis.patch.yml | head -1)
git push "https://x-access-token:${TOKEN}@github.com/g1998815/dsh-workspace-tools.git" main:main
```

Expected: 推送成功（可用 `git ls-remote https://github.com/g1998815/dsh-workspace-tools.git main` 复核；无凭据终端会提示 Username，属预期）。

---

## 里程碑验收清单（M2）

- [x] `node --test` 全绿（**42 用例**：rpc 5 / workspace-fs 8 / git-diff 7 / console 4 / client-logic 11 / rpc-integration 7）。
- [x] host RPC 契约修正落地：handler `(endpoint, payload)` + `ok/fail` 信封 + `failFrom` 封闭枚举映射 + fail-closed cwd 会话校验（Task 1 + rpc-integration 测试覆盖）。
- [x] dotfile 策略统一为"全部 dot 条目隐藏"，纯函数与 RPC 路径一致（Task 2）。
- [x] client 纯逻辑层有单测（RPC 解包 / 树行计算 / draft 插入，Task 3）。
- [x] `client.js` 重建并提交；harness curl 返回含 `data-wt-sidebar` 的新 bundle（16341B）。
- [x] relPath 包含校验（`assertInside` 拦截越界）+ `session-conflict` 信封 schema 安全 + 子目录错误可见可重试 + guard 分发集成测试（终审修复 01df90f）。
- [ ] GUI 手动验收 9 项全部通过（Task 5 Step 2 —— **需重启 harness 后由用户勾选**）。
- [x] 推送至 GitHub 私有仓库 main 分支。

## 后续（非 M2 范围）

- **M3 变更 + diff**：host `gitDiff` 纯函数（M1 Task 4）已就绪；client 复用 M2 的 `callRpc` 管线与页签框架，把"变更"占位替换为变更列表 + diff 渲染（含未跟踪全文视图）；RPC 端点 `git.listChanges`/`git.getDiff` 已按信封契约修正。
- **M4 控制台**：client 底部面板 + 多标签 PTY；host `console` 服务（M1 Task 6）与 WS 泵（lib/index.js 未改动段）已就绪；RPC 端点 `console.create/write/kill` 已按信封契约修正（`session-not-found` 用枚举内 code）。
- **已知缺口（本计划刻意不做）**：文件树无 size/mtime 展示（RPC 未带）；"发送到对话框"为追加末尾而非光标处插入（caret 未发布）；会话页签为最小列表（非 shipped browser 全功能）；`console.create` 的 Windows 真机验证仍属 M4 验收项。

## 改版记录（2026-08-15，用户 UI 要求）

用户验收后提出：插件 UI 不要遮蔽左侧工作区侧边栏，改为**右侧独立工具侧边栏，可点击收起/展开**。已实施：

- `src/index.js`：注册点从 `sidebar.workspaces`（priority -1 遮蔽 shipped browser）改为 **`shell.overlay`**（list 孔 / scope:root，ui-layout 声明的浮层，id `dsh-workspace-tools`）——shipped 工作区浏览器恢复原样，与工具侧边栏互不重合。
- `src/components/workspace-browser.js`：导出 `RightSidebar`，外壳 = 右缘浮层（absolute right/top/bottom:0，z-index 5，300px 宽）+ 左侧收展按钮（`data-wt-toggle`，收起后仅剩 18px 按钮条）；三段页签内容不变。
- 构建 `client.js` 并提交；44/44 单测通过（`sidebar.workspaces` 不再出现在 bundle）。
- **运维教训（实测）**：重启 harness 时 profile 可能被重建（插件 symlink 与 `cordis.patch.yml` 追加行丢失，表现为 `/plugins/<id>/client.js` 404 + RPC 405）——重启后若插件消失，重跑 `node scripts/install.mjs`（幂等）再重启。
