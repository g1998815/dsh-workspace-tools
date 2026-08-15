# M3 变更 + diff 实现计划（dsh-workspace-tools）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右侧工具侧边栏"变更"页签从占位替换为 git 变更列表 + unified diff 渲染（含未跟踪全文视图），复用 M2 的 `callRpc` 管线与 fail-closed sessionId 模式。

**Architecture:** client-only 里程碑。host `gitDiff` 服务（M1 Task 4）与 RPC 信封契约（M2 Task 1）已就绪——`git.listChanges`/`git.getDiff` 端点现要求 `sessionId` + 匹配 cwd（fail-closed，M3 client 必须携带）。沿用 M2 模式：纯逻辑下沉 `src/lib/git-changes.js`（列表规范化/分组/折叠 + unified diff 行解析，node:test 直测），组件 `src/components/changes.js` 只做渲染与 RPC 接线，`workspace-browser.js` 替换占位。

**Tech Stack:** Node.js ≥ 22（ESM）、`node:test`、esbuild（同 M2）、React 18 + `react/jsx-runtime`（external）。

**设计决策（本计划定稿）：**
- **diff 渲染统一走 unified 解析器**：host `getDiff` 对已跟踪返回 `git diff -- <file>`，对未跟踪已构造 `--- /dev/null\n+++ b/<file>\n@@ -0,0 +1,N @@\n+...`（M1 Task 4）——两者都是 unified 格式，client 只需一个 `parseDiff` 行解析器（hunk 头行号累计 + add/del/ctx 分类），无需单独未跟踪视图构造。
- **状态徽章用单字母**（M/??/D/A/R），色彩区分：M 黄、?? 灰、D 红、A 绿、R 蓝（CSS 变量 + 兜底色）。
- **目录分组**：`dir` 行（▸/▾ + 目录 + 计数）可折叠（`collapsed: Set<dir>`）；根级文件归 `""` 组。
- **刷新**：cwd 变化（key/effect）自动重载 + 手动刷新按钮（重载列表；若选中项仍在列表则重取 diff）；点击文件总是现取现渲染（展开即刷新语义）。
- **sessionId 必带**（M2 fail-closed）：`git.listChanges`/`git.getDiff` payload 一律 `{ cwd, sessionId }`。
- 无 host 改动、无新依赖。

## Global Constraints

- 仓库位置：`/Volumes/data/code/dsh-workspace-tools`（独立 git 仓库）。
- client 束契约（M1/M2 已定）：`exports["./client"]` → `client.js`；build.mjs 为 **CJS wrapper 形态**（`window.__ModuleLoader__.load({id, factory})` 在文件首行，结尾 `return module.exports`——不是 iife+footer）；`react`/`react/jsx-runtime`/`@deepseek-ai/*` external；**`client.js` 已入库，改动后必须重建提交**。
- RPC 契约（M2 Task 1 定稿）：handler `(endpoint, payload)`；`{ok:true, value}` / `{ok:false, error}` 信封；`sessionId` 必带，缺失 → `bad-request`、未知 → `session-not-found`、cwd 不匹配 → `session-conflict`（枚举 code）。
- git 命令一律 `-c core.quotepath=false`（M1 已实现于 host）。
- 测试基线：44 全绿（M2 末）。M3 新增 git-changes 单测。
- 环境事实：node 不在 PATH（`export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH` 前缀）；harness = `dsh web` @ 3080（host 改动需重启；**M3 无 host 改动，client.js 重建后浏览器刷新即生效**）；重启会重建 profile 注册（插件 symlink/patch 丢失时重跑 `node scripts/install.mjs`）。

---

### Task 1: client 纯逻辑 `src/lib/git-changes.js`（列表规范化/分组/折叠 + unified diff 解析）

**Files:**
- Create: `src/lib/git-changes.js`
- Create: `test/git-changes.test.js`

**Interfaces:**
- Produces（Task 2 组件直接消费）:
  - `normalizeChanges(raw) → Array<{status, untracked, path, dir, base}>`（raw = RPC `value.changes`；dir = 路径目录部分，根为 `""`；base = 文件名）
  - `statusLabel(s) → string`（`??`→未跟踪 / `M`→修改 / `D`→删除 / `A`→新增 / `R`→重命名 / 其他原样）
  - `groupByDir(changes) → Array<{dir, items}>`（保持输入顺序）
  - `visibleRows(groups, collapsed:Set) → Array<{kind:"dir", dir, count} | {kind:"file", ...change}>`（折叠组只出 dir 行）
  - `parseDiff(text) → Array<{kind:"hunk"|"meta"|"add"|"del"|"ctx", text, oldLine, newLine}>`（unified diff 行解析，hunk 头行号累计；add 无 oldLine、del 无 newLine）

