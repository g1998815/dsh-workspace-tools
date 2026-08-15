import { jsx } from "react/jsx-runtime";
import { useState } from "react";
import { SessionList } from "./session-list.js";
import { FileTree } from "./file-tree.js";

const TABS = [
  { id: "sessions", label: "会话" },
  { id: "files", label: "文件" },
  { id: "changes", label: "变更" },
];

// 三段切换条（会话/文件/变更）——页签内容自绘自管理（无框架 tab 语义，M1 §12 定稿）。
// 注册进 sidebar.workspaces（root scope）：标准 prop 只有 useSessions/useWorkspaces，
// 其余经 register 的 inject 传入（rpc/openSession/insertIntoComposer）。
export function WorkspaceBrowser({ useSessions, rpc, openSession, insertIntoComposer }) {
  const [tab, setTab] = useState("files");
  const current = useSessions((s) => s.current);
  const cwd = useSessions((s) => (s.current ? s.byId[s.current]?.cwd : undefined));

  return jsx("div", {
    "data-wt-sidebar": true,
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      fontSize: "13px",
      color: "var(--dsw-alias-text-primary, #ddd)",
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
              : jsx("div", { "data-wt-changes-placeholder": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "变更列表将在 M3 提供" }),
      }),
    ],
  });
}
