import { jsx } from "react/jsx-runtime";
import { useState } from "react";
import { SessionList } from "./session-list.js";
import { FileTree } from "./file-tree.js";
import { Changes } from "./changes.js";

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
  const current = useSessions((s) => s.current);
  const cwd = useSessions((s) => (s.current ? s.byId[s.current]?.cwd : undefined));

  return jsx("div", {
    "data-wt-rail": true,
    style: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      display: "flex",
      zIndex: 5,
      fontSize: "13px",
      color: "var(--dsw-alias-text-primary, #ddd)",
    },
    children: [
      // 收展按钮（面板左侧窄条）
      jsx("button", {
        type: "button",
        "data-wt-toggle": true,
        "aria-label": open ? "收起工具侧边栏" : "展开工具侧边栏",
        title: open ? "收起" : "展开",
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
          padding: 0,
        },
        children: open ? "▸" : "◂",
      }),
      open &&
        jsx("div", {
          "data-wt-panel": true,
          style: {
            width: 300,
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
              children: TABS.map((t) =>
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
                  children: t.label,
                }),
              ),
            }),
            jsx("div", {
              "data-wt-tabpanel": true,
              style: { flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" },
              children:
                tab === "sessions"
                  ? jsx(SessionList, { useSessions, openSession })
                  : tab === "files"
                    ? jsx(FileTree, { key: cwd ?? "no-cwd", cwd, sessionId: current, rpc, insertIntoComposer })
                    : jsx(Changes, { cwd, sessionId: current, rpc }),
            }),
          ],
        }),
    ],
  });
}
