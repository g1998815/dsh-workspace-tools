# M3d 提交详情窗口 实现计划（dsh-workspace-tools）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击"变更"页签下半区提交历史中的某条提交 → 弹出提交详情浮窗：列出该提交改动的文件（状态徽章 A/M/D/R），点击文件 → 显示该文件的 diff（行号 + 红删绿加 + hunk）。

**Architecture:** host 扩展 `lib/services/git-history.js` 新增两个**只读**纯函数：`showCommitFiles`（`git show --format= --name-status <target>`，解析 `A/M/D/R100` 等 tab 分隔行）与 `showCommitFile`（`git show <target> -- <file>` 单文件 unified diff），target 复用 `TARGET_RE` 校验、file 拒绝绝对/越界路径；RPC 端点 `git.show` / `git.showFile`（guardCwd fail-closed）。client：从 `diff-window.js` 抽出公共 `DiffLines` 行渲染组件（行为保持），新建 `commit-detail-window.js`（DraggableWindow 外壳 + 文件列表 + 内嵌 DiffLines），`changes.js` 历史行点击打开详情窗（保留回退条交互）。

**Tech Stack:** Node.js ≥ 22（ESM）、`node:test`、esbuild、React 18 + `react/jsx-runtime`、git CLI（`-c core.quotepath=false`）。

**设计决策（本计划定稿）：**
- **只读**：show/showFile 均为只读 git 查询（`git show` 不改仓库），无需 reset 那种两段式确认；仍走 `guardCwd`（fail-closed sessionId）。
- **target 校验**：复用 `TARGET_RE`（/^[0-9a-f]{4,40}$/，从 git-history.js 导出）；**file 校验**：非空 string、不以 `/` 开头、不含 `..`（提交内路径，非工作区路径，不能用 assertInside；只读查询 + 校验已足够）。
- **name-status 解析**：`A\tpath` / `M\tpath` / `D\tpath` / `R100\told\tnew` / `C100\told\tnew`——状态取首字符（A/M/D/R/C），路径取最后一段（rename/copy 的**新**路径）。
- **DiffLines 抽取**：diff-window 的行渲染（行号列 + kind 颜色 + data-wt-match 高亮 + data-line 定位）抽为 `src/components/diff-lines.js`，diff-window 与 commit-detail-window 共用（行为保持，`data-wt-diff-line` 等标记保留）。
- **详情窗交互**：DraggableWindow 外壳（title=`<shortHash> 的变更`）；文件列表（状态徽章 + 路径，data-wt-commit-file）；点击文件 → `git.showFile` → parseDiff → 窗口内嵌 DiffLines；文件切换时重置 diff 状态；加载/错误态完整。
- **历史行接线**：`changes.js` 历史行点击 = 设 selCommit（回退条，保留现有交互）+ 打开详情浮窗（新状态 `detail: {hash, shortHash}|null`）。

## Global Constraints

