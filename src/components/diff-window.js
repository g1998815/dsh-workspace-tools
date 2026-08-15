// src/components/diff-window.js —— 可拖拽的 diff 浮窗 + 字符串搜索（2026-08-15 用户需求）
// M3c Task 2：复用 DraggableWindow（标题栏拖拽/关闭/搜索条），本组件保留
// matches 计算与滚动定位（bodyRef 在子内容区）；搜索状态（query/matches/matchIdx）留在本组件。
// 标记：data-wt-diff-window（根，由 DraggableWindow 渲染）、data-wt-diff-search、
// data-wt-diff-prev/next/close、data-wt-diff-* 正文标记全部保留。
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { statusLabel } from "../lib/git-changes.js";
import { DraggableWindow } from "./draggable-window.js";

const WINDOW_W = 720;

export function DiffWindow({ file, untracked, diffLines, diffError, onClose }) {
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const bodyRef = useRef(null);

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
  const count = matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : "0/0";

  return jsx(DraggableWindow, {
    wtPrefix: "diff",
    title: file,
    badge: statusLabel(untracked ? "??" : "M"),
    width: WINDOW_W,
    onClose,
    search: {
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
    },
    children: body,
  });
}
