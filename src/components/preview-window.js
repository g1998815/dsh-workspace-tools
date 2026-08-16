// src/components/preview-window.js —— 文件预览浮窗（文本：等宽+搜索；图片：data URL）
// M3c Task 2：复用 DraggableWindow（标题栏拖拽/关闭/搜索条），本组件保留
// 加载逻辑、matches 计算与滚动定位（bodyRef 在子内容区）；搜索状态留在本组件。
// 标记：data-wt-preview-window（根，由 DraggableWindow 渲染）、data-wt-preview-search、
// data-wt-preview-prev/next/close、data-wt-preview-* 正文标记全部保留。
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { previewKind } from "../lib/preview.js";
import { tokenize } from "../lib/tokenize.js";
import { DraggableWindow } from "./draggable-window.js";

const WINDOW_W = 960; // M5：原 640 × 1.5（用户需求：默认宽度为原来的 1.5 倍）

const TOKEN_COLORS = { str: "#7ec699", com: "#6a737d", kw: "#61afef", num: "#e6b450" };

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };

export function PreviewWindow({ file, cwd, sessionId, rpc, onClose, insertIntoComposer }) {
  const kind = previewKind(file);
  const ext = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
  const [state, setState] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [textLines, setTextLines] = useState(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [selection, setSelection] = useState(null); // {sl, sc, el, ec} 1-based 行列范围
  const [menu, setMenu] = useState(null); // {x, y}
  const bodyRef = useRef(null);
  const menuRef = useRef(null);

  // 右键菜单：外部点击/Escape 关闭
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

  // 鼠标抬起：计算选中范围（起止行列，1-based）。反向选择自动归一。
  const onMouseUp = useCallback(() => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // 由 DOM 节点 + 节点内偏移 → {line, col}（1-based）。节点向上找行 div(data-line)
    // 与 token span(data-col)；节点内偏移计入列。行号 = data-line+1。
    const locate = (container, offset) => {
      const node = container.nodeType === 3 ? container : container.childNodes[offset] ?? container;
      let el = node.nodeType === 3 ? node.parentElement : node;
      let lineEl = el;
      while (lineEl && !lineEl.hasAttribute("data-line")) lineEl = lineEl.parentElement;
      if (!lineEl) return null;
      const line = Number(lineEl.getAttribute("data-line")) + 1;
      let col = 1;
      let span = el;
      while (span && !span.hasAttribute("data-col")) span = span.parentElement;
      if (span && span.hasAttribute("data-col")) {
        col = Number(span.getAttribute("data-col"));
        if (node.nodeType === 3) col += node.nodeValue.slice(0, offset).length;
      } else if (node.nodeType === 3) {
        col = 1 + node.nodeValue.slice(0, offset).length;
      } else {
        // 容器本身（无 span/文本）：按子节点个数粗估列（少见）
        col = 1;
      }
      return { line, col };
    };
    const start = locate(range.startContainer, range.startOffset);
    const end = locate(range.endContainer, range.endOffset);
    if (!start || !end) return;
    const less = (p, q) => p.line < q.line || (p.line === q.line && p.col <= q.col);
    const [s, e] = less(start, end) ? [start, end] : [end, start];
    setSelection({ sl: s.line, sc: s.col, el: e.line, ec: e.col });
  }, []);

  // 右键：有选区才弹菜单（发送到对话框），否则不拦截
  const onContextMenu = useCallback(
    (ev) => {
      if (!selection) return; // 无选区：保留默认右键
      ev.preventDefault();
      ev.stopPropagation();
      setMenu({ x: ev.clientX, y: ev.clientY });
    },
    [selection],
  );

  // 发送到对话框：只发文件名 + 行列范围，不发内容
  const sendSelection = useCallback(() => {
    if (!selection || !insertIntoComposer || !sessionId) {
      setMenu(null);
      return;
    }
    const { sl, sc, el, ec } = selection;
    const text = `${file}:${sl}:${sc}-${el}:${ec}`;
    insertIntoComposer(sessionId, text);
    setMenu(null);
  }, [selection, insertIntoComposer, sessionId, file]);

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

  const nextMatch = useCallback(() => { if (matches.length) setMatchIdx((i) => (i + 1) % matches.length); }, [matches.length]);
  const prevMatch = useCallback(() => { if (matches.length) setMatchIdx((i) => (i - 1 + matches.length) % matches.length); }, [matches.length]);

  let body;
  if (state === "error") {
    body = jsx("div", { "data-wt-preview-error": true, style: { padding: 16, color: "#e06c75" }, children: error });
  } else if (state === "loading") {
    body = jsx("div", { "data-wt-preview-loading": true, style: { padding: 16, color: "var(--dsw-alias-label-secondary, #666)" }, children: "加载中…" });
  } else if (kind === "image") {
    body = jsx("div", { style: { flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }, children: jsx("img", { "data-wt-preview-image": true, src: imgUrl, alt: file, style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 } }) });
  } else {
    body = jsx("div", {
      ref: bodyRef,
      "data-wt-preview-text": true,
      onMouseUp,
      onContextMenu,
      style: { flex: 1, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", padding: "4px 10px 12px", whiteSpace: "pre", userSelect: "text" },
      children: textLines.map((t, i) => {
        const isMatch = matches.includes(i);
        // 累积列号：每个 token span 记 data-col（1-based 起始列），供选区行列计算
        let colAcc = 1;
        const toks = tokenize(t || " ", ext);
        return jsx("div", {
          key: i,
          "data-line": i,
          "data-wt-preview-line": true,
          "data-wt-match": isMatch || undefined,
          style: { display: "flex", background: isMatch ? "rgba(230,180,80,0.28)" : "none", color: isMatch ? "#9e6a03" : undefined },
          children: [
            jsx("span", {
              "data-wt-preview-lineno": true,
              style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-label-secondary, #888)", paddingRight: 8, userSelect: "none" },
              children: String(i + 1),
            }),
            jsx("span", {
              children: toks.map((tok, j) => {
                const startCol = colAcc;
                colAcc += tok.text.length;
                return tok.cls
                  ? jsx("span", { key: j, "data-col": startCol, style: { color: TOKEN_COLORS[tok.cls] }, children: tok.text })
                  : jsx("span", { key: j, "data-col": startCol, children: tok.text });
              }),
            }),
          ],
        });
      }),
    });
  }

  const hasQuery = query.trim() !== "";
  const count = matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : "0/0";

  return jsx(DraggableWindow, {
    wtPrefix: "preview",
    title: file,
    badge: kind,
    width: WINDOW_W,
    onClose,
    search: kind === "text"
      ? {
          value: query,
          onChange: (v) => {
            setQuery(v);
            setMatchIdx(0);
          },
          onEnter: (e) => (e.shiftKey ? prevMatch() : nextMatch()),
          onPrev: prevMatch,
          onNext: nextMatch,
          count,
          active: hasQuery,
        }
      : undefined,
    children: [
      body,
      // 右键菜单：发送到对话框（只发文件名+行列范围，不发内容）
      menu &&
        jsx("div", {
          ref: menuRef,
          "data-wt-preview-menu": true,
          style: {
            position: "fixed",
            left: menu.x,
            top: menu.y,
            zIndex: 110,
            minWidth: 180,
            background: "var(--dsw-alias-bg-overlay, #1f1f1f)",
            border: "1px solid var(--dsw-alias-border-l2, #333)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            padding: 4,
          },
          children: [
            jsx("div", {
              role: "menuitem",
              "data-wt-preview-send": true,
              onClick: sendSelection,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "发送到对话框",
            }),
            selection &&
              jsx("div", {
                style: { padding: "4px 10px", color: "var(--dsw-alias-label-secondary, #888)", fontSize: 11, borderTop: "1px solid var(--dsw-alias-border-l2, #333)" },
                children: `${file}:${selection.sl}:${selection.sc}-${selection.el}:${selection.ec}`,
              }),
          ],
        }),
    ],
  });
}
