# M3b 文件预览实现计划（dsh-workspace-tools）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在文件页签点击文本/图片文件弹出可拖拽预览浮窗：文本（txt/js/md/json/java 等常用后缀）等宽渲染 + 字符串搜索，图片 base64 data URL 渲染。

**Architecture:** host 新增两个只读 RPC 端点 `fs.readText` / `fs.readImage`（复用 M2 的 fail-closed `guardCwd` + `assertInside` 包含校验；复用 `ctx.fs` 现成读接口——`readText` 自带二进制/UTF-8 拒绝、`readBytes(target, signal, maxBytes)` 带大小上限；`stat` 先行限流）；后缀白名单纯函数 `previewKind` 下沉 `lib/services/file-preview.js`（node:test 直测）。client 新建 `preview-window.js`（复用 diff 浮窗的可拖拽标题栏模式；文本行渲染带搜索高亮/计数/跳转，图片自适应缩放），`file-tree.js` 点击文件时按 `previewKind` 分流：文本/图片 → 打开预览浮窗，其余保持"仅选中"。

**Tech Stack:** Node.js ≥ 22（ESM）、`node:test`、esbuild、React 18 + `react/jsx-runtime`（external）、`ctx.fs`（dsh-fs-local 0.1.0-rc.6）。

**设计决策（本计划定稿）：**
- **大小限制**：文本 256KB、图片 5MB（`stat.size` 先行拒绝，避免大文件全量读）；常量导出可调。
- **二进制安全**：文本用 `ctx.fs.readText`（内部 NUL 样本检测 → `FS_NOT_TEXT` 拒绝），不自行探测。
- **路径安全**：`fs.readText`/`fs.readImage` 的 `payload.file` 为相对 cwd 路径，先 `guardCwd`（fail-closed sessionId）再 `assertInside`（越界 → bad-request）。
- **图片传输**：`readBytes` → Buffer → `base64`，client 拼 `data:image/<ext>;base64,...`。
- **预览分流纯函数**：`previewKind(name) → "text" | "image" | null`（扩展名白名单，小写匹配）；非白名单点击仍保持 M2"仅选中"行为（spec §5.2 不变）。
- **client 预览浮窗**：`position:fixed` + 标题栏拖拽（同 diff-window 模式）；文本渲染逐行（等宽、pre、可搜索：匹配行高亮 + `n/m` 计数 + Enter/Shift+Enter 或 ↑/↓ 跳转 + Esc 关闭）；图片 `<img>` 等比缩放（maxWidth/maxHeight 95%）。
- spec §11 原"文件内容预览"列为非目标——用户 2026-08-15 明确要求，纳入（只读预览，不做编辑）。

## Global Constraints

