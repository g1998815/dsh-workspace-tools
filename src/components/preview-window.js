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
