// src/components/diff-window.js —— 可拖拽的 diff 浮窗 + 字符串搜索（2026-08-15 用户需求）
// position:fixed 相对 viewport 定位（脱离右侧 rail 容器），标题栏拖拽移动；
// 搜索框按字符串匹配 diff 行（大小写不敏感），计数 + 上一个/下一个滚动定位。
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { statusLabel } from "../lib/git-changes.js";

const WINDOW_W = 720;

export function DiffWindow({ file, untracked, diffLines, diffError, onClose }) {
  const [pos, setPos] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    return { x: Math.max(8, vw - WINDOW_W - 24), y: 64 };
  });
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const bodyRef = useRef(null);
  const dragRef = useRef(null);

  // 匹配行索引（大小写不敏感子串）
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !diffLines) return [];
    const out = [];
    diffLines.forEach((l, i) => {
      if (l.text.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [query, diffLines]);

  // 换文件时重置搜索
  useEffect(() => {
    setQuery("");
    setMatchIdx(0);
  }, [file]);

  // 匹配索引变化 → 滚动到对应行
  useEffect(() => {
    if (!bodyRef.current || matches.length === 0) return;
    const idx = matches[Math.min(matchIdx, matches.length - 1)];
    const el = bodyRef.current.querySelector(`[data-line="${idx}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [matchIdx, matches]);

  // 标题栏拖拽（忽略搜索框/按钮上的按下）
  const onTitleDown = useCallback(
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
    [pos],
  );

  const nextMatch = useCallback(() => {
    if (matches.length) setMatchIdx((i) => (i + 1) % matches.length);
  }, [matches.length]);
  const prevMatch = useCallback(() => {
    if (matches.length) setMatchIdx((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  let body;
  if (diffError) {
    body = jsx("div", { "data-wt-diff-error": true, style: { padding: 16, color: "#e06c75" }, children: diffError });
  } else if (!diffLines) {
    body = jsx("div", { "data-wt-diff-loading": true, style: { padding: 16, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载 diff…" });
  } else {
    body = jsx("div", {
      ref: bodyRef,
      "data-wt-diff": true,
      style: { flex: 1, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", paddingBottom: 8 },
      children: diffLines.map((l, i) => {
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

  const hasQuery = query.trim() !== "";

  return jsx("div", {
    "data-wt-diff-window": true,
    style: {
      position: "fixed",
      left: pos.x,
      top: pos.y,
      width: WINDOW_W,
      maxWidth: "94vw",
      height: "66vh",
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
      // 标题栏（拖拽把手）
      jsx("div", {
        "data-wt-diff-window-title": true,
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
          userSelect: "none",
        },
        children: [
          jsx("span", { style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, children: file }),
          jsx("span", {
            style: {
              fontSize: "10px",
              padding: "1px 5px",
              border: "1px solid #888",
              borderRadius: 3,
              color: "#aaa",
              flexShrink: 0,
            },
            children: statusLabel(untracked ? "??" : "M"),
          }),
          jsx("input", {
            "data-wt-diff-search": true,
            type: "text",
            placeholder: "搜索…",
            value: query,
            onChange: (e) => {
              setQuery(e.target.value);
              setMatchIdx(0);
            },
            onKeyDown: (e) => {
              if (e.key === "Enter") e.shiftKey ? prevMatch() : nextMatch();
              if (e.key === "Escape") onClose();
            },
            style: {
              flex: 1,
              minWidth: 60,
              background: "var(--dsw-alias-bg-base, #141414)",
              border: "1px solid var(--dsw-alias-border-l2, #333)",
              borderRadius: 4,
              color: "var(--dsw-alias-text-primary, #ddd)",
              padding: "3px 8px",
              fontSize: 12,
              outline: "none",
            },
          }),
          hasQuery &&
            jsx("span", { "data-wt-diff-matchcount": true, style: { color: "#e6b450", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }, children: matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : "0/0" }),
          hasQuery &&
            jsx("button", {
              type: "button",
              "data-wt-diff-prev": true,
              onClick: prevMatch,
              style: { background: "none", border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 4, color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", padding: "1px 7px", fontSize: 11, flexShrink: 0 },
              children: "↑",
            }),
          hasQuery &&
            jsx("button", {
              type: "button",
              "data-wt-diff-next": true,
              onClick: nextMatch,
              style: { background: "none", border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 4, color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", padding: "1px 7px", fontSize: 11, flexShrink: 0 },
              children: "↓",
            }),
          jsx("button", {
            type: "button",
            "data-wt-diff-close": true,
            onClick: onClose,
            title: "关闭（Esc）",
            style: { background: "none", border: "none", color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 },
            children: "✕",
          }),
        ],
      }),
      body,
    ],
  });
}
