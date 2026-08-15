window.__ModuleLoader__.load({
  id: "dsh-workspace-tools",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  default: () => index_default,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/components/workspace-browser.js
var import_jsx_runtime7 = require("react/jsx-runtime");
var import_react6 = require("react");

// src/components/session-list.js
var import_jsx_runtime = require("react/jsx-runtime");
function SessionList({ useSessions, openSession }) {
  const { ids, byId, current } = useSessions((s) => s);
  return (0, import_jsx_runtime.jsx)("div", {
    "data-wt-sessions": true,
    children: ids.map((id) => {
      const s = byId[id];
      const active = id === current;
      return (0, import_jsx_runtime.jsx)("div", {
        key: id,
        role: "button",
        tabIndex: 0,
        "data-current": active || void 0,
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
          background: active ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none"
        },
        children: s?.displayTitle ?? id
      });
    })
  });
}

// src/components/file-tree.js
var import_jsx_runtime4 = require("react/jsx-runtime");
var import_react3 = require("react");

// lib/constants.js
var RPC_CHANNEL = "/workspace-tools";

// src/lib/rpc.js
function unwrapResult(result) {
  if (result && result.ok === true) return result.value;
  const message = result?.error?.message ?? "RPC \u8C03\u7528\u5931\u8D25";
  const err = new Error(message);
  err.code = result?.error?.code;
  throw err;
}
function callRpc(rpc, endpoint, payload) {
  return rpc.call(RPC_CHANNEL, endpoint, payload).then(unwrapResult);
}

// src/lib/fs-tree.js
function parseEntries(raw) {
  return (raw ?? []).map((e) => ({
    name: e.name,
    isDir: !!e.isDir,
    absolute: e.absolute ?? ""
  }));
}
function joinRel(base, name2) {
  return base === "" ? name2 : `${base}/${name2}`;
}
function toggleExpanded(expanded, rel) {
  const next = new Set(expanded);
  if (next.has(rel)) next.delete(rel);
  else next.add(rel);
  return next;
}
function visibleRows(nodes, expanded) {
  const rows = [];
  const walk = (rel, depth) => {
    const node = nodes.get(rel);
    if (!node || node.status !== "ready") return;
    for (const e of node.entries ?? []) {
      const key = joinRel(rel, e.name);
      rows.push({ rel: key, name: e.name, isDir: e.isDir, absolute: e.absolute, depth });
      if (e.isDir && expanded.has(key)) walk(key, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}
var GLYPHS = {
  js: "\u{1F7E8}",
  ts: "\u{1F7E6}",
  json: "\u{1F4CB}",
  md: "\u{1F4DD}",
  yml: "\u2699\uFE0F",
  yaml: "\u2699\uFE0F",
  py: "\u{1F40D}",
  html: "\u{1F310}",
  css: "\u{1F3A8}",
  sh: "\u{1F4BB}"
};
function fileGlyph(name2, isDir) {
  if (isDir) return "\u{1F4C1}";
  const ext = name2.includes(".") ? name2.split(".").pop().toLowerCase() : "";
  return GLYPHS[ext] ?? "\u{1F4C4}";
}

// src/lib/tree-filter.js
function filterRows(rows, q) {
  const query = (q ?? "").trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((r) => (r.name ?? "").toLowerCase().includes(query) || (r.path ?? "").toLowerCase().includes(query));
}

// src/components/preview-window.js
var import_jsx_runtime3 = require("react/jsx-runtime");
var import_react2 = require("react");

// lib/services/file-preview.js
var TEXT_MAX_BYTES = 256 * 1024;
var IMAGE_MAX_BYTES = 5 * 1024 * 1024;
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  "txt",
  "js",
  "ts",
  "jsx",
  "tsx",
  "md",
  "json",
  "java",
  "py",
  "c",
  "h",
  "cpp",
  "cc",
  "go",
  "rs",
  "yml",
  "yaml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sh",
  "bash",
  "zsh",
  "sql",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "csv",
  "env",
  "gitignore",
  "editorconfig",
  "dockerfile"
]);
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
function previewKind(name2) {
  if (typeof name2 !== "string") return null;
  const idx = name2.lastIndexOf(".");
  if (idx === -1 || idx === name2.length - 1) return null;
  const ext = name2.slice(idx + 1).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

// src/lib/tokenize.js
var KEYWORDS = {
  js: /* @__PURE__ */ new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "from", "new", "this", "async", "await", "try", "catch", "throw", "switch", "case", "break", "continue", "typeof", "instanceof", "extends", "super", "static", "get", "set", "null", "undefined", "true", "false"]),
  java: /* @__PURE__ */ new Set(["public", "private", "protected", "class", "interface", "extends", "implements", "return", "if", "else", "for", "while", "new", "this", "static", "final", "void", "int", "long", "double", "boolean", "String", "try", "catch", "throw", "import", "package", "null", "true", "false"]),
  py: /* @__PURE__ */ new Set(["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with", "try", "except", "finally", "lambda", "pass", "break", "continue", "None", "True", "False", "self", "global", "nonlocal", "yield", "raise", "in", "is", "not", "and", "or"])
};
function tokenize(text, ext) {
  const lang = ext === "py" ? "py" : ext === "java" ? "java" : ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx" ? "js" : null;
  const kws = lang ? KEYWORDS[lang] : null;
  const out = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|#[^\n]*|<!--[\s\S]*?-->|\b\d+(?:\.\d+)?\b|[A-Za-z_$][A-Za-z0-9_$]*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), cls: null });
    const tok = m[0];
    let cls = null;
    if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) cls = "str";
    else if (tok.startsWith("//") || tok.startsWith("#") || tok.startsWith("<!--")) cls = "com";
    else if (/^\d/.test(tok)) cls = "num";
    else if (kws && kws.has(tok)) cls = "kw";
    out.push({ text: tok, cls });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: null });
  return out;
}

