import { jsx } from "react/jsx-runtime";
import { useCallback, useState } from "react";
import { SessionList } from "./session-list.js";
import { FileTree } from "./file-tree.js";
import { Changes } from "./changes.js";
import { ConsolePanel } from "./console.js";

// 页签顺序（2026-08-15 用户定）：文件 → 变更 → 会话（会话放最后）
const TABS = [
  { id: "files", label: "文件" },
  { id: "changes", label: "变更" },
  { id: "sessions", label: "会话" },
];

// 右侧独立侧边栏（2026-08-15 用户要求改版）：
// 注册进 shell.overlay（list 孔 / root scope，layout 的浮层，z-index 20、inset 0、子元素可交互），
// 不再遮蔽左侧 sidebar.workspaces 的 shipped 工作区浏览器（恢复原样）。
// 面板 fixed 在右缘，可点击收起/展开（收起后仅剩按钮条）。
export function RightSidebar({ useSessions, rpc, openSession, insertIntoComposer }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("files");
  const [railW, setRailW] = useState(300);
  const [changeCount, setChangeCount] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const current = useSessions((s) => s.current);
  const cwd = useSessions((s) => (s.current ? s.byId[s.current]?.cwd : undefined));

  // rail 左缘拖拽改宽度（clamp 200–600）
  const onResizeDown = useCallback((e) => {
    const move = (ev) => setRailW(Math.min(600, Math.max(200, window.innerWidth - ev.clientX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  // M5：收起态四图标（文件/变更/会话/终端）→ 点击展开侧边栏并定位到对应内容
  const iconTab = useCallback((id) => {
    setOpen(true);
    setTab(id);
  }, []);

  return jsx("div", {
    "data-wt-rail": true,
    "data-collapsed": open ? undefined : true,
    style: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: open ? railW : 56, // 收起时：56px 窄 rail（同左侧边栏收起样式，M5）
      display: "flex",
      zIndex: 5,
      fontSize: "13px",
      color: "var(--dsw-alias-text-primary, #ddd)",
    },
    children: [
      // ── 展开态 ──
      open && jsx("div", {
        "data-wt-resize": true,
        onMouseDown: onResizeDown,
        title: "拖拽调整宽度",
        style: {
          width: 4,
          flexShrink: 0,
          cursor: "col-resize",
          background: "var(--dsw-alias-bg-float, #1f1f1f)",
          borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
        },
      }),
      open && jsx("button", {
        type: "button",
        "data-wt-toggle": true,
        "aria-label": "收起工具侧边栏",
        title: "收起",
        onClick: () => setOpen(false),
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
          padding: 0,
        },
        children: "▸",
      }),
      open &&
        jsx("div", {
          "data-wt-panel": true,
          style: {
            flex: 1,
            minWidth: 0,
            background: "var(--dsw-alias-bg-base, #1a1a1a)",
            borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
          },
          children: [
            jsx("div", {
              "data-wt-tabs": true,
              style: {
                display: "flex",
                borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
                flexShrink: 0,
              },
              children: [
                TABS.map((t) =>
                  jsx("button", {
                    key: t.id,
                    type: "button",
                    onClick: () => setTab(t.id),
                    "data-active": tab === t.id || undefined,
                    style: {
                      flex: 1,
                      padding: "8px 4px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: tab === t.id ? "var(--dsw-alias-text-primary, #fff)" : "var(--dsw-alias-text-secondary, #999)",
                      borderBottom: tab === t.id ? "2px solid var(--dsw-alias-accent, #4f8cff)" : "2px solid transparent",
                    },
                    children: t.id === "changes" && changeCount > 0 ? `变更 ${changeCount}` : t.label,
                  }),
                ),
                // 控制台开关（M4）：固定在页签条右端；面板本身 fixed 于底部
                jsx("button", {
                  type: "button",
                  "data-wt-console-toggle": true,
                  "data-active": consoleOpen || undefined,
                  title: consoleOpen ? "收起控制台" : "展开控制台",
                  onClick: () => setConsoleOpen((v) => !v),
                  style: {
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
                    cursor: "pointer",
                    fontSize: "12px",
                    color: consoleOpen ? "var(--dsw-alias-text-primary, #fff)" : "var(--dsw-alias-text-secondary, #999)",
                    borderBottom: consoleOpen ? "2px solid var(--dsw-alias-accent, #4f8cff)" : "2px solid transparent",
                  },
                  children: "终端",
                }),
              ],
            }),
            jsx("div", {
              "data-wt-tabpanel": true,
              style: { flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" },
              children:
                tab === "sessions"
                  ? jsx(SessionList, { useSessions, openSession })
                  : tab === "files"
                    ? jsx(FileTree, { key: cwd ?? "no-cwd", cwd, sessionId: current, rpc, insertIntoComposer })
                    : jsx(Changes, { cwd, sessionId: current, rpc, onCountChange: setChangeCount }),
            }),
          ],
        }),
      // ── 收起态：56px 窄 rail，竖排四图标（同左侧边栏收起样式，M5）──
      !open &&
        jsx("div", {
          "data-wt-rail-icons": true,
          style: {
            width: 56,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 6,
            gap: 4,
            background: "var(--dsw-alias-bg-float, #1f1f1f)",
            borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
          },
          children: [
            jsx("button", {
              type: "button",
              "data-wt-icon": "files",
              title: "文件",
              onClick: () => iconTab("files"),
              style: { width: 36, height: 36, background: "none", border: "none", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" },
              children: "📁",
            }),
            jsx("button", {
              type: "button",
              "data-wt-icon": "changes",
              title: "变更",
              onClick: () => iconTab("changes"),
              style: { width: 36, height: 36, background: "none", border: "none", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" },
              children: "🔀",
            }),
            jsx("button", {
              type: "button",
              "data-wt-icon": "sessions",
              title: "会话",
              onClick: () => iconTab("sessions"),
              style: { width: 36, height: 36, background: "none", border: "none", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" },
              children: "💬",
            }),
            jsx("button", {
              type: "button",
              "data-wt-icon": "console",
              title: "终端",
              "data-active": consoleOpen || undefined,
              onClick: () => { setOpen(true); setConsoleOpen(true); },
              style: { width: 36, height: 36, background: "none", border: "none", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" },
              children: "🖥️",
            }),
          ],
        }),
      // 控制台面板（M4）：**常驻渲染**（不条件卸载），open 只控制 display——收起不丢会话。
      // 面板 fixed 于视口底部，渲染在 rail 内无妨（fixed 脱离定位）。
      jsx(ConsolePanel, { cwd, sessionId: current, rpc, open: consoleOpen, onToggle: () => setConsoleOpen(false) }),
    ],
  });
}