- 仓库位置：`/Volumes/data/code/dsh-workspace-tools`。
- client 束契约：`client.js` 已入库，改动后必须重建提交；build.mjs 为 CJS wrapper 形态；`react`/`react/jsx-runtime`/`@deepseek-ai/*` external；src 内不 import @deepseek-ai/*。
- RPC 契约（M2 定稿）：handler `(endpoint, payload)`；`{ok:true,value}` / `{ok:false,error}` 信封；`sessionId` 必带（fail-closed）；错误 code 仅限预置枚举（`failFrom` 映射）。
- git 命令一律 `-c core.quotepath=false`；`execFile` 数组参数。
- 测试基线：74 全绿。M3d 预计新增：Task 1 +5、Task 2 无（UI）→ 终态 79。
- **host 改动需重启 harness 生效**（lib/index.js + git-history.js；重启后插件注册若丢失重跑 `node scripts/install.mjs`）；client.js 刷新即生效。
- 环境事实：node 不在 PATH（`export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH` 前缀）。

---

### Task 1: host git.show / git.showFile（纯函数 + RPC）

**Files:**
- Modify: `lib/services/git-history.js`（导出 `TARGET_RE`；新增两个函数）
- Modify: `test/git-history.test.js`（新增 5 用例）
- Modify: `lib/index.js`（新增 `git.show` / `git.showFile` 两个 case）

**Interfaces:**
- Produces:
  - `export const TARGET_RE`（原模块内正则，改为导出）
  - `showCommitFiles(cwd, target) → Promise<{files: Array<{status, path}>}>`
  - `showCommitFile(cwd, target, file) → Promise<{diff}>`（unified diff 文本）
  - 错误：`invalid-target` / `invalid-file` / 沿用 runGit 结构化错误
- Consumes: `runGit`、`ensureRepo`（模块内）。

- [ ] **Step 1: 写失败测试（追加到 test/git-history.test.js）**

```js
test("showCommitFiles: 提交的文件列表（M/A，rename 取新路径）", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "b.txt"), "hi\n");
    repo.git(["add", "b.txt"]);
    repo.git(["commit", "-qm", "add b"]);
    writeFileSync(join(repo.dir, "a.txt"), "one\nchanged\n");
    repo.git(["add", "a.txt"]);
    repo.git(["commit", "-qm", "modify a"]);
    const { commits } = await logCommits(repo.dir);
    const { files } = await showCommitFiles(repo.dir, commits[0].hash); // modify a
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.status]));
    assert.equal(byPath["a.txt"], "M");
    const { files: files2 } = await showCommitFiles(repo.dir, commits[1].hash); // add b
    assert.deepEqual(files2.map((f) => [f.status, f.path]), [["A", "b.txt"]]);
  } finally {
    repo.cleanup();
  }
});

test("showCommitFiles: 非法 target 拒绝", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(showCommitFiles(repo.dir, "abc;rm"), (e) => e.code === "invalid-target");
  } finally {
    repo.cleanup();
  }
});

test("showCommitFile: 返回该文件 unified diff", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "one\nchanged\n");
    repo.git(["add", "a.txt"]);
    repo.git(["commit", "-qm", "modify a"]);
    const { commits } = await logCommits(repo.dir);
    const { diff } = await showCommitFile(repo.dir, commits[0].hash, "a.txt");
    assert.match(diff, /^diff --git/);
    assert.match(diff, /\+changed/);
  } finally {
    repo.cleanup();
  }
});

test("showCommitFile: 非法 file 拒绝（绝对/越界/空）", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(showCommitFile(repo.dir, "HEAD", "/etc/passwd"), (e) => e.code === "invalid-file");
    await assert.rejects(showCommitFile(repo.dir, "HEAD", "../x"), (e) => e.code === "invalid-file");
    await assert.rejects(showCommitFile(repo.dir, "HEAD", ""), (e) => e.code === "invalid-file");
  } finally {
    repo.cleanup();
  }
});

test("showCommitFile: 非法 target 拒绝", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(showCommitFile(repo.dir, "zzz", "a.txt"), (e) => e.code === "invalid-target");
  } finally {
    repo.cleanup();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/git-history.test.js`
Expected: 新 5 用例 FAIL（函数不存在）。

- [ ] **Step 3: 写实现（git-history.js 追加）**

把模块内 `const TARGET_RE = ...` 改为 `export const TARGET_RE = ...`，并追加：

```js
// 提交详情（只读）：文件列表 + 单文件 diff
export async function showCommitFiles(cwd, target) {
  await ensureRepo(cwd);
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw { code: "invalid-target", message: `非法提交目标: ${target}` };
  }
  const out = await runGit(cwd, ["show", "--format=", "--name-status", target]);
  const files = out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const parts = line.split("\t");
      // `A\tpath` / `M\tpath` / `D\tpath` / `R100\told\tnew` / `C100\told\tnew`
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
  return { files };
}

export async function showCommitFile(cwd, target, file) {
  await ensureRepo(cwd);
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw { code: "invalid-target", message: `非法提交目标: ${target}` };
  }
  if (typeof file !== "string" || file === "" || file.startsWith("/") || file.includes("..")) {
    throw { code: "invalid-file", message: `非法文件路径: ${file}` };
  }
  const diff = await runGit(cwd, ["show", target, "--", file]);
  return { diff };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/git-history.test.js`
Expected: 12 个用例 PASS（7 + 5）。

- [ ] **Step 5: lib/index.js 追加两个 case**（`git.log` 之后）+ import 更新：

```js
            case "git.show": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await showCommitFiles(payload.cwd, payload.target));
            }
            case "git.showFile": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await showCommitFile(payload.cwd, payload.target, payload.file));
            }
```

`import { logCommits, commitAll, resetTo, currentBranch, showCommitFiles, showCommitFile } from "./services/git-history.js";`

- [ ] **Step 6: 语法 + 全量测试**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check lib/index.js && node --check lib/services/git-history.js && node --test`
Expected: check 通过；79 全绿（74 + 5）。

- [ ] **Step 7: Commit**

```bash
git add lib/services/git-history.js test/git-history.test.js lib/index.js
git commit -m "feat: git.show/git.showFile endpoints (commit files + per-file diff, read-only)"
```

---

### Task 2: client 提交详情浮窗（DiffLines 抽取 + commit-detail-window + 历史行接线）

**Files:**
- Create: `src/components/diff-lines.js`（从 diff-window.js 抽出）
- Modify: `src/components/diff-window.js`（改用 DiffLines，行为保持）
- Create: `src/components/commit-detail-window.js`
- Modify: `src/components/changes.js`（历史行点击打开详情窗）
- Modify: `client.js`（重建）

**Interfaces:**
- Produces: `DiffLines({ lines, matches })`（纯渲染：行号列 + kind 颜色 + data-wt-match 高亮 + `data-line` 定位）；`CommitDetailWindow({ target, cwd, sessionId, rpc, onClose })`（DraggableWindow 外壳：文件列表 + 点击文件内嵌 DiffLines）。
- Consumes: Task 1 RPC `git.show`/`git.showFile`；`parseDiff`；`DraggableWindow`；`callRpc`。

- [ ] **Step 1: 抽 DiffLines 组件**

从 `diff-window.js` 的 diff 行渲染块（含 data-wt-diff-line/data-kind/data-line/data-wt-match/行号列/颜色）抽出：

```js
// src/components/diff-lines.js —— unified diff 行渲染（行号列 + 红删绿加 + hunk + 匹配高亮）
import { jsx } from "react/jsx-runtime";

export function DiffLines({ lines, matches = [] }) {
  return jsx("div", {
    "data-wt-diff": true,
    style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", paddingBottom: 8 },
    children: lines.map((l, i) => {
      let bg = "none";
      let color = "var(--dsw-alias-text-primary, #ddd)";
      if (l.kind === "add") { bg = "rgba(126,198,153,0.15)"; color = "#7ec699"; }
      else if (l.kind === "del") { bg = "rgba(224,108,117,0.15)"; color = "#e06c75"; }
      else if (l.kind === "hunk") { bg = "rgba(97,175,239,0.12)"; color = "#61afef"; }
      else if (l.kind === "meta") { color = "var(--dsw-alias-text-secondary, #999)"; }
      const isMatch = matches.includes(i);
      if (isMatch) { bg = "rgba(230,180,80,0.28)"; color = "#f0d59a"; }
      const oldCell = l.oldLine !== null ? String(l.oldLine) : " ";
      const newCell = l.newLine !== null ? String(l.newLine) : " ";
      return jsx("div", {
        key: i,
        "data-line": i,
        "data-wt-diff-line": true,
        "data-kind": l.kind,
        "data-wt-match": isMatch || undefined,
        style: { display: "flex", background: bg, color, padding: "0 8px", whiteSpace: "pre" },
        children: [
          jsx("span", { style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 4 }, children: oldCell }),
          jsx("span", { style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 8 }, children: newCell }),
          jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: l.text }),
        ],
      });
    }),
  });
}
```

`diff-window.js` 中 diff 行渲染替换为 `jsx(DiffLines, { lines: diffLines, matches })`（行为保持；`data-wt-diff` 标记从 DiffLines 根输出，diff-window 的 bodyRef 移到承载 DiffLines 的滚动容器上——**滚动定位逻辑保留在 diff-window**：`bodyRef` 挂在滚动 div，DiffLines 是其子）。`matches` 计算不变。

- [ ] **Step 2: 写 commit-detail-window.js**

```js
// src/components/commit-detail-window.js —— 提交详情浮窗：文件列表 + 点击查看单文件 diff
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { parseDiff } from "../lib/git-changes.js";
import { DraggableWindow } from "./draggable-window.js";
import { DiffLines } from "./diff-lines.js";

const STATUS_COLOR = { A: "#7ec699", M: "#e6b450", D: "#e06c75", R: "#61afef", C: "#61afef" };

export function CommitDetailWindow({ target, cwd, sessionId, rpc, onClose }) {
  const [files, setFiles] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null); // path
  const [diffLines, setDiffLines] = useState(null);
  const [diffError, setDiffError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    callRpc(rpc, "git.show", { cwd, sessionId, target })
      .then((value) => {
        if (cancelled) return;
        setFiles(value.files);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(String(err?.message ?? err));
      });
    return () => { cancelled = true; };
  }, [cwd, rpc, sessionId, target]);

  const openFile = useCallback(
    (f) => {
      setSel(f.path);
      setDiffLines(null);
      setDiffError(null);
      callRpc(rpc, "git.showFile", { cwd, sessionId, target, file: f.path })
        .then((value) => setDiffLines(parseDiff(value.diff)))
        .catch((err) => setDiffError(String(err?.message ?? err)));
    },
    [cwd, rpc, sessionId, target],
  );

  let body;
  if (status === "loading") {
    body = jsx("div", { "data-wt-commit-detail-loading": true, style: { padding: 16, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (status === "error") {
    body = jsx("div", { "data-wt-commit-detail-error": true, style: { padding: 16, color: "#e06c75" }, children: error });
  } else {
    body = jsx("div", {
      style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
      children: [
        // 文件列表（上半，可滚动）
        jsx("div", {
          "data-wt-commit-files": true,
          style: { flex: sel ? "0 0 35%" : 1, overflow: "auto", borderBottom: sel ? "1px solid var(--dsw-alias-border-l2, #333)" : "none" },
          children: files.map((f) =>
            jsx("div", {
              key: f.path,
              role: "button",
              "data-wt-commit-file": true,
              "data-selected": sel === f.path || undefined,
              onClick: () => openFile(f),
              style: {
                padding: "4px 10px",
                cursor: "pointer",
                display: "flex",
                gap: 6,
                alignItems: "center",
                background: sel === f.path ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
              },
              children: [
                jsx("span", {
                  style: {
                    width: 20, textAlign: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0,
                    color: STATUS_COLOR[f.status] ?? "#ccc", border: `1px solid ${STATUS_COLOR[f.status] ?? "#ccc"}`, borderRadius: 3,
                  },
                  children: f.status,
                }),
                jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: f.path }),
              ],
            }),
          ),
        }),
        // diff 视图（下半）
        sel &&
          (diffError
            ? jsx("div", { "data-wt-commit-diff-error": true, style: { padding: 12, color: "#e06c75" }, children: diffError })
            : !diffLines
              ? jsx("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载 diff…" })
              : jsx("div", { style: { flex: 1, overflow: "auto", minHeight: 0 }, children: jsx(DiffLines, { lines: diffLines }) })),
      ],
    });
  }

  return jsx(DraggableWindow, {
    title: `${target} 的变更`,
    badge: `${files ? files.length : "…"} 个文件`,
    width: 720,
    onClose,
    children: body,
  });
}
```

- [ ] **Step 3: changes.js 历史行接线**

- 新增状态：`const [detail, setDetail] = useState(null); // {hash, shortHash}`
- 历史行 onClick 追加（在现有 `setSelCommit` 旁）：`setDetail({ hash: c.hash, shortHash: c.shortHash });`
- 渲染尾部追加：

```js
      detail &&
        jsx(CommitDetailWindow, {
          target: detail.hash,
          cwd,
          sessionId,
          rpc,
          onClose: () => setDetail(null),
        }),
```

- import：`import { CommitDetailWindow } from "./commit-detail-window.js";`
- cwd 切换 effect 与 `load()` 里追加 `setDetail(null);`

- [ ] **Step 4: 语法 + 构建 + 全量测试**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check src/components/diff-lines.js && node --check src/components/commit-detail-window.js && node --check src/components/diff-window.js && node --check src/components/changes.js && node build.mjs && node --test`
Expected: check 通过；构建成功；79 全绿。

- [ ] **Step 5: 静态验证**

Run: `grep -c "data-wt-commit-file" client.js && grep -c "data-wt-commit-detail" client.js && grep -c "data-wt-diff-line" client.js && head -3 client.js`
Expected: 均 ≥1；首行 `window.__ModuleLoader__.load({`。

- [ ] **Step 6: Commit**

```bash
git add src/components/diff-lines.js src/components/diff-window.js src/components/commit-detail-window.js src/components/changes.js client.js
git commit -m "feat: commit detail window (files list + per-file diff via shared DiffLines)"
```

---

## 里程碑验收清单（M3d）

- [ ] `node --test` 全绿（79 用例）。
- [ ] host 端点 git.show/git.showFile 单测（5，含 target/file 校验）。
- [ ] client.js 重建提交；静态验证标记齐全。
- [ ] **host 改动需重启 harness**；重启后 curl 探测 `git.show`。
- [ ] GUI 手动验收：
  - [ ] 点击历史行 → 提交详情浮窗：文件列表（状态徽章）。
  - [ ] 点击文件 → 窗口内显示该文件 diff（行号 + 红删绿加 + hunk）。
  - [ ] 浮窗可拖拽、✕/Esc 关闭；切换提交/文件正确重置。
- [ ] 推送至 GitHub 私有仓库 main。

## 后续（非 M3d 范围）

- 提交级统计（增删行数）、两个提交间 diff、提交搜索；detail 窗内 diff 搜索（当前无，DiffLines 支持 matches 但未接）。
- **运维提醒**：show/showFile 只读；host 改动需重启 harness。