// src/components/draggable-window.js
var import_jsx_runtime2 = require("react/jsx-runtime");
var import_react = require("react");
var BTN = {
  background: "none",
  border: "1px solid var(--dsw-alias-border-l2, #444)",
  borderRadius: 4,
  color: "var(--dsw-alias-text-secondary, #999)",
  cursor: "pointer",
  padding: "1px 7px",
  fontSize: 11,
  flexShrink: 0
};
var WT = {
  window: {
    root: "data-wt-window",
    title: "data-wt-window-title",
    count: "data-wt-window-count",
    close: "data-wt-window-close",
    search: "data-wt-window-search",
    prev: "data-wt-window-prev",
    next: "data-wt-window-next"
  },
  diff: {
    root: "data-wt-diff-window",
    title: "data-wt-diff-title",
    count: "data-wt-diff-count",
    close: "data-wt-diff-close",
    search: "data-wt-diff-search",
    prev: "data-wt-diff-prev",
    next: "data-wt-diff-next"
  },
  preview: {
    root: "data-wt-preview-window",
    title: "data-wt-preview-title",
    count: "data-wt-preview-count",
    close: "data-wt-preview-close",
    search: "data-wt-preview-search",
    prev: "data-wt-preview-prev",
    next: "data-wt-preview-next"
  }
};
function DraggableWindow({ title, badge, width = 640, onClose, search, wtPrefix = "window", children }) {
  const wt = WT[wtPrefix] ?? WT.window;
  const [pos, setPos] = (0, import_react.useState)(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    return { x: Math.max(8, vw - width - 24), y: 64 };
  });
  const dragRef = (0, import_react.useRef)(null);
  const onTitleDown = (0, import_react.useCallback)(
    (e) => {
      if (e.target.closest("input,button")) return;
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      const move = (ev) => {
        setPos({ x: Math.max(0, ev.clientX - dragRef.current.dx), y: Math.max(0, ev.clientY - dragRef.current.dy) });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [pos]
  );
  const hasQuery = search != null && search.value.trim() !== "";
  const rootAttrs = { "data-wt-window": true };
  if (wtPrefix !== "window") rootAttrs[wt.root] = true;
  return (0, import_jsx_runtime2.jsx)("div", {
    ...rootAttrs,
    style: {
      position: "fixed",
      left: pos.x,
      top: pos.y,
      width,
      maxWidth: "94vw",
      height: "68vh",
      minHeight: 240,
      display: "flex",
      flexDirection: "column",
      background: "var(--dsw-alias-bg-base, #1a1a1a)",
      border: "1px solid var(--dsw-alias-border-l2, #333)",
      borderRadius: 8,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: 100,
      fontSize: 12,
      overflow: "hidden"
    },
    children: [
      // 标题栏（拖拽把手）
      (0, import_jsx_runtime2.jsx)("div", {
        [wt.title]: true,
        onMouseDown: onTitleDown,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          cursor: "move",
          background: "var(--dsw-alias-bg-float, #1f1f1f)",
          borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
          flexShrink: 0,
          userSelect: "none"
        },
        children: [
          (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, children: title }),
          badge && (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 10, padding: "1px 5px", border: "1px solid #888", borderRadius: 3, color: "#aaa", flexShrink: 0 }, children: badge }),
          hasQuery && (0, import_jsx_runtime2.jsx)("span", { [wt.count]: true, style: { color: "#e6b450", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }, children: search.count }),
          (0, import_jsx_runtime2.jsx)("button", {
            type: "button",
            [wt.close]: true,
            onClick: onClose,
            title: "\u5173\u95ED\uFF08Esc\uFF09",
            style: { marginLeft: "auto", background: "none", border: "none", color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 },
            children: "\u2715"
          })
        ]
      }),
      // 受控搜索条（输入 + n/m + ↑/↓）
      search && (0, import_jsx_runtime2.jsx)("div", {
        style: { display: "flex", gap: 6, padding: "5px 10px", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)", flexShrink: 0, alignItems: "center" },
        children: [
          (0, import_jsx_runtime2.jsx)("input", {
            [wt.search]: true,
            type: "text",
            placeholder: "\u641C\u7D22\u2026",
            value: search.value,
            onChange: (e) => search.onChange(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") search.onEnter(e);
              if (e.key === "Escape") onClose();
            },
            style: { flex: 1, background: "var(--dsw-alias-bg-base, #141414)", border: "1px solid var(--dsw-alias-border-l2, #333)", borderRadius: 4, color: "var(--dsw-alias-text-primary, #ddd)", padding: "3px 8px", fontSize: 12, outline: "none" }
          }),
          hasQuery && (0, import_jsx_runtime2.jsx)("button", { type: "button", [wt.prev]: true, onClick: search.onPrev, style: BTN, children: "\u2191" }),
          hasQuery && (0, import_jsx_runtime2.jsx)("button", { type: "button", [wt.next]: true, onClick: search.onNext, style: BTN, children: "\u2193" })
        ]
      }),
      children
    ]
  });
}