- [ ] **Step 1: 写失败测试**

```js
// test/git-changes.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChanges, statusLabel, groupByDir, visibleRows, parseDiff } from "../src/lib/git-changes.js";

test("normalizeChanges: 拆分 dir/base 并保留状态", () => {
  const out = normalizeChanges([
    { status: "M", path: "src/a.js", untracked: false },
    { status: "??", path: "new.txt", untracked: true },
    { status: "D", path: "deep/nested/b.ts", untracked: false },
  ]);
  assert.deepEqual(out, [
    { status: "M", untracked: false, path: "src/a.js", dir: "src", base: "a.js" },
    { status: "??", untracked: true, path: "new.txt", dir: "", base: "new.txt" },
    { status: "D", untracked: false, path: "deep/nested/b.ts", dir: "deep/nested", base: "b.ts" },
  ]);
  assert.deepEqual(normalizeChanges(undefined), []);
});

test("statusLabel: 常用状态中文", () => {
  assert.equal(statusLabel("??"), "未跟踪");
  assert.equal(statusLabel("M"), "修改");
  assert.equal(statusLabel("D"), "删除");
  assert.equal(statusLabel("A"), "新增");
  assert.equal(statusLabel("R"), "重命名");
  assert.equal(statusLabel("X"), "X");
});

test("groupByDir: 按目录分组且保持顺序", () => {
  const changes = normalizeChanges([
    { status: "M", path: "a.js" },
    { status: "??", path: "src/b.js" },
    { status: "M", path: "src/c.js" },
    { status: "D", path: "root.txt" },
  ]);
  const groups = groupByDir(changes);
  assert.deepEqual(groups.map((g) => g.dir), ["", "src"]);
  assert.deepEqual(groups[1].items.map((i) => i.base), ["b.js", "c.js"]);
});

test("visibleRows: 折叠组只出 dir 行", () => {
  const groups = groupByDir(normalizeChanges([
    { status: "M", path: "a.js" },
    { status: "??", path: "src/b.js" },
  ]));
  const open = visibleRows(groups, new Set());
  assert.deepEqual(open.map((r) => [r.kind, r.dir ?? r.base]), [["dir", ""], ["file", "a.js"], ["dir", "src"], ["file", "b.js"]]);
  const closed = visibleRows(groups, new Set(["src"]));
  assert.deepEqual(closed.map((r) => [r.kind, r.dir ?? r.base]), [["dir", ""], ["file", "a.js"], ["dir", "src"]]);
});

test("parseDiff: 标准 unified diff（hunk 行号累计 + 分类）", () => {
  const lines = parseDiff(
    "diff --git a/src/a.js b/src/a.js\n" +
      "index 111..222 100644\n" +
      "--- a/src/a.js\n" +
      "+++ b/src/a.js\n" +
      "@@ -10,3 +10,4 @@\n" +
      " context\n" +
      "-old line\n" +
      "+new line\n" +
      " tail\n",
  );
  assert.deepEqual(lines.map((l) => l.kind), ["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add", "ctx"]);
  assert.deepEqual(lines[5], { kind: "ctx", text: " context", oldLine: 10, newLine: 10 });
  assert.deepEqual(lines[6], { kind: "del", text: "-old line", oldLine: 11, newLine: null });
  assert.deepEqual(lines[7], { kind: "add", text: "+new line", oldLine: null, newLine: 11 });
  assert.deepEqual(lines[8], { kind: "ctx", text: " tail", oldLine: 12, newLine: 12 });
});

test("parseDiff: 未跟踪全新增视图（/dev/null 头）", () => {
  const lines = parseDiff("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n");
  assert.deepEqual(lines.map((l) => l.kind), ["meta", "meta", "hunk", "add", "add"]);
  assert.deepEqual(lines[3], { kind: "add", text: "+hello", oldLine: null, newLine: 1 });
  assert.deepEqual(lines[4], { kind: "add", text: "+world", oldLine: null, newLine: 2 });
});

test("parseDiff: 空文本", () => {
  assert.deepEqual(parseDiff(""), []);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/git-changes.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```js
