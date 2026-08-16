// src/components/draggable-window.js —— 可拖拽浮窗外壳（标题栏 + 关闭 + 可选受控搜索条 + resize）
// M3c Task 2：从 diff/preview 浮窗提取的公共组件。
// M5 改版（2026-08-15 用户需求）：
//   · 打开位置默认**视口正中心**（不再右上角）
//   · 默认高度 = 视口 68vh × 1.2 ≈ 81.6vh（宽度由调用方传放大后的值，见各窗口 WINDOW_W）
//   · 右下角新增 resize 把手（data-wt-window-resize），拖动调整窗口尺寸（min 320×240）
//   · search?: { value, onChange, onEnter, onPrev, onNext, count, active }——受控搜索条
//   · wtPrefix：data-wt-* 标记前缀（默认 "window"）。标记名全部写成字面量（WT 表），
//     保证 esbuild 压缩后 client.js 中仍保留 data-wt-window / data-wt-diff-search /
//     data-wt-preview-search 等静态验证依赖的字符串。
import { jsx } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";

// 搜索按钮样式（与旧 diff/preview 浮窗的 ↑/↓ 按钮一致）
const BTN = {
  background: "none",
  border: "1px solid var(--dsw-alias-border-l2, #444)",
  borderRadius: 4,
  color: "var(--dsw-alias-label-secondary, #666)",
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
    resize: "data-wt-window-resize",
  },
  diff: {
    root: "data-wt-diff-window",
    title: "data-wt-diff-title",
    count: "data-wt-diff-count",
    close: "data-wt-diff-close",
    search: "data-wt-diff-search",
    prev: "data-wt-diff-prev",
    next: "data-wt-diff-next",
    resize: "data-wt-diff-resize",
  },
  preview: {
    root: "data-wt-preview-window",
    title: "data-wt-preview-title",
    count: "data-wt-preview-count",
    close: "data-wt-preview-close",
    search: "data-wt-preview-search",
    prev: "data-wt-preview-prev",
    next: "data-wt-preview-next",
    resize: "data-wt-preview-resize",
  },
};

const MIN_W = 320;
const MIN_H = 240;
// 默认高度：68vh × 1.2（用户需求：高度为原来的 1.2 倍）
const DEF_H_RATIO = 0.68 * 1.2;

export function DraggableWindow({ title, badge, width = 640, onClose, search, wtPrefix = "window", children }) {
  const wt = WT[wtPrefix] ?? WT.window;
  // 初始尺寸：宽 = 调用方传入（已按 1.5 倍放大）；高 = 视口 × 0.816
  const [size, setSize] = useState(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return { w: width, h: Math.max(MIN_H, Math.round(vh * DEF_H_RATIO)) };
  });
  // 初始位置：视口正中心（用户需求）
  const [pos, setPos] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const h = Math.max(MIN_H, Math.round(vh * DEF_H_RATIO));
    return { x: Math.max(8, Math.round((vw - width) / 2)), y: Math.max(8, Math.round((vh - h) / 2)) };
  });
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  // 标题栏拖拽
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

  // 右下角 resize 拖拽
  const onResizeDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: size.w, sh: size.h };
      const move = (ev) => {
        setSize({
          w: Math.max(MIN_W, resizeRef.current.sw + (ev.clientX - resizeRef.current.sx)),
          h: Math.max(MIN_H, resizeRef.current.sh + (ev.clientY - resizeRef.current.sy)),
        });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [size],
  );

  const hasQuery = search != null && search.value.trim() !== "";
  const rootAttrs = { "data-wt-window": true };
  if (wtPrefix !== "window") rootAttrs[wt.root] = true;
  return jsx("div", {
    ...rootAttrs,
    style: {
      position: "fixed", left: pos.x, top: pos.y, width: size.w, height: size.h,
      maxWidth: "94vw", maxHeight: "92vh", minWidth: MIN_W, minHeight: MIN_H,
      display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base, #ffffff)",
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
          background: "var(--dsw-alias-bg-overlay, #ffffff)", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
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
            style: { marginLeft: "auto", background: "none", border: "none", color: "var(--dsw-alias-label-secondary, #666)", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 },
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
              style: { flex: 1, background: "var(--dsw-alias-bg-base, #ffffff)", border: "1px solid var(--dsw-alias-border-l2, #333)", borderRadius: 4, color: "var(--dsw-alias-label-primary, #1a1a1a)", padding: "3px 8px", fontSize: 12, outline: "none" },
            }),
            hasQuery && jsx("button", { type: "button", [wt.prev]: true, onClick: search.onPrev, style: BTN, children: "↑" }),
            hasQuery && jsx("button", { type: "button", [wt.next]: true, onClick: search.onNext, style: BTN, children: "↓" }),
          ],
        }),
      // 内容区（flex:1 滚动由子组件自管；此处 overflow hidden 由根容器保证）
      jsx("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }, children }),
      // 右下角 resize 把手
      jsx("div", {
        [wt.resize]: true,
        onMouseDown: onResizeDown,
        title: "拖拽调整大小",
        style: {
          position: "absolute", right: 0, bottom: 0, width: 16, height: 16,
          cursor: "nwse-resize", flexShrink: 0, zIndex: 2,
          background: "linear-gradient(135deg, transparent 50%, var(--dsw-alias-label-secondary, #888) 50%)",
          backgroundSize: "10px 10px", backgroundRepeat: "no-repeat",
          backgroundPosition: "bottom right", opacity: 0.6,
        },
      }),
    ],
  });
}