// src/components/preview-window.js
var WINDOW_W = 640;
var TOKEN_COLORS = { str: "#7ec699", com: "#6a737d", kw: "#61afef", num: "#e6b450" };
var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
function PreviewWindow({ file, cwd, sessionId, rpc, onClose }) {
  const kind = previewKind(file);
  const ext = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
  const [state, setState] = (0, import_react2.useState)("loading");
  const [error, setError] = (0, import_react2.useState)(null);
  const [textLines, setTextLines] = (0, import_react2.useState)(null);
  const [imgUrl, setImgUrl] = (0, import_react2.useState)(null);
  const [query, setQuery] = (0, import_react2.useState)("");
  const [matchIdx, setMatchIdx] = (0, import_react2.useState)(0);
  const bodyRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    let cancelled = false;
    setState("loading");
    setQuery("");
    setMatchIdx(0);
    setTextLines(null);
    setImgUrl(null);
    if (kind === "text") {
      callRpc(rpc, "fs.readText", { cwd, sessionId, file }).then((value) => {
        if (cancelled) return;
        setTextLines(value.text.split("\n"));
        setState("ready");
      }).catch((err) => {
        if (cancelled) return;
        setState("error");
        setError(String(err?.message ?? err));
      });
    } else if (kind === "image") {
      callRpc(rpc, "fs.readImage", { cwd, sessionId, file }).then((value) => {
        if (cancelled) return;
        const ext2 = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
        setImgUrl(`data:${MIME[ext2] ?? "image/png"};base64,${value.base64}`);
        setState("ready");
      }).catch((err) => {
        if (cancelled) return;
        setState("error");
        setError(String(err?.message ?? err));
      });
    } else {
      setState("error");
      setError("\u4E0D\u652F\u6301\u9884\u89C8\u8BE5\u6587\u4EF6\u7C7B\u578B");
    }
    return () => {
      cancelled = true;
    };
  }, [file, cwd, rpc, sessionId, kind]);
  const matches = (0, import_react2.useMemo)(() => {
    const q = query.trim().toLowerCase();
    if (!q || !textLines) return [];
    const out = [];
    textLines.forEach((t, i) => {
      if (t.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [query, textLines]);
  (0, import_react2.useEffect)(() => {
    if (!bodyRef.current || matches.length === 0) return;
    const idx = matches[Math.min(matchIdx, matches.length - 1)];
    bodyRef.current.querySelector(`[data-line="${idx}"]`)?.scrollIntoView({ block: "center" });
  }, [matchIdx, matches]);
  const nextMatch = (0, import_react2.useCallback)(() => {
    if (matches.length) setMatchIdx((i) => (i + 1) % matches.length);
  }, [matches.length]);
  const prevMatch = (0, import_react2.useCallback)(() => {
    if (matches.length) setMatchIdx((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);
  let body;
  if (state === "error") {
    body = (0, import_jsx_runtime3.jsx)("div", { "data-wt-preview-error": true, style: { padding: 16, color: "#e06c75" }, children: error });
  } else if (state === "loading") {
    body = (0, import_jsx_runtime3.jsx)("div", { "data-wt-preview-loading": true, style: { padding: 16, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u52A0\u8F7D\u4E2D\u2026" });
  } else if (kind === "image") {
    body = (0, import_jsx_runtime3.jsx)("div", { style: { flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }, children: (0, import_jsx_runtime3.jsx)("img", { "data-wt-preview-image": true, src: imgUrl, alt: file, style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 } }) });
  } else {
    body = (0, import_jsx_runtime3.jsx)("div", {
      ref: bodyRef,
      "data-wt-preview-text": true,
      style: { flex: 1, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", padding: "4px 10px 12px", whiteSpace: "pre" },
      children: textLines.map((t, i) => {
        const isMatch = matches.includes(i);
        return (0, import_jsx_runtime3.jsx)("div", {
          key: i,
          "data-line": i,
          "data-wt-preview-line": true,
          "data-wt-match": isMatch || void 0,
          style: { display: "flex", background: isMatch ? "rgba(230,180,80,0.28)" : "none", color: isMatch ? "#f0d59a" : void 0 },
          children: [
            (0, import_jsx_runtime3.jsx)("span", {
              "data-wt-preview-lineno": true,
              style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 8, userSelect: "none" },
              children: String(i + 1)
            }),
            (0, import_jsx_runtime3.jsx)("span", {
              children: tokenize(t || " ", ext).map(
                (tok, j) => tok.cls ? (0, import_jsx_runtime3.jsx)("span", { key: j, style: { color: TOKEN_COLORS[tok.cls] }, children: tok.text }) : tok.text
              )
            })
          ]
        });
      })
    });
  }
  const hasQuery = query.trim() !== "";
  const count = matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : "0/0";
  return (0, import_jsx_runtime3.jsx)(DraggableWindow, {
    wtPrefix: "preview",
    title: file,
    badge: kind,
    width: WINDOW_W,
    onClose,
    search: kind === "text" ? {
      value: query,
      onChange: (v) => {
        setQuery(v);
        setMatchIdx(0);
      },
      onEnter: (e) => e.shiftKey ? prevMatch() : nextMatch(),
      onPrev: prevMatch,
      onNext: nextMatch,
      count,
      active: hasQuery
    } : void 0,
    children: body
  });
}

// src/components/file-tree.js
function FileTree({ cwd, sessionId, rpc, insertIntoComposer }) {
  const [nodes, setNodes] = (0, import_react3.useState)(() => /* @__PURE__ */ new Map());
  const [expanded, setExpanded] = (0, import_react3.useState)(() => /* @__PURE__ */ new Set());
  const [selected, setSelected] = (0, import_react3.useState)(null);
  const [preview, setPreview] = (0, import_react3.useState)(null);
  const [menu, setMenu] = (0, import_react3.useState)(null);
  const [filterQ, setFilterQ] = (0, import_react3.useState)("");
  const panelRef = (0, import_react3.useRef)(null);
  const menuRef = (0, import_react3.useRef)(null);
  const nodesRef = (0, import_react3.useRef)(nodes);
  (0, import_react3.useEffect)(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    setNodes(/* @__PURE__ */ new Map());
    setExpanded(/* @__PURE__ */ new Set());
    setSelected(null);
    setMenu(null);
    if (!cwd) return void 0;
    callRpc(rpc, "fs.listDir", { cwd, relPath: "", sessionId }).then((value) => {
      if (cancelled) return;
      setNodes((prev) => {
        const next = new Map(prev);
        next.set("", { status: "ready", entries: parseEntries(value.entries) });
        return next;
      });
    }).catch((err) => {
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
  const loadDir = (0, import_react3.useCallback)(
    (rel) => {
      const current = nodesRef.current.get(rel);
      if (current && current.status !== "error") return;
      setNodes((prev) => {
        if (prev.has(rel) && prev.get(rel).status !== "error") return prev;
        const next = new Map(prev);
        next.set(rel, { status: "loading", entries: [] });
        return next;
      });
      callRpc(rpc, "fs.listDir", { cwd, relPath: rel, sessionId }).then((value) => {
        setNodes((prev) => {
          const next = new Map(prev);
          next.set(rel, { status: "ready", entries: parseEntries(value.entries) });
          return next;
        });
      }).catch((err) => {
        setNodes((prev) => {
          const next = new Map(prev);
          next.set(rel, { status: "error", error: String(err?.message ?? err) });
          return next;
        });
      });
    },
    [cwd, rpc, sessionId]
  );
  const toggle = (0, import_react3.useCallback)(
    (rel) => {
      const wasOpen = expanded.has(rel);
      setExpanded((prev) => toggleExpanded(prev, rel));
      if (!wasOpen) loadDir(rel);
    },
    [expanded, loadDir]
  );
  const rows = (0, import_react3.useMemo)(() => filterRows(visibleRows(nodes, expanded), filterQ), [nodes, expanded, filterQ]);
  const root = nodes.get("");
  (0, import_react3.useEffect)(() => {
    if (!menu) return void 0;
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
  const openMenu = (0, import_react3.useCallback)((ev, row) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    setMenu({ x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0), ...row });
  }, []);
  const closeMenu = (0, import_react3.useCallback)(() => setMenu(null), []);
  const onCopy = (0, import_react3.useCallback)(async () => {
    if (!menu) return;
    try {
      await navigator.clipboard.writeText(menu.absolute || menu.rel);
    } catch {
    }
    closeMenu();
  }, [menu, closeMenu]);
  const onInsert = (0, import_react3.useCallback)(() => {
    if (!menu || !sessionId) {
      closeMenu();
      return;
    }
    insertIntoComposer(sessionId, menu.rel);
    closeMenu();
  }, [menu, sessionId, insertIntoComposer, closeMenu]);
  let body;
  if (!cwd) {
    body = (0, import_jsx_runtime4.jsx)("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u4F5C\u76EE\u5F55" });
  } else if (!root || root.status === "loading") {
    body = (0, import_jsx_runtime4.jsx)("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u52A0\u8F7D\u4E2D\u2026" });
  } else if (root.status === "error") {
    body = (0, import_jsx_runtime4.jsx)("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: root.error });
  } else {
    body = (0, import_jsx_runtime4.jsx)("div", {
      "data-wt-tree": true,
      children: [
        rows.map((row) => {
          const isOpen = row.isDir && expanded.has(row.rel);
          return (0, import_jsx_runtime4.jsx)("div", {
            key: row.rel,
            role: "button",
            tabIndex: 0,
            "data-wt-row": true,
            "data-dir": row.isDir || void 0,
            "data-selected": selected === row.rel || void 0,
            onClick: () => {
              setSelected(row.rel);
              if (row.isDir) {
                toggle(row.rel);
              } else {
                const kind = previewKind(row.name);
                if (kind) setPreview({ rel: row.rel, name: row.name });
              }
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
              background: selected === row.rel ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none"
            },
            children: [
              (0, import_jsx_runtime4.jsx)("span", { style: { width: 14, flexShrink: 0, display: "inline-block", textAlign: "center" }, children: row.isDir ? isOpen ? "\u25BE" : "\u25B8" : "" }),
              (0, import_jsx_runtime4.jsx)("span", { children: fileGlyph(row.name, row.isDir) }),
              (0, import_jsx_runtime4.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: row.name })
            ]
          });
        }),
        ...[...expanded].filter((rel) => nodes.get(rel)?.status === "error").map(
          (rel) => (0, import_jsx_runtime4.jsx)("div", {
            key: `err-${rel}`,
            "data-wt-row-error": true,
            style: { padding: "2px 8px", paddingLeft: 8 + rel.split("/").length * 14, color: "#e06c75", fontSize: "12px" },
            children: `${rel}: ${nodes.get(rel).error}`
          })
        )
      ]
    });
  }
  return (0, import_jsx_runtime4.jsx)("div", {
    ref: panelRef,
    "data-wt-filetree": true,
    style: { position: "relative", minHeight: 0 },
    children: [
      (0, import_jsx_runtime4.jsx)("input", {
        "data-wt-filter": true,
        value: filterQ,
        onChange: (ev) => setFilterQ(ev.target.value),
        placeholder: "\u8FC7\u6EE4\u2026",
        style: {
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
          color: "var(--dsw-alias-text-primary, #ddd)",
          outline: "none",
          fontSize: 12
        }
      }),
      body,
      menu && (0, import_jsx_runtime4.jsx)("div", {
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
          padding: 4
        },
        children: [
          (0, import_jsx_runtime4.jsx)("div", {
            role: "menuitem",
            onClick: onCopy,
            style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
            children: "\u590D\u5236\u7EDD\u5BF9\u8DEF\u5F84"
          }),
          (0, import_jsx_runtime4.jsx)("div", {
            role: "menuitem",
            onClick: onInsert,
            style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
            children: "\u53D1\u9001\u5230\u5BF9\u8BDD\u6846"
          })
        ]
      }),
      preview && (0, import_jsx_runtime4.jsx)(PreviewWindow, {
        file: preview.rel,
        cwd,
        sessionId,
        rpc,
        onClose: () => setPreview(null)
      })
    ]
  });
}

// src/components/changes.js
var import_jsx_runtime6 = require("react/jsx-runtime");
var import_react5 = require("react");

// src/lib/git-changes.js
function normalizeChanges(raw) {
  return (raw ?? []).map((c) => {
    const path = c.path ?? "";
    const idx = path.lastIndexOf("/");
    return {
      status: c.status,
      untracked: !!c.untracked,
      path,
      dir: idx === -1 ? "" : path.slice(0, idx),
      base: idx === -1 ? path : path.slice(idx + 1)
    };
  });
}
function statusLabel(s) {
  switch (s) {
    case "??":
      return "\u672A\u8DDF\u8E2A";
    case "M":
      return "\u4FEE\u6539";
    case "D":
      return "\u5220\u9664";
    case "A":
      return "\u65B0\u589E";
    case "R":
      return "\u91CD\u547D\u540D";
    default:
      return s;
  }
}
function groupByDir(changes) {
  const groups = [];
  const byDir = /* @__PURE__ */ new Map();
  for (const c of changes) {
    if (!byDir.has(c.dir)) {
      byDir.set(c.dir, []);
      groups.push({ dir: c.dir, items: byDir.get(c.dir) });
    }
    byDir.get(c.dir).push(c);
  }
  return groups;
}
function visibleRows2(groups, collapsed) {
  const rows = [];
  for (const g of groups) {
    rows.push({ kind: "dir", dir: g.dir, count: g.items.length });
    if (collapsed.has(g.dir)) continue;
    for (const it of g.items) {
      const { dir, ...rest } = it;
      rows.push({ kind: "file", ...rest });
    }
  }
  return rows;
}
function parseDiff(text) {
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
    } else if (line === "") {
    } else {
      lines.push({ kind: "ctx", text: line, oldLine: null, newLine: null });
    }
  }
  return lines;
}

// src/lib/git-history-client.js
function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 6e4);
  if (min < 1) return "\u521A\u521A";
  if (min < 60) return `${min} \u5206\u949F\u524D`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} \u5C0F\u65F6\u524D`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} \u5929\u524D`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} \u4E2A\u6708\u524D`;
  return `${Math.floor(mon / 12)} \u5E74\u524D`;
}

// src/components/diff-window.js
var import_jsx_runtime5 = require("react/jsx-runtime");
var import_react4 = require("react");
var WINDOW_W2 = 720;
function DiffWindow({ file, untracked, diffLines, diffError, onClose }) {
  const [query, setQuery] = (0, import_react4.useState)("");
  const [matchIdx, setMatchIdx] = (0, import_react4.useState)(0);
  const bodyRef = (0, import_react4.useRef)(null);
  const matches = (0, import_react4.useMemo)(() => {
    const q = query.trim().toLowerCase();
    if (!q || !diffLines) return [];
    const out = [];
    diffLines.forEach((l, i) => {
      if (l.text.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [query, diffLines]);
  (0, import_react4.useEffect)(() => {
    setQuery("");
    setMatchIdx(0);
  }, [file]);
  (0, import_react4.useEffect)(() => {
    if (!bodyRef.current || matches.length === 0) return;
    const idx = matches[Math.min(matchIdx, matches.length - 1)];
    const el = bodyRef.current.querySelector(`[data-line="${idx}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [matchIdx, matches]);
  const nextMatch = (0, import_react4.useCallback)(() => {
    if (matches.length) setMatchIdx((i) => (i + 1) % matches.length);
  }, [matches.length]);
  const prevMatch = (0, import_react4.useCallback)(() => {
    if (matches.length) setMatchIdx((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);
  let body;
  if (diffError) {
    body = (0, import_jsx_runtime5.jsx)("div", { "data-wt-diff-error": true, style: { padding: 16, color: "#e06c75" }, children: diffError });
  } else if (!diffLines) {
    body = (0, import_jsx_runtime5.jsx)("div", { "data-wt-diff-loading": true, style: { padding: 16, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u52A0\u8F7D diff\u2026" });
  } else {
    body = (0, import_jsx_runtime5.jsx)("div", {
      ref: bodyRef,
      "data-wt-diff": true,
      style: { flex: 1, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", paddingBottom: 8 },
      children: diffLines.map((l, i) => {
        let bg = "none";
        let color = "var(--dsw-alias-text-primary, #ddd)";
        if (l.kind === "add") {
          bg = "rgba(126,198,153,0.15)";
          color = "#7ec699";
        } else if (l.kind === "del") {
          bg = "rgba(224,108,117,0.15)";
          color = "#e06c75";
        } else if (l.kind === "hunk") {
          bg = "rgba(97,175,239,0.12)";
          color = "#61afef";
        } else if (l.kind === "meta") {
          color = "var(--dsw-alias-text-secondary, #999)";
        }
        const isMatch = matches.includes(i);
        if (isMatch) {
          bg = "rgba(230,180,80,0.28)";
          color = "#f0d59a";
        }
        const oldCell = l.oldLine !== null ? String(l.oldLine) : " ";
        const newCell = l.newLine !== null ? String(l.newLine) : " ";
        return (0, import_jsx_runtime5.jsx)("div", {
          key: i,
          "data-line": i,
          "data-wt-diff-line": true,
          "data-kind": l.kind,
          "data-wt-match": isMatch || void 0,
          style: { display: "flex", background: bg, color, padding: "0 8px", whiteSpace: "pre" },
          children: [
            (0, import_jsx_runtime5.jsx)("span", { style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 4 }, children: oldCell }),
            (0, import_jsx_runtime5.jsx)("span", { style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 8 }, children: newCell }),
            (0, import_jsx_runtime5.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: l.text })
          ]
        });
      })
    });
  }
  const hasQuery = query.trim() !== "";
  const count = matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : "0/0";
  return (0, import_jsx_runtime5.jsx)(DraggableWindow, {
    wtPrefix: "diff",
    title: file,
    badge: statusLabel(untracked ? "??" : "M"),
    width: WINDOW_W2,
    onClose,
    search: {
      value: query,
      onChange: (v) => {
        setQuery(v);
        setMatchIdx(0);
      },
      onEnter: (e) => e.shiftKey ? prevMatch() : nextMatch(),
      onPrev: prevMatch,
      onNext: nextMatch,
      count,
      active: hasQuery
    },
    children: body
  });
}

// src/components/changes.js
var STATUS_COLOR = {
  M: "#e6b450",
  "??": "#9a9a9a",
  D: "#e06c75",
  A: "#7ec699",
  R: "#61afef"
};
var BTN2 = {
  background: "var(--dsw-alias-bg-float, #1f1f1f)",
  border: "1px solid var(--dsw-alias-border-l2, #444)",
  borderRadius: 4,
  color: "var(--dsw-alias-text-primary, #ddd)",
  cursor: "pointer",
  padding: "2px 8px",
  fontSize: 12,
  flexShrink: 0
};
function Changes({ cwd, sessionId, rpc, onCountChange }) {
  const [groups, setGroups] = (0, import_react5.useState)([]);
  const [status, setStatus] = (0, import_react5.useState)("loading");
  const [error, setError] = (0, import_react5.useState)(null);
  const [collapsed, setCollapsed] = (0, import_react5.useState)(() => /* @__PURE__ */ new Set());
  const [selected, setSelected] = (0, import_react5.useState)(null);
  const [diffLines, setDiffLines] = (0, import_react5.useState)(null);
  const [diffError, setDiffError] = (0, import_react5.useState)(null);
  const [checked, setChecked] = (0, import_react5.useState)(() => /* @__PURE__ */ new Set());
  const [commitMsg, setCommitMsg] = (0, import_react5.useState)("");
  const [showRecent, setShowRecent] = (0, import_react5.useState)(false);
  const [recentMessages, setRecentMessages] = (0, import_react5.useState)([]);
  const [branch, setBranch] = (0, import_react5.useState)("");
  const [commits, setCommits] = (0, import_react5.useState)([]);
  const [histStatus, setHistStatus] = (0, import_react5.useState)("loading");
  const [histError, setHistError] = (0, import_react5.useState)(null);
  const [selCommit, setSelCommit] = (0, import_react5.useState)(null);
  const [confirmReset, setConfirmReset] = (0, import_react5.useState)(false);
  const [splitPct, setSplitPct] = (0, import_react5.useState)(50);
  const [previewLines, setPreviewLines] = (0, import_react5.useState)(null);
  const load = (0, import_react5.useCallback)(() => {
    if (!cwd) {
      setGroups([]);
      setCommits([]);
      setRecentMessages([]);
      setBranch("");
      setStatus("ready");
      setHistStatus("ready");
      setError(null);
      setHistError(null);
      onCountChange?.(0);
      return;
    }
    setStatus("loading");
    setHistStatus("loading");
    setHistError(null);
    Promise.all([
      callRpc(rpc, "git.listChanges", { cwd, sessionId }),
      callRpc(rpc, "git.branch", { cwd, sessionId }),
      callRpc(rpc, "git.log", { cwd, sessionId, limit: 50 })
    ]).then(([changesVal, branchVal, logVal]) => {
      const changes = normalizeChanges(changesVal.changes);
      setGroups(groupByDir(changes));
      setBranch(branchVal.branch ?? "");
      const log = logVal.commits ?? [];
      setCommits(log);
      setRecentMessages(log.slice(0, 5).map((c) => c.subject));
      setChecked((prev) => {
        if (prev.size === 0) return prev;
        const next = /* @__PURE__ */ new Set();
        for (const c of changes) if (prev.has(c.path)) next.add(c.path);
        return next;
      });
      setStatus("ready");
      setError(null);
      setHistStatus("ready");
      onCountChange?.(changes.length);
    }).catch((err) => {
      const msg = String(err?.message ?? err);
      setStatus("error");
      setError(msg);
      setHistStatus("error");
      setHistError(msg);
    });
  }, [cwd, rpc, sessionId, onCountChange]);
  (0, import_react5.useEffect)(() => {
    setSelected(null);
    setDiffLines(null);
    setDiffError(null);
    setPreviewLines(null);
    setCollapsed(/* @__PURE__ */ new Set());
    setChecked(/* @__PURE__ */ new Set());
    setCommitMsg("");
    setShowRecent(false);
    setSelCommit(null);
    setConfirmReset(false);
    load();
  }, [load]);
  const openFile = (0, import_react5.useCallback)(
    (c) => {
      setSelected({ path: c.path, untracked: c.untracked });
      setDiffLines(null);
      setDiffError(null);
      callRpc(rpc, "git.getDiff", { cwd, file: c.path, untracked: c.untracked, sessionId }).then((value) => setDiffLines(parseDiff(value.diff))).catch((err) => setDiffError(String(err?.message ?? err)));
    },
    [cwd, rpc, sessionId]
  );
  const toggleDir = (0, import_react5.useCallback)((dir) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);
  const toggleChecked = (0, import_react5.useCallback)((path) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const rows = (0, import_react5.useMemo)(() => visibleRows2(groups, collapsed), [groups, collapsed]);
  const commitSelected = (0, import_react5.useCallback)(() => {
    const files = [...checked];
    if (files.length === 0) return;
    callRpc(rpc, "git.commit", { cwd, sessionId, message: commitMsg.trim(), files }).then(() => {
      setChecked(/* @__PURE__ */ new Set());
      setCommitMsg("");
      setShowRecent(false);
      setError(null);
      load();
    }).catch((err) => {
      setStatus("error");
      setError(String(err?.message ?? err));
    });
  }, [cwd, rpc, sessionId, checked, commitMsg, load]);
  const commitAll = (0, import_react5.useCallback)(() => {
    callRpc(rpc, "git.commit", { cwd, sessionId, message: commitMsg.trim() }).then(() => {
      setChecked(/* @__PURE__ */ new Set());
      setCommitMsg("");
      setShowRecent(false);
      setError(null);
      load();
    }).catch((err) => {
      setStatus("error");
      setError(String(err?.message ?? err));
    });
  }, [cwd, rpc, sessionId, commitMsg, load]);
  const previewSelected = (0, import_react5.useCallback)(() => {
    const files = [...checked];
    if (files.length === 0) return;
    const meta = /* @__PURE__ */ new Map();
    for (const g of groups) for (const c of g.items) meta.set(c.path, c);
    setSelected({ path: `\u9884\u89C8 ${files.length} \u4E2A\u6587\u4EF6`, untracked: false, preview: true });
    setPreviewLines(null);
    setDiffError(null);
    Promise.all(
      files.map(
        (file) => callRpc(rpc, "git.getDiff", { cwd, file, untracked: meta.get(file)?.untracked ?? false, sessionId }).then((value) => ({ file, lines: parseDiff(value.diff) })).catch((err) => ({ file, lines: [{ kind: "meta", text: `\uFF08\u8BFB\u53D6\u5931\u8D25\uFF1A${err?.message ?? err}\uFF09`, oldLine: null, newLine: null }] }))
      )
    ).then((results) => {
      const lines = [];
      for (const r of results) {
        lines.push({ kind: "meta", text: `--- ${r.file} ---`, oldLine: null, newLine: null });
        lines.push(...r.lines);
      }
      setPreviewLines(lines);
    });
  }, [checked, cwd, groups, rpc, sessionId]);
  const doReset = (0, import_react5.useCallback)(() => {
    if (!selCommit) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    callRpc(rpc, "git.reset", { cwd, sessionId, target: selCommit.hash }).then(() => {
      setSelCommit(null);
      setConfirmReset(false);
      setHistError(null);
      setError(null);
      load();
    }).catch((err) => {
      setHistStatus("error");
      setHistError(String(err?.message ?? err));
    });
  }, [cwd, rpc, sessionId, selCommit, confirmReset, load]);
  const onSplitDown = (0, import_react5.useCallback)((e) => {
    const el = e.currentTarget.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev) => {
      if (rect.height <= 0) return;
      const pct = (ev.clientY - rect.top) / rect.height * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);
  let list;
  if (status === "loading") {
    list = (0, import_jsx_runtime6.jsx)("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u52A0\u8F7D\u4E2D\u2026" });
  } else if (status === "error") {
    list = (0, import_jsx_runtime6.jsx)("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: error });
  } else if (rows.length === 0) {
    list = (0, import_jsx_runtime6.jsx)("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u6CA1\u6709\u53D8\u66F4" });
  } else {
    list = (0, import_jsx_runtime6.jsx)("div", {
      "data-wt-changes-list": true,
      children: rows.map(
        (row) => row.kind === "dir" ? (0, import_jsx_runtime6.jsx)("div", {
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
            alignItems: "center"
          },
          children: [
            (0, import_jsx_runtime6.jsx)("span", { children: collapsed.has(row.dir) ? "\u25B8" : "\u25BE" }),
            (0, import_jsx_runtime6.jsx)("span", { children: row.dir === "" ? "\uFF08\u6839\u76EE\u5F55\uFF09" : row.dir }),
            (0, import_jsx_runtime6.jsx)("span", { style: { opacity: 0.6 }, children: `${row.count}` })
          ]
        }) : (0, import_jsx_runtime6.jsx)("div", {
          key: `file-${row.path}`,
          role: "button",
          "data-wt-changes-file": true,
          "data-selected": selected?.path === row.path || void 0,
          onClick: () => openFile(row),
          style: {
            padding: "3px 10px",
            paddingLeft: 26,
            cursor: "pointer",
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: selected?.path === row.path ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none"
          },
          children: [
            (0, import_jsx_runtime6.jsx)("input", {
              type: "checkbox",
              "data-wt-check": true,
              checked: checked.has(row.path),
              onChange: () => toggleChecked(row.path),
              onClick: (e) => e.stopPropagation(),
              // 勾选不触发行点击（打开 diff）
              style: { flexShrink: 0, margin: 0, accentColor: "var(--dsw-alias-accent, #4f8cff)" }
            }),
            (0, import_jsx_runtime6.jsx)("span", {
              style: {
                width: 20,
                textAlign: "center",
                fontSize: "11px",
                fontWeight: 700,
                color: STATUS_COLOR[row.status] ?? "#ccc",
                border: `1px solid ${STATUS_COLOR[row.status] ?? "#ccc"}`,
                borderRadius: 3,
                flexShrink: 0
              },
              children: row.status === "??" ? "?" : row.status
            }),
            (0, import_jsx_runtime6.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: row.base })
          ]
        })
      )
    });
  }
  let history;
  if (histStatus === "loading") {
    history = (0, import_jsx_runtime6.jsx)("div", { style: { padding: 10, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u52A0\u8F7D\u5386\u53F2\u2026" });
  } else if (histStatus === "error") {
    history = (0, import_jsx_runtime6.jsx)("div", { "data-wt-history-error": true, style: { padding: 10, color: "#e06c75" }, children: histError });
  } else if (commits.length === 0) {
    history = (0, import_jsx_runtime6.jsx)("div", { style: { padding: 10, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u6CA1\u6709\u63D0\u4EA4\u8BB0\u5F55" });
  } else {
    history = (0, import_jsx_runtime6.jsx)("div", {
      "data-wt-history-list": true,
      children: commits.map(
        (c) => (0, import_jsx_runtime6.jsx)("div", {
          key: c.hash,
          "data-wt-history-row": true,
          "data-selected": selCommit?.hash === c.hash || void 0,
          onClick: () => {
            setSelCommit(c);
            setConfirmReset(false);
          },
          style: {
            padding: "4px 10px",
            cursor: "pointer",
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: selCommit?.hash === c.hash ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none"
          },
          children: [
            (0, import_jsx_runtime6.jsx)("span", { style: { color: "#e6b450", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", flexShrink: 0 }, children: c.shortHash }),
            (0, import_jsx_runtime6.jsx)("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.subject }),
            (0, import_jsx_runtime6.jsx)("span", { style: { flexShrink: 0, color: "var(--dsw-alias-text-secondary, #999)", fontSize: 11 }, children: relativeTime(c.date) })
          ]
        })
      )
    });
  }
  const resetBar = selCommit ? (0, import_jsx_runtime6.jsx)("div", {
    "data-wt-reset-bar": true,
    style: {
      padding: "6px 10px",
      borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      flexShrink: 0,
      background: "var(--dsw-alias-bg-base, #1a1a1a)"
    },
    children: [
      (0, import_jsx_runtime6.jsx)("button", {
        type: "button",
        "data-wt-reset": true,
        onClick: doReset,
        style: {
          padding: "5px 10px",
          borderRadius: 4,
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 12,
          color: "#fff",
          background: confirmReset ? "#c0392b" : "#555"
          // 默认灰，确认时变红
        },
        children: confirmReset ? "\u786E\u8BA4\u56DE\u9000\uFF1F" : `\u56DE\u9000\u5230 ${selCommit.shortHash}`
      }),
      (0, import_jsx_runtime6.jsx)("div", {
        "data-wt-reset-warn": true,
        style: { color: "#e6b450", fontSize: 11, lineHeight: 1.4 },
        children: "\u82E5\u8BE5\u63D0\u4EA4\u5DF2\u63A8\u9001\uFF0C\u56DE\u9000\u540E\u91CD\u65B0\u63A8\u9001\u9700 force"
      })
    ]
  }) : null;
  const n = checked.size;
  const msgEmpty = commitMsg.trim() === "";
  const toolRow = (0, import_jsx_runtime6.jsx)("div", {
    style: { position: "relative", flexShrink: 0 },
    children: [
      (0, import_jsx_runtime6.jsx)("div", {
        "data-wt-tools": true,
        style: { display: "flex", gap: 4, padding: "4px 6px", alignItems: "center", flexWrap: "wrap" },
        children: [
          (0, import_jsx_runtime6.jsx)("input", {
            type: "text",
            "data-wt-commit-msg": true,
            placeholder: "\u63D0\u4EA4\u6D88\u606F\u2026",
            value: commitMsg,
            onChange: (e) => setCommitMsg(e.target.value),
            style: {
              flex: "1 1 120px",
              minWidth: 100,
              background: "var(--dsw-alias-bg-base, #141414)",
              border: "1px solid var(--dsw-alias-border-l2, #333)",
              borderRadius: 4,
              color: "var(--dsw-alias-text-primary, #ddd)",
              padding: "3px 8px",
              fontSize: 12,
              outline: "none"
            }
          }),
          (0, import_jsx_runtime6.jsx)("button", {
            type: "button",
            "data-wt-recent": true,
            title: "\u6700\u8FD1\u63D0\u4EA4\u6D88\u606F",
            onClick: () => setShowRecent((v) => !v),
            style: { ...BTN2, color: "var(--dsw-alias-text-secondary, #999)" },
            children: "\u25BE \u6700\u8FD1"
          }),
          (0, import_jsx_runtime6.jsx)("button", {
            type: "button",
            "data-wt-commit-selected": true,
            disabled: n === 0 || msgEmpty,
            onClick: commitSelected,
            style: { ...BTN2, opacity: n === 0 || msgEmpty ? 0.45 : 1, cursor: n === 0 || msgEmpty ? "default" : "pointer" },
            children: `\u63D0\u4EA4\u9009\u4E2D(${n})`
          }),
          (0, import_jsx_runtime6.jsx)("button", {
            type: "button",
            "data-wt-commit-all": true,
            onClick: commitAll,
            style: BTN2,
            children: "\u5168\u90E8\u63D0\u4EA4"
          }),
          (0, import_jsx_runtime6.jsx)("button", {
            type: "button",
            "data-wt-preview-selected": true,
            disabled: n === 0,
            onClick: previewSelected,
            style: { ...BTN2, opacity: n === 0 ? 0.45 : 1, cursor: n === 0 ? "default" : "pointer" },
            children: `\u9884\u89C8(${n})`
          })
        ]
      }),
      showRecent && (0, import_jsx_runtime6.jsx)("div", {
        "data-wt-recent-list": true,
        style: {
          position: "absolute",
          top: "100%",
          left: 6,
          right: 6,
          zIndex: 10,
          background: "var(--dsw-alias-bg-float, #1f1f1f)",
          border: "1px solid var(--dsw-alias-border-l2, #333)",
          borderRadius: 6,
          boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          maxHeight: 160,
          overflow: "auto"
        },
        children: recentMessages.length === 0 ? (0, import_jsx_runtime6.jsx)("div", { style: { padding: "6px 10px", color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12 }, children: "\uFF08\u6682\u65E0\u6700\u8FD1\u6D88\u606F\uFF09" }) : recentMessages.map(
          (m, i) => (0, import_jsx_runtime6.jsx)("div", {
            key: i,
            "data-wt-recent-item": true,
            onClick: () => {
              setCommitMsg(m);
              setShowRecent(false);
            },
            style: {
              padding: "5px 10px",
              cursor: "pointer",
              fontSize: 12,
              color: "var(--dsw-alias-text-primary, #ddd)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: m
          })
        )
      })
    ]
  });
  const infoRow = (0, import_jsx_runtime6.jsx)("div", {
    "data-wt-info": true,
    style: { display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", flexShrink: 0, color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12 },
    children: [
      (0, import_jsx_runtime6.jsx)("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: `\u{1F4CC} ${branch || "detached"}` }),
      (0, import_jsx_runtime6.jsx)("button", {
        type: "button",
        "data-wt-refresh": true,
        onClick: load,
        style: { background: "none", border: "none", cursor: "pointer", color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12, padding: "2px 8px" },
        children: "\u21BB \u5237\u65B0"
      })
    ]
  });
  const upperPane = (0, import_jsx_runtime6.jsx)("div", {
    "data-wt-upper": true,
    style: { height: `${splitPct}%`, minHeight: 0, flexShrink: 0, display: "flex", flexDirection: "column" },
    children: [
      toolRow,
      (0, import_jsx_runtime6.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: list })
    ]
  });
  const splitBar = (0, import_jsx_runtime6.jsx)("div", {
    "data-wt-split": true,
    onMouseDown: onSplitDown,
    title: "\u62D6\u62FD\u8C03\u6574\u4E0A\u4E0B\u6BD4\u4F8B",
    style: { height: 5, flexShrink: 0, cursor: "row-resize", background: "var(--dsw-alias-border-l2, #333)" }
  });
  const lowerPane = (0, import_jsx_runtime6.jsx)("div", {
    "data-wt-history": true,
    style: {
      flex: 1,
      minHeight: 0,
      overflow: "auto",
      display: "flex",
      flexDirection: "column",
      borderTop: "1px solid var(--dsw-alias-border-l2, #333)"
    },
    children: [(0, import_jsx_runtime6.jsx)("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: history }), resetBar]
  });
  let diffWindow = null;
  if (selected) {
    const isPreview = !!selected.preview;
    diffWindow = (0, import_jsx_runtime6.jsx)(DiffWindow, {
      file: selected.path,
      untracked: selected.untracked,
      diffLines: isPreview ? previewLines : diffLines,
      diffError: isPreview ? null : diffError,
      onClose: () => {
        setSelected(null);
        setDiffLines(null);
        setDiffError(null);
        setPreviewLines(null);
      }
    });
  }
  return (0, import_jsx_runtime6.jsx)("div", {
    "data-wt-changes": true,
    style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
    children: [infoRow, upperPane, splitBar, lowerPane, diffWindow]
  });
}

// src/components/workspace-browser.js
var TABS = [
  { id: "files", label: "\u6587\u4EF6" },
  { id: "changes", label: "\u53D8\u66F4" },
  { id: "sessions", label: "\u4F1A\u8BDD" }
];
function RightSidebar({ useSessions, rpc, openSession, insertIntoComposer }) {
  const [open, setOpen] = (0, import_react6.useState)(true);
  const [tab, setTab] = (0, import_react6.useState)("files");
  const [railW, setRailW] = (0, import_react6.useState)(300);
  const [changeCount, setChangeCount] = (0, import_react6.useState)(0);
  const current = useSessions((s) => s.current);
  const cwd = useSessions((s) => s.current ? s.byId[s.current]?.cwd : void 0);
  const onResizeDown = (0, import_react6.useCallback)((e) => {
    const move = (ev) => setRailW(Math.min(600, Math.max(200, window.innerWidth - ev.clientX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);
  return (0, import_jsx_runtime7.jsx)("div", {
    "data-wt-rail": true,
    style: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: open ? railW : void 0,
      // 收起时不占宽：rail 不留隐形拦截层，按钮贴右缘
      display: "flex",
      zIndex: 5,
      fontSize: "13px",
      color: "var(--dsw-alias-text-primary, #ddd)"
    },
    children: [
      // 宽度拖拽把手（rail 首子元素）
      (0, import_jsx_runtime7.jsx)("div", {
        "data-wt-resize": true,
        onMouseDown: onResizeDown,
        title: "\u62D6\u62FD\u8C03\u6574\u5BBD\u5EA6",
        style: {
          width: 4,
          flexShrink: 0,
          cursor: "col-resize",
          background: "var(--dsw-alias-bg-float, #1f1f1f)",
          borderLeft: "1px solid var(--dsw-alias-border-l2, #333)"
        }
      }),
      // 收展按钮（面板左侧窄条）
      (0, import_jsx_runtime7.jsx)("button", {
        type: "button",
        "data-wt-toggle": true,
        "aria-label": open ? "\u6536\u8D77\u5DE5\u5177\u4FA7\u8FB9\u680F" : "\u5C55\u5F00\u5DE5\u5177\u4FA7\u8FB9\u680F",
        title: open ? "\u6536\u8D77" : "\u5C55\u5F00",
        onClick: () => setOpen((v) => !v),
        style: {
          width: 18,
          border: "none",
          borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
          background: "var(--dsw-alias-bg-float, #1f1f1f)",
          color: "var(--dsw-alias-text-secondary, #999)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "10px",
          padding: 0
        },
        children: open ? "\u25B8" : "\u25C2"
      }),
      open && (0, import_jsx_runtime7.jsx)("div", {
        "data-wt-panel": true,
        style: {
          flex: 1,
          minWidth: 0,
          background: "var(--dsw-alias-bg-base, #1a1a1a)",
          borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0
        },
        children: [
          (0, import_jsx_runtime7.jsx)("div", {
            "data-wt-tabs": true,
            style: {
              display: "flex",
              borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
              flexShrink: 0
            },
            children: TABS.map(
              (t) => (0, import_jsx_runtime7.jsx)("button", {
                key: t.id,
                type: "button",
                onClick: () => setTab(t.id),
                "data-active": tab === t.id || void 0,
                style: {
                  flex: 1,
                  padding: "8px 4px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: tab === t.id ? "var(--dsw-alias-text-primary, #fff)" : "var(--dsw-alias-text-secondary, #999)",
                  borderBottom: tab === t.id ? "2px solid var(--dsw-alias-accent, #4f8cff)" : "2px solid transparent"
                },
                children: t.id === "changes" && changeCount > 0 ? `\u53D8\u66F4 ${changeCount}` : t.label
              })
            )
          }),
          (0, import_jsx_runtime7.jsx)("div", {
            "data-wt-tabpanel": true,
            style: { flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" },
            children: tab === "sessions" ? (0, import_jsx_runtime7.jsx)(SessionList, { useSessions, openSession }) : tab === "files" ? (0, import_jsx_runtime7.jsx)(FileTree, { key: cwd ?? "no-cwd", cwd, sessionId: current, rpc, insertIntoComposer }) : (0, import_jsx_runtime7.jsx)(Changes, { cwd, sessionId: current, rpc, onCountChange: setChangeCount })
          })
        ]
      })
    ]
  });
}

// src/lib/insert.js
function composeDraftInsert(draft, text) {
  const base = draft.replace(/\s+$/, "");
  return base === "" ? text : `${base} ${text}`;
}

// src/index.js
var name = "dsh-workspace-tools";
var inject = ["slots", "sessions", "connection"];
function apply(ctx) {
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-workspace-tools",
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
          }
        })
      },
      RightSidebar
    )
  );
}
var index_default = { name, inject, apply };

    return module.exports;
  }
});
//# sourceMappingURL=client.js.map