// src/lib/git-changes.js —— 变更列表 + unified diff 纯逻辑（无 React 依赖）
export function normalizeChanges(raw) {
  return (raw ?? []).map((c) => {
    const path = c.path ?? "";
    const idx = path.lastIndexOf("/");
    return {
      status: c.status,
      untracked: !!c.untracked,
      path,
      dir: idx === -1 ? "" : path.slice(0, idx),
      base: idx === -1 ? path : path.slice(idx + 1),
    };
  });
}

export function statusLabel(s) {
  switch (s) {
    case "??": return "未跟踪";
    case "M": return "修改";
    case "D": return "删除";
    case "A": return "新增";
    case "R": return "重命名";
    default: return s;
  }
}

export function groupByDir(changes) {
  const groups = [];
  const byDir = new Map();
  for (const c of changes) {
    if (!byDir.has(c.dir)) {
      byDir.set(c.dir, []);
      groups.push({ dir: c.dir, items: byDir.get(c.dir) });
    }
    byDir.get(c.dir).push(c);
  }
  return groups;
}

export function visibleRows(groups, collapsed) {
  const rows = [];
  for (const g of groups) {
    rows.push({ kind: "dir", dir: g.dir, count: g.items.length });
    if (collapsed.has(g.dir)) continue;
    for (const it of g.items) rows.push({ kind: "file", ...it });
  }
  return rows;
}

// unified diff 行解析：meta/hunk 不带行号；add/del/ctx 带行号（从 hunk 头累计）
export function parseDiff(text) {
  if (!text) return [];
  const lines = [];
  let oldLine = null;
  let newLine = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = m ? Number(m[1]) : null;
      newLine = m ? Number(m[2]) : null;
      lines.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line, oldLine: null, newLine });
      if (newLine !== null) newLine += 1;
    } else if (line.startsWith("-")) {
      lines.push({ kind: "del", text: line, oldLine, newLine: null });
      if (oldLine !== null) oldLine += 1;
    } else if (line.startsWith(" ")) {
      lines.push({ kind: "ctx", text: line, oldLine, newLine });
      if (oldLine !== null) oldLine += 1;
      if (newLine !== null) newLine += 1;
    } else {
      // ""、"\ No newline at end of file" 等
      lines.push({ kind: "ctx", text: line, oldLine: null, newLine: null });
    }
  }
  return lines;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/git-changes.test.js`
Expected: 7 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/git-changes.js test/git-changes.test.js
git commit -m "feat: git changes pure logic (normalize/group/collapse + unified diff parse)"
```

---

### Task 2: 变更页签组件 + 接线 + 构建

**Files:**
- Create: `src/components/changes.js`
- Modify: `src/components/workspace-browser.js`（"变更"占位替换为 `<Changes>`）

**Interfaces:**
- Consumes: Task 1 的 `normalizeChanges`/`groupByDir`/`visibleRows`/`parseDiff`/`statusLabel`；`callRpc`（src/lib/rpc.js）；注入 prop `cwd`/`sessionId`/`rpc`。
- Produces: 变更页签（分组列表 + 状态徽章 + 折叠 + 刷新 + diff 面板渲染）。

- [ ] **Step 1: 写组件并接线**

