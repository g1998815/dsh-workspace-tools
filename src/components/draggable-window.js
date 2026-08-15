// src/components/draggable-window.js —— 可拖拽浮窗外壳（标题栏 + 关闭 + 可选受控搜索条）
// M3c Task 2：从 diff/preview 浮窗提取的公共组件，行为与原实现等价：
//   · position:fixed 容器 + pos state + 标题栏拖拽（input/button 除外）+ ✕ 关闭
//   · search?: { value, onChange, onEnter, onPrev, onNext, count, active }——受控搜索条
//     渲染（输入 + n/m + ↑/↓）；滚动定位由子组件自管（子组件持有 bodyRef + matches）
//   · wtPrefix：data-wt-* 标记前缀（默认 "window"）。标记名全部写成字面量（WT 表），
//     保证 esbuild 压缩后 client.js 中仍保留 data-wt-window / data-wt-diff-search /
//     data-wt-preview-search 等静态验证依赖的字符串（运行时拼接会被压缩掉字面量）。
import { jsx } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";

// 搜索按钮样式（与旧 diff/preview 浮窗的 ↑/↓ 按钮一致）
const BTN = {
  background: "none",
  border: "1px solid var(--dsw-alias-border-l2, #444)",
  borderRadius: 4,
  color: "var(--dsw-alias-text-secondary, #999)",
  cursor: "pointer",
  padding: "1px 7px",
  fontSize: 11,
  flexShrink: 0,
};

// data-wt-* 标记字面量表（wtPrefix 索引；根容器另始终带 data-wt-window）
const WT = {
  window: {
    root: "data-wt-window",
    title: "data-wt-window-title",
    count: "data-wt-window-count",
    close: "data-wt-window-close",
    search: "data-wt-window-search",
    prev: "data-wt-window-prev",
    next: "data-wt-window-next",
  },
  diff: {
    root: "data-wt-diff-window",
    title: "data-wt-diff-title",
    count: "data-wt-diff-count",
    close: "data-wt-diff-close",
    search: "data-wt-diff-search",
    prev: "data-wt-diff-prev",
    next: "data-wt-diff-next",
  },
  preview: {
    root: "data-wt-preview-window",
    title: "data-wt-preview-title",
    count: "data-wt-preview-count",
    close: "data-wt-preview-close",
    search: "data-wt-preview-search",
    prev: "data-wt-preview-prev",
    next: "data-wt-preview-next",
  },
};

export function DraggableWindow({ title, badge, width = 640, onClose, search, wtPrefix = "window", children }) {
  const wt = WT[wtPrefix] ?? WT.window;
  const [pos, setPos] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    return { x: Math.max(8, vw - width - 24), y: 64 };
  });
  const dragRef = useRef(null);
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
  const hasQuery = search != null && search.value.trim() !== "";
  const rootAttrs = { "data-wt-window": true };
  if (wtPrefix !== "window") rootAttrs[wt.root] = true;
  return jsx("div", {
    ...rootAttrs,
    style: {
      position: "fixed", left: pos.x, top: pos.y, width, maxWidth: "94vw", height: "68vh", minHeight: 240,
      display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base, #1a1a1a)",
      border: "1px solid var(--dsw-alias-border-l2, #333)", borderRadius: 8,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 100, fontSize: 12, overflow: "hidden",
    },
    children: [
      // 标题栏（拖拽把手）
      jsx("div", {
        [wt.title]: true,
        onMouseDown: onTitleDown,
        style: {
          display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "move",
          background: "var(--dsw-alias-bg-float, #1f1f1f)", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
          flexShrink: 0, userSelect: "none",
        },
        children: [
          jsx("span", { style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, children: title }),
          badge && jsx("span", { style: { fontSize: 10, padding: "1px 5px", border: "1px solid #888", borderRadius: 3, color: "#aaa", flexShrink: 0 }, children: badge }),
          hasQuery && jsx("span", { [wt.count]: true, style: { color: "#e6b450", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }, children: search.count }),
          jsx("button", {
            type: "button",
            [wt.close]: true,
            onClick: onClose,
            title: "关闭（Esc）",
            style: { marginLeft: "auto", background: "none", border: "none", color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 },
            children: "✕",
          }),
        ],
      }),
      // 受控搜索条（输入 + n/m + ↑/↓）
      search &&
        jsx("div", {
          style: { display: "flex", gap: 6, padding: "5px 10px", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)", flexShrink: 0, alignItems: "center" },
          children: [
            jsx("input", {
              [wt.search]: true,
              type: "text",
              placeholder: "搜索…",
              value: search.value,
              onChange: (e) => search.onChange(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") search.onEnter(e);
                if (e.key === "Escape") onClose();
              },
              style: { flex: 1, background: "var(--dsw-alias-bg-base, #141414)", border: "1px solid var(--dsw-alias-border-l2, #333)", borderRadius: 4, color: "var(--dsw-alias-text-primary, #ddd)", padding: "3px 8px", fontSize: 12, outline: "none" },
            }),
            hasQuery && jsx("button", { type: "button", [wt.prev]: true, onClick: search.onPrev, style: BTN, children: "↑" }),
            hasQuery && jsx("button", { type: "button", [wt.next]: true, onClick: search.onNext, style: BTN, children: "↓" }),
          ],
        }),
      children,
    ],
  });
}