- 仓库位置：`/Volumes/data/code/dsh-workspace-tools`。
- client 束契约：`client.js` 已入库，改动后必须重建提交；build.mjs 为 CJS wrapper 形态；`react`/`react/jsx-runtime`/`@deepseek-ai/*` external；src 内不 import @deepseek-ai/*。
- RPC 契约（M2 定稿）：handler `(endpoint, payload)`；`{ok:true,value}` / `{ok:false,error}` 信封；`sessionId` 必带（fail-closed：缺失 → bad-request / 未知 → session-not-found / cwd 不匹配 → session-conflict）；错误 code 仅限预置枚举（`failFrom` 映射）。
- 路径包含：`assertInside(cwd, relPath)` 复用（M2 终审已落地）；`ctx.fs.resolve` 返回 FsTarget 对象，`opts.cwd` 必须传 `ctx.fs.processPath(...)` 字符串（M3 已修 bug）。
- 测试基线：51 全绿（M3b Task 1 新增 file-preview 单测后 55）。
- **host 改动需重启 harness 生效**（M3b 有 lib/index.js 改动；重启会重建 profile 注册——插件 symlink/patch 丢失时重跑 `node scripts/install.mjs`）；client.js 刷新即生效。
- 环境事实：node 不在 PATH（`export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH` 前缀）。

---

### Task 1: host 预览端点（纯函数 + RPC）

**Files:**
- Create: `lib/services/file-preview.js`
- Create: `test/file-preview.test.js`
- Modify: `lib/index.js`（新增 `fs.readText` / `fs.readImage` 两个 case）

**Interfaces:**
- Produces:
  - `previewKind(name) → "text" | "image" | null`（白名单：文本 txt/js/ts/jsx/tsx/md/json/java/py/c/h/cpp/go/rs/yml/yaml/xml/html/css/sh/sql/toml/ini/log/csv/svg？——svg 归图片；图片 png/jpg/jpeg/gif/webp/svg/bmp/ico）
  - `TEXT_MAX_BYTES = 256 * 1024`、`IMAGE_MAX_BYTES = 5 * 1024 * 1024`
  - RPC `fs.readText` payload `{cwd, sessionId, file}` → `{text}`（`previewKind(file) === "text"` 且 `stat.size ≤ TEXT_MAX_BYTES` 才读；否则 bad-request）
  - RPC `fs.readImage` payload 同上 → `{base64}`（`previewKind === "image"` 且 `≤ IMAGE_MAX_BYTES`）
- Consumes: `guardCwd`/`assertInside`/`ctx.fs.resolve`/`processPath`/`stat`/`readText`/`readBytes`。

- [ ] **Step 1: 写失败测试**

```js
// test/file-preview.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { previewKind, TEXT_MAX_BYTES, IMAGE_MAX_BYTES } from "../lib/services/file-preview.js";

test("previewKind: 常见文本后缀", () => {
  for (const n of ["a.txt", "index.js", "app.ts", "page.jsx", "c.tsx", "README.md", "pkg.json", "Main.java", "main.py", "a.c", "a.h", "a.cpp", "a.go", "a.rs", "ci.yml", "a.yaml", "a.xml", "index.html", "style.css", "run.sh", "a.sql", "a.toml", "a.ini", "a.log", "a.csv", "A.TXT"]) {
    assert.equal(previewKind(n), "text", n);
  }
});

test("previewKind: 常见图片后缀", () => {
  for (const n of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.svg", "a.bmp", "a.ico", "A.PNG"]) {
    assert.equal(previewKind(n), "image", n);
  }
});

test("previewKind: 无后缀/未知后缀/目录 → null", () => {
  assert.equal(previewKind("README"), null);
  assert.equal(previewKind("a.xyz"), null);
  assert.equal(previewKind("noext."), null);
  assert.equal(previewKind(""), null);
  assert.equal(previewKind("dir/sub"), null);
});

test("常量: 大小上限合理", () => {
  assert.equal(TEXT_MAX_BYTES, 256 * 1024);
  assert.equal(IMAGE_MAX_BYTES, 5 * 1024 * 1024);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/file-preview.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```js
// lib/services/file-preview.js —— 预览类型判断 + 大小上限（纯函数，无 Node 依赖）
export const TEXT_MAX_BYTES = 256 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "js", "ts", "jsx", "tsx", "md", "json", "java", "py", "c", "h", "cpp", "cc", "go", "rs",
  "yml", "yaml", "xml", "html", "htm", "css", "scss", "sh", "bash", "zsh", "sql", "toml", "ini",
  "cfg", "conf", "log", "csv", "env", "gitignore", "editorconfig", "dockerfile",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);

export function previewKind(name) {
  if (typeof name !== "string") return null;
  const idx = name.lastIndexOf(".");
  if (idx === -1 || idx === name.length - 1) return null;
  const ext = name.slice(idx + 1).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --test test/file-preview.test.js`
Expected: 4 个用例 PASS。

- [ ] **Step 5: 在 lib/index.js 的 RPC switch 里追加两个 case**（放在 `fs.resolvePath` 之后）：

```js
            case "fs.readText": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              try {
                assertInside(payload.cwd, payload.file ?? "");
              } catch {
                return fail("bad-request", "路径越出工作区", { issues: [] });
              }
              if (previewKind(payload.file) !== "text") {
                return fail("bad-request", "不支持预览该文件类型", { issues: [] });
              }
              const rootT = await ctx.fs.resolve(payload.cwd);
              const targetT = await ctx.fs.resolve(payload.file, { cwd: ctx.fs.processPath(rootT) });
              const stT = await ctx.fs.stat(targetT);
              if (stT && stT.size > TEXT_MAX_BYTES) {
                return fail("bad-request", "文件过大", { issues: [] });
              }
              try {
                const text = await ctx.fs.readText(targetT);
                return ok({ text });
              } catch (err) {
                return failFrom(translateFsError(err));
              }
            }
            case "fs.readImage": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              try {
                assertInside(payload.cwd, payload.file ?? "");
              } catch {
                return fail("bad-request", "路径越出工作区", { issues: [] });
              }
              if (previewKind(payload.file) !== "image") {
                return fail("bad-request", "不支持预览该文件类型", { issues: [] });
              }
              const rootI = await ctx.fs.resolve(payload.cwd);
              const targetI = await ctx.fs.resolve(payload.file, { cwd: ctx.fs.processPath(rootI) });
              const stI = await ctx.fs.stat(targetI);
              if (stI && stI.size > IMAGE_MAX_BYTES) {
                return fail("bad-request", "图片过大", { issues: [] });
              }
              try {
                const buf = await ctx.fs.readBytes(targetI, undefined, IMAGE_MAX_BYTES);
                return ok({ base64: buf.toString("base64") });
              } catch (err) {
                return failFrom(translateFsError(err));
              }
            }
```

并更新 import：`import { previewKind, TEXT_MAX_BYTES, IMAGE_MAX_BYTES } from "./services/file-preview.js";`

- [ ] **Step 6: 语法 + 全量测试**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check lib/index.js && node --test`
Expected: check 通过；55 全绿（51 + file-preview 4）。

- [ ] **Step 7: Commit**

```bash
git add lib/services/file-preview.js test/file-preview.test.js lib/index.js
git commit -m "feat: fs.readText/fs.readImage RPC endpoints (preview kind whitelist + size caps)"
```

---

### Task 2: client 预览浮窗 + 文件树接线

**Files:**
- Create: `src/components/preview-window.js`
- Modify: `src/components/file-tree.js`（点击文件分流 + 渲染浮窗）

**Interfaces:**
- Consumes: `previewKind`（Task 1 纯函数——client bundle 会打包 lib/services/file-preview.js？**不行**：client bundle 只打包 src/ 下的本地文件；`previewKind` 在 lib/ 下。方案：`src/lib/preview.js` 重新导出 `previewKind` 常量与函数（从 `../../lib/services/file-preview.js` re-export，esbuild 会打包该 lib 文件——已验证 M2 的 `RPC_CHANNEL` 从 `../../lib/constants.js` re-export 可行，同模式）；或 client 侧独立复制一份（不 DRY）。**用 re-export**。
- Produces: `PreviewWindow`（可拖拽浮窗：文本行渲染 + 搜索；图片 data URL 渲染）；`file-tree.js` 点击文件 `previewKind(row.name)` 分流。

- [ ] **Step 1: 建 `src/lib/preview.js`（re-export + data URL 辅助）**

```js
// src/lib/preview.js —— client 侧预览辅助（re-export host 纯函数，esbuild 打包进 client bundle）
export { previewKind, TEXT_MAX_BYTES, IMAGE_MAX_BYTES } from "../../lib/services/file-preview.js";

export function dataUrlFrom(kind, base64) {
  // kind 为 "image"，扩展名从 previewKind 已判定的后缀取——这里直接由调用方传 mime 前缀
  return `data:${kind};base64,${base64}`;
}
```

> 说明：`dataUrlFrom` 由调用方传完整 mime（如 `image/png`），避免重复解析后缀；纯函数可单测（Task 2 不加单测，验证在构建 + GUI）。

- [ ] **Step 2: 写 `src/components/preview-window.js`**（可拖拽 + 文本搜索 + 图片渲染）

```js
// src/components/preview-window.js —— 文件预览浮窗（文本：等宽+搜索；图片：data URL）
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { previewKind } from "../lib/preview.js";

const WINDOW_W = 640;

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };

export function PreviewWindow({ file, cwd, sessionId, rpc, onClose }) {
  const kind = previewKind(file);
  const [pos, setPos] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    return { x: Math.max(8, vw - WINDOW_W - 24), y: 64 };
  });
  const [state, setState] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [textLines, setTextLines] = useState(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const bodyRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setQuery("");
    setMatchIdx(0);
    setTextLines(null);
    setImgUrl(null);
    if (kind === "text") {
      callRpc(rpc, "fs.readText", { cwd, sessionId, file })
        .then((value) => {
          if (cancelled) return;
          setTextLines(value.text.split("\n"));
          setState("ready");
        })
        .catch((err) => {
          if (cancelled) return;
          setState("error");
          setError(String(err?.message ?? err));
        });
    } else if (kind === "image") {
      callRpc(rpc, "fs.readImage", { cwd, sessionId, file })
        .then((value) => {
          if (cancelled) return;
          const ext = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
          setImgUrl(`data:${MIME[ext] ?? "image/png"};base64,${value.base64}`);
          setState("ready");
        })
        .catch((err) => {
          if (cancelled) return;
          setState("error");
          setError(String(err?.message ?? err));
        });
    } else {
      setState("error");
      setError("不支持预览该文件类型");
    }
    return () => { cancelled = true; };
  }, [file, cwd, rpc, sessionId, kind]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !textLines) return [];
    const out = [];
    textLines.forEach((t, i) => { if (t.toLowerCase().includes(q)) out.push(i); });
    return out;
  }, [query, textLines]);

  useEffect(() => {
    if (!bodyRef.current || matches.length === 0) return;
    const idx = matches[Math.min(matchIdx, matches.length - 1)];
    bodyRef.current.querySelector(`[data-line="${idx}"]`)?.scrollIntoView({ block: "center" });
  }, [matchIdx, matches]);

  const onTitleDown = useCallback(
    (e) => {
      if (e.target.closest("input,button")) return;
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      const move = (ev) => setPos({ x: Math.max(0, ev.clientX - dragRef.current.dx), y: Math.max(0, ev.clientY - dragRef.current.dy) });
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [pos],
  );

  const nextMatch = useCallback(() => { if (matches.length) setMatchIdx((i) => (i + 1) % matches.length); }, [matches.length]);
  const prevMatch = useCallback(() => { if (matches.length) setMatchIdx((i) => (i - 1 + matches.length) % matches.length); }, [matches.length]);

  let body;
  if (state === "error") {
    body = jsx("div", { "data-wt-preview-error": true, style: { padding: 16, color: "#e06c75" }, children: error });
  } else if (state === "loading") {
    body = jsx("div", { "data-wt-preview-loading": true, style: { padding: 16, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (kind === "image") {
    body = jsx("div", { style: { flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }, children: jsx("img", { "data-wt-preview-image": true, src: imgUrl, alt: file, style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 } }) });
  } else {
    body = jsx("div", {
      ref: bodyRef,
      "data-wt-preview-text": true,
      style: { flex: 1, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", padding: "4px 10px 12px", whiteSpace: "pre" },
      children: textLines.map((t, i) => {
        const isMatch = matches.includes(i);
        return jsx("div", {
          key: i,
          "data-line": i,
          "data-wt-preview-line": true,
          "data-wt-match": isMatch || undefined,
          style: { background: isMatch ? "rgba(230,180,80,0.28)" : "none", color: isMatch ? "#f0d59a" : undefined },
          children: t || " ",
        });
      }),
    });
  }

  const hasQuery = query.trim() !== "";

  return jsx("div", {
    "data-wt-preview-window": true,
    style: {
      position: "fixed",
      left: pos.x,
      top: pos.y,
      width: WINDOW_W,
      maxWidth: "94vw",
      height: "70vh",
      minHeight: 240,
      display: "flex",
      flexDirection: "column",
      background: "var(--dsw-alias-bg-base, #1a1a1a)",
      border: "1px solid var(--dsw-alias-border-l2, #333)",
      borderRadius: 8,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: 100,
      fontSize: 12,
      overflow: "hidden",
    },
    children: [
      jsx("div", {
        "data-wt-preview-title": true,
        onMouseDown: onTitleDown,
        style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "move", background: "var(--dsw-alias-bg-float, #1f1f1f)", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)", flexShrink: 0, userSelect: "none" },
        children: [
          jsx("span", { style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, children: file }),
          jsx("span", { style: { fontSize: 10, padding: "1px 5px", border: "1px solid #888", borderRadius: 3, color: "#aaa", flexShrink: 0 }, children: kind ?? "" }),
          kind === "text" && hasQuery && jsx("span", { "data-wt-preview-count": true, style: { color: "#e6b450", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }, children: matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : "0/0" }),
          jsx("button", {
            type: "button",
            "data-wt-preview-close": true,
            onClick: onClose,
            title: "关闭（Esc）",
            style: { marginLeft: "auto", background: "none", border: "none", color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 },
            children: "✕",
          }),
        ],
      }),
      kind === "text" &&
        jsx("div", { style: { display: "flex", gap: 6, padding: "5px 10px", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)", flexShrink: 0, alignItems: "center" }, children: [
          jsx("input", {
            "data-wt-preview-search": true,
            type: "text",
            placeholder: "搜索…",
            value: query,
            onChange: (e) => { setQuery(e.target.value); setMatchIdx(0); },
            onKeyDown: (e) => {
              if (e.key === "Enter") e.shiftKey ? prevMatch() : nextMatch();
              if (e.key === "Escape") onClose();
            },
            style: { flex: 1, background: "var(--dsw-alias-bg-base, #141414)", border: "1px solid var(--dsw-alias-border-l2, #333)", borderRadius: 4, color: "var(--dsw-alias-text-primary, #ddd)", padding: "3px 8px", fontSize: 12, outline: "none" },
          }),
          hasQuery && jsx("button", { type: "button", "data-wt-preview-prev": true, onClick: prevMatch, style: { background: "none", border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 4, color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", padding: "1px 7px", fontSize: 11 }, children: "↑" }),
          hasQuery && jsx("button", { type: "button", "data-wt-preview-next": true, onClick: nextMatch, style: { background: "none", border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 4, color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", padding: "1px 7px", fontSize: 11 }, children: "↓" }),
        ] }),
      body,
    ],
  });
}
```

- [ ] **Step 3: 修改 `src/components/file-tree.js`**（点击分流 + 渲染浮窗）

在 `FileTree` 组件内新增状态：`const [preview, setPreview] = useState(null); // {rel, name}`。

行点击处理（当前 `onClick: () => { setSelected(row.rel); if (row.isDir) toggle(row.rel); }`）改为：

```js
          onClick: () => {
            setSelected(row.rel);
            if (row.isDir) {
              toggle(row.rel);
            } else {
              const kind = previewKind(row.name);
              if (kind) setPreview({ rel: row.rel, name: row.name });
            }
          },
```

`openMenu` 的右键不受影响。在 return 的根 div children 末尾追加（context menu 之后）：

```js
      preview &&
        jsx(PreviewWindow, {
          file: preview.name,
          cwd,
          sessionId,
          rpc,
          onClose: () => setPreview(null),
        }),
```

并更新 import（file-tree.js 顶部）：`import { PreviewWindow } from "./preview-window.js";` 与 `import { previewKind } from "../lib/preview.js";`。

注意：`preview.rel` 是树内的全路径（相对 cwd），`preview.name` 是文件名——**传给 PreviewWindow 的 file 必须是相对 cwd 的路径**。树内行 rel 即相对 cwd 的路径（`joinRel` 语义，根为 cwd）——所以**传 `preview.rel` 而非 `preview.name`**。修正：`file: preview.rel`。state 里保留 name 仅作展示可选；直接只用 rel。实现时以 `{ rel }` 为准，`PreviewWindow file={preview.rel}`。

- [ ] **Step 4: 语法 + 构建 + 全量测试**

Run: `export PATH=/Users/onyh/.nvm/versions/node/v22.22.1/bin:$PATH && node --check src/components/preview-window.js && node --check src/lib/preview.js && node build.mjs && node --test`
Expected: check 通过；构建成功；55 全绿。

- [ ] **Step 5: 静态验证 bundle**

Run: `grep -c "data-wt-preview-window" client.js && grep -c "data-wt-preview-search" client.js && grep -c "fs.readText" client.js && head -3 client.js`
Expected: 均 ≥1；首行 `window.__ModuleLoader__.load({`。

- [ ] **Step 6: Commit**

```bash
git add src/components/preview-window.js src/lib/preview.js src/components/file-tree.js client.js
git commit -m "feat: file preview window (text w/ search, image) on tree click"
```

---

## 里程碑验收清单（M3b 文件预览）

- [ ] `node --test` 全绿（55 用例：51 + file-preview 4）。
- [ ] **host 端需重启 harness 生效**（lib/index.js 新增端点）；重启后确认 `fs.readText`/`fs.readImage` RPC（curl 探测）。
- [ ] client.js 重建提交；harness curl 含 `data-wt-preview-window`。
- [ ] GUI 手动验收：
  - [ ] 文件页签点击 `.md`/`.js`/`.json` 等文本 → 浮窗等宽预览 + 搜索高亮/跳转。
  - [ ] 点击 `.png`/`.svg` 图片 → 浮窗显示图片。
  - [ ] 浮窗标题栏可拖拽；Esc/✕ 关闭；换文件切换内容。
  - [ ] 点击非白名单文件（如 `.zip`）仍保持"仅选中"。
- [ ] 推送至 GitHub 私有仓库 main。

## 后续（非 M3b 范围）

- 预览编辑（spec 明确不做）；视频/PDF 预览；树内嵌预览（当前浮窗方案）。
- **运维提醒**：host 改动（lib/index.js）重启会重建 profile 注册——若插件 404/unknown-op，重跑 `node scripts/install.mjs` 再重启。