```js
// src/components/changes.js
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { normalizeChanges, groupByDir, visibleRows, parseDiff, statusLabel } from "../lib/git-changes.js";

const STATUS_COLOR = {
  M: "#e6b450",
  "??": "#9a9a9a",
  D: "#e06c75",
  A: "#7ec699",
  R: "#61afef",
};

export function Changes({ cwd, sessionId, rpc }) {
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selected, setSelected] = useState(null); // { path, untracked }
  const [diffLines, setDiffLines] = useState(null);
  const [diffError, setDiffError] = useState(null);

  const load = useCallback(() => {
    if (!cwd) {
      setGroups([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    callRpc(rpc, "git.listChanges", { cwd, sessionId })
      .then((value) => {
        setGroups(groupByDir(normalizeChanges(value.changes)));
        setStatus("ready");
        setError(null);
      })
      .catch((err) => {
        setStatus("error");
        setError(String(err?.message ?? err));
      });
  }, [cwd, rpc, sessionId]);

  // cwd 变化（工作区切换）→ 重载并清空选中
  useEffect(() => {
    setSelected(null);
    setDiffLines(null);
    setDiffError(null);
    setCollapsed(new Set());
    load();
  }, [load]);

  const openFile = useCallback(
    (c) => {
      setSelected({ path: c.path, untracked: c.untracked });
      setDiffLines(null);
      setDiffError(null);
      callRpc(rpc, "git.getDiff", { cwd, file: c.path, untracked: c.untracked, sessionId })
        .then((value) => setDiffLines(parseDiff(value.diff)))
        .catch((err) => setDiffError(String(err?.message ?? err)));
    },
    [cwd, rpc, sessionId],
  );

  const toggleDir = useCallback((dir) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  const rows = useMemo(() => visibleRows(groups, collapsed), [groups, collapsed]);

  let list;
  if (status === "loading") {
    list = jsx("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (status === "error") {
    list = jsx("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: error });
  } else if (rows.length === 0) {
    list = jsx("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "没有变更" });
  } else {
    list = jsx("div", {
      "data-wt-changes-list": true,
      children: rows.map((row) =>
        row.kind === "dir"
          ? jsx("div", {
              key: `dir-${row.dir}`,
              "data-wt-changes-dir": true,
              onClick: () => toggleDir(row.dir),
              style: {
                padding: "4px 10px",
                fontWeight: 600,
                cursor: "pointer",
                color: "var(--dsw-alias-text-secondary, #999)",
                display: "flex",
                gap: 6,
                alignItems: "center",
              },
              children: [
                jsx("span", { children: collapsed.has(row.dir) ? "▸" : "▾" }),
                jsx("span", { children: row.dir === "" ? "（根目录）" : row.dir }),
                jsx("span", { style: { opacity: 0.6 }, children: `${row.count}` }),
              ],
            })
          : jsx("div", {
              key: `file-${row.path}`,
              role: "button",
              "data-wt-changes-file": true,
              "data-selected": selected?.path === row.path || undefined,
              onClick: () => openFile(row),
              style: {
                padding: "3px 10px",
                paddingLeft: 26,
                cursor: "pointer",
                display: "flex",
                gap: 6,
                alignItems: "center",
                background: selected?.path === row.path ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
              },
              children: [
                jsx("span", {
                  style: {
                    width: 20,
                    textAlign: "center",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: STATUS_COLOR[row.status] ?? "#ccc",
                    border: `1px solid ${STATUS_COLOR[row.status] ?? "#ccc"}`,
                    borderRadius: 3,
                    flexShrink: 0,
                  },
                  children: row.status === "??" ? "?" : row.status,
                }),
                jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: row.base }),
              ],
            }),
      ),
    });
  }

  let diffPanel = null;
  if (selected) {
    if (diffError) {
      diffPanel = jsx("div", { "data-wt-diff-error": true, style: { padding: 12, color: "#e06c75", borderTop: "1px solid var(--dsw-alias-border-l2, #333)" }, children: diffError });
    } else if (!diffLines) {
      diffPanel = jsx("div", { "data-wt-diff-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)", borderTop: "1px solid var(--dsw-alias-border-l2, #333)" }, children: "加载 diff…" });
    } else {
      diffPanel = jsx("div", {
        "data-wt-diff": true,
        style: {
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
          maxHeight: "45%",
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "11px",
          flexShrink: 0,
        },
        children: [
          jsx("div", {
            "data-wt-diff-head": true,
            style: { padding: "6px 10px", color: "var(--dsw-alias-text-secondary, #999)", background: "var(--dsw-alias-bg-float, #1f1f1f)" },
            children: `${selected.path} · ${statusLabel(selected.untracked ? "??" : "M")}`,
          }),
          jsx("div", {
            children: diffLines.map((l, i) => {
              let bg = "none";
              let color = "var(--dsw-alias-text-primary, #ddd)";
              if (l.kind === "add") { bg = "rgba(126,198,153,0.15)"; color = "#7ec699"; }
              else if (l.kind === "del") { bg = "rgba(224,108,117,0.15)"; color = "#e06c75"; }
              else if (l.kind === "hunk") { bg = "rgba(97,175,239,0.12)"; color = "#61afef"; }
              else if (l.kind === "meta") { color = "var(--dsw-alias-text-secondary, #999)"; }
              const oldCell = l.oldLine !== null ? String(l.oldLine) : " ";
              const newCell = l.newLine !== null ? String(l.newLine) : " ";
              return jsx("div", {
                key: i,
                "data-wt-diff-line": true,
                "data-kind": l.kind,
                style: { display: "flex", background: bg, color, padding: "0 6px", whiteSpace: "pre" },
                children: [
                  jsx("span", { style: { width: 42, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 4 }, children: oldCell }),
                  jsx("span", { style: { width: 42, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 6 }, children: newCell }),
                  jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: l.text }),
                ],
              });
            }),
          }),
        ],
      });
    }
  }

  return jsx("div", {
    "data-wt-changes": true,
    style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
    children: [
      jsx("div", {
        style: { display: "flex", justifyContent: "flex-end", padding: "2px 6px", flexShrink: 0 },
        children: jsx("button", {
          type: "button",
          "data-wt-refresh": true,
          onClick: load,
          style: { background: "none", border: "none", cursor: "pointer", color: "var(--dsw-alias-text-secondary, #999)", fontSize: "12px", padding: "2px 8px" },
          children: "↻ 刷新",
        }),
      }),
      jsx("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: list }),
      diffPanel,
    ],
  });
}
```

