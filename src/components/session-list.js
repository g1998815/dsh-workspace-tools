import { jsx } from "react/jsx-runtime";

// M2 最小会话列表：标题 + 当前标记 + 点击切换（遮蔽 shipped browser 后的可用落点；
// 完整 browser 功能不在 M2 范围）。
export function SessionList({ useSessions, openSession }) {
  const { ids, byId, current } = useSessions((s) => s);
  return jsx("div", {
    "data-wt-sessions": true,
    children: ids.map((id) => {
      const s = byId[id];
      const active = id === current;
      return jsx("div", {
        key: id,
        role: "button",
        tabIndex: 0,
        "data-current": active || undefined,
        onClick: () => openSession(id),
        onKeyDown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openSession(id);
          }
        },
        style: {
          padding: "6px 10px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: active ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
        },
        children: s?.displayTitle ?? id,
      });
    }),
  });
}
