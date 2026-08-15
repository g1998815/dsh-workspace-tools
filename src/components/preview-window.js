// src/components/preview-window.js —— 文件预览浮窗（文本：等宽+搜索；图片：data URL）
// M3c Task 2：复用 DraggableWindow（标题栏拖拽/关闭/搜索条），本组件保留
// 加载逻辑、matches 计算与滚动定位（bodyRef 在子内容区）；搜索状态留在本组件。
// 标记：data-wt-preview-window（根，由 DraggableWindow 渲染）、data-wt-preview-search、
// data-wt-preview-prev/next/close、data-wt-preview-* 正文标记全部保留。
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { previewKind } from "../lib/preview.js";
import { DraggableWindow } from "./draggable-window.js";

const WINDOW_W = 640;

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };

export function PreviewWindow({ file, cwd, sessionId, rpc, onClose }) {
  const kind = previewKind(file);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [textLines, setTextLines] = useState(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const bodyRef = useRef(null);

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
    children: body,
  });
}