`src/components/workspace-browser.js` 改动（import + 占位替换）：

```js
import { Changes } from "./changes.js";
```
并将占位三元替换为：
```js
                    : jsx(Changes, { cwd, sessionId: current, rpc }),
```

- [ ] **Step 2: 语法检查 + 构建 + 全量测试**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check src/components/changes.js && node build.mjs && node --test`
Expected: check 通过；构建成功；51 全绿（44 + git-changes 7）。

- [ ] **Step 3: 静态验证 bundle**

Run: `grep -c "data-wt-changes" client.js && grep -c "data-wt-diff" client.js && head -3 client.js`
Expected: 均 ≥1；首行为 `window.__ModuleLoader__.load({`（CJS wrapper 形态）。

- [ ] **Step 4: Commit**

```bash
git add src/components/changes.js src/components/workspace-browser.js client.js
git commit -m "feat: M3 changes tab (grouped change list + unified diff view with untracked full view)"
```

---

## 里程碑验收清单（M3）

- [x] `node --test` 全绿（51 用例：44 + git-changes 7）。
- [x] harness curl `client.js` 含 `data-wt-changes`（4）/`data-wt-diff`（5），HTTP 200（serveBundle 实时读盘，**刷新浏览器即生效，无需重启**——M3 无 host 改动）。
- [x] 已推送 GitHub main（`cb147b8`）。
- [ ] GUI 手动验收：
  - [ ] 变更页签：显示当前会话 cwd 的 git 变更列表（状态徽章 M/??/D、目录分组、根目录组）。
  - [ ] 点击目录行折叠/展开。
  - [ ] 点击文件 → 下方 diff 面板：unified 渲染（行号、红删绿加、hunk 头），未跟踪文件显示全新增视图。
  - [ ] "↻ 刷新"按钮重载列表。
  - [ ] 切换工作区后列表自动重载。
  - [ ] 无变更时显示"没有变更"。

## 完成记录（2026-08-15）

- Task 1 接口定稿：`visibleRows` 的 file 行**不带 `dir`**（含 `status/untracked/path/base`）——brief 的 `{kind:"file", ...change}` 描述为此过时，组件按实际字段消费（Task 2 审查确认）。
- Task 1 实现修正（brief 内部不一致，审查验证必要）：`visibleRows` 解构去掉 file 行的 `dir`；`parseDiff` 跳过 split 产生的尾部空行。
- 已知 Minor（不阻塞）：diff 头部状态标签对已跟踪固定显示"修改"；cwd 切换时 in-flight RPC 无取消守卫（React 18 容忍）；无 cwd 时空态文案"没有变更"；超长 diff 行省略不滚动；diff 行以索引为 key。

## 后续（非 M3 范围）

- **M4 控制台**：client 底部面板 + 多标签 PTY；host `console` 服务与 WS 泵已就绪；RPC 端点 `console.create/write/kill` 已按信封契约修正。
- **M3 已知缺口（YAGNI）**：diff 侧边栏视图（spec 明确不做 side-by-side）；文件级 staged/unstaged 分组（合并显示）；变更数量徽章在页签栏；diff 行点击复制。
