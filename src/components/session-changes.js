// src/components/session-changes.js —— "会话变更"页签（M6 Task 2）
// 与 git 完全解耦：本组件只调 sessionChanges.* RPC（lib/index.js 的 guardCwd 端点）。
// 结构：上方待处理区（按 turn 分组："对话 #N" + 文件条数；每条可展开 before/after
// 双栏 diff；逐条 采用/撤回，成功后本地移除 + onCountChange 回调）；
// 下方已处理历史区（分隔线以下：按 turn 分组 ≤10 对话、最近在上，action 徽标
// 已采用/已撤回 + 文件名 + handledAt 时间；清除按钮清空）。
// 操作失败（如 revert 文件写回失败）：组件内联错误提示，记录保留可重试。
// 标记：data-wt-sesschg / -turn / -item / -adopt / -revert / -diff / -history / -clear
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { relativeTime } from "../lib/git-history-client.js";

// 工具徽标配色（与 changes.js 状态色同风格）
const TOOL_COLOR = { write: "#61afef", edit: "#c678dd" };

// 按钮基础样式（同 changes.js BTN）
const BTN = {
  background: "var(--dsw-alias-bg-overlay, #ffffff)",
  border: "1px solid var(--dsw-alias-border-l2, #444)",
  borderRadius: 4,
  color: "var(--dsw-alias-label-primary, #1a1a1a)",
  cursor: "pointer",
  padding: "2px 8px",
  fontSize: 12,
  flexShrink: 0,
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// 路径拆分为 目录前缀（次要色）+ 文件名（主色）—— file-tree 风格
function splitPath(file) {
  const idx = file.lastIndexOf("/");
  if (idx === -1) return { dir: "", base: file };
  return { dir: file.slice(0, idx + 1), base: file.slice(idx + 1) };
}

// 工具徽标：write/edit
function ToolBadge({ tool }) {
  const color = TOOL_COLOR[tool] ?? "#9a9a9a";
  return jsx("span", {
    style: {
      width: 38,
      textAlign: "center",
      fontSize: 11,
      fontWeight: 700,
      color,
      border: `1px solid ${color}`,
      borderRadius: 3,
      flexShrink: 0,
    },
    children: tool,
  });
}

// 展开态 before/after 双栏对比（简单两栏 pre，不引入 diff 算法）
function DiffPane({ rec }) {
  const beforeText = rec.before === null ? "（新增文件，原本不存在）" : rec.before;
  const afterText = rec.after === null ? "（写入后读取失败）" : rec.after;
  const colStyle = {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };
  const headStyle = {
    fontSize: 11,
    color: "var(--dsw-alias-label-secondary, #666)",
    flexShrink: 0,
  };
  const preStyle = {
    margin: 0,
    padding: "6px 8px",
    background: "var(--dsw-alias-bg-overlay, #ffffff)",
    border: "1px solid var(--dsw-alias-border-l2, #333)",
    borderRadius: 4,
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: 240,
    overflow: "auto",
    fontFamily: MONO,
  };
  return jsx("div", {
    "data-wt-sesschg-diff": true,
    style: { display: "flex", gap: 8, padding: "2px 10px 8px 34px" },
    children: [
      jsx("div", { style: colStyle, children: [jsx("div", { style: headStyle, children: "Before" }), jsx("pre", { style: preStyle, children: beforeText })] }),
      jsx("div", { style: colStyle, children: [jsx("div", { style: headStyle, children: "After" }), jsx("pre", { style: preStyle, children: afterText })] }),
    ],
  });
}

// 待处理单条：展开开关 + 工具徽标 + 路径（目录前缀次要色）+ 时间 + 采用/撤回
function PendingItem({ rec, expanded, busy, onToggle, onAdopt, onRevert }) {
  const { dir, base } = splitPath(rec.file);
  const open = expanded.has(rec.callId);
  const opBusy = busy.has(rec.callId);
  const btnStyle = { ...BTN, opacity: opBusy ? 0.45 : 1, cursor: opBusy ? "default" : "pointer" };
  return jsx("div", {
    "data-wt-sesschg-item": true,
    children: [
      jsx("div", {
        role: "button",
        tabIndex: 0,
        onClick: () => onToggle(rec.callId),
        onKeyDown: (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            onToggle(rec.callId);
          }
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          cursor: "pointer",
          minHeight: 24,
        },
        children: [
          jsx("span", { style: { width: 12, flexShrink: 0, display: "inline-block", textAlign: "center", fontSize: 10 }, children: open ? "▾" : "▸" }),
          jsx(ToolBadge, { tool: rec.tool }),
          jsx("span", {
            style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", minWidth: 0 },
            title: rec.file,
            children: [
              dir !== "" && jsx("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" }, children: dir }),
              jsx("span", { style: { color: "var(--dsw-alias-label-primary, #1a1a1a)" }, children: base }),
            ],
          }),
          jsx("span", { style: { flexShrink: 0, color: "var(--dsw-alias-label-secondary, #666)", fontSize: 11 }, children: relativeTime(new Date(rec.at).toISOString()) }),
          jsx("button", {
            type: "button",
            "data-wt-sesschg-adopt": true,
            disabled: opBusy,
            onClick: (ev) => {
              ev.stopPropagation();
              onAdopt(rec);
            },
            style: { ...btnStyle, color: "#2f855a", borderColor: "var(--dsw-alias-border-l2, #444)" },
            children: "采用",
          }),
          jsx("button", {
            type: "button",
            "data-wt-sesschg-revert": true,
            disabled: opBusy,
            onClick: (ev) => {
              ev.stopPropagation();
              onRevert(rec);
            },
            style: { ...btnStyle, color: "#b7791f", borderColor: "var(--dsw-alias-border-l2, #444)" },
            children: "撤回",
          }),
        ],
      }),
      open && jsx(DiffPane, { rec }),
    ],
  });
}

// 已处理历史单条：action 徽标 + 路径 + handledAt 时间
function HistoryItem({ entry }) {
  const { dir, base } = splitPath(entry.rec.file);
  const adopted = entry.action === "adopted";
  const color = adopted ? "#7ec699" : "#e6b450";
  return jsx("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px",
      minHeight: 24,
    },
    children: [
      jsx("span", {
        style: {
          width: 44,
          textAlign: "center",
          fontSize: 11,
          fontWeight: 700,
          color,
          border: `1px solid ${color}`,
          borderRadius: 3,
          flexShrink: 0,
        },
        children: adopted ? "已采用" : "已撤回",
      }),
      jsx("span", {
        style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", minWidth: 0 },
        title: entry.rec.file,
        children: [
          dir !== "" && jsx("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" }, children: dir }),
          jsx("span", { style: { color: "var(--dsw-alias-label-primary, #1a1a1a)" }, children: base }),
        ],
      }),
      jsx("span", { style: { flexShrink: 0, color: "var(--dsw-alias-label-secondary, #666)", fontSize: 11 }, children: relativeTime(new Date(entry.handledAt).toISOString()) }),
    ],
  });
}

// 对话组头："对话 #N" + 条数（待处理/历史共用）
function TurnHeader({ turn, count }) {
  return jsx("div", {
    "data-wt-sesschg-turn": true,
    style: {
      display: "flex",
      gap: 6,
      alignItems: "center",
      padding: "6px 10px 2px",
      fontWeight: 600,
      color: "var(--dsw-alias-label-secondary, #666)",
      fontSize: 12,
    },
    children: [jsx("span", { children: `对话 #${turn}` }), jsx("span", { style: { opacity: 0.6, fontWeight: 400 }, children: `(${count})` })],
  });
}

export function SessionChanges({ cwd, sessionId, rpc, onCountChange }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]); // 待处理 Records（(turn,step) 升序，host 保证）
  const [historyItems, setHistoryItems] = useState([]); // [{rec, action, handledAt}]（handledAt 降序）
  const [expanded, setExpanded] = useState(() => new Set()); // 展开 diff 的 callId
  const [busy, setBusy] = useState(() => new Set()); // 操作中的 callId
  const [clearing, setClearing] = useState(false);
  const [opError, setOpError] = useState(null); // 操作失败内联提示（不影响列表加载态）
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // 只重拉历史（adopt/revert 成功后将记录刷入已处理区）
  const loadHistory = useCallback(() => {
    return callRpc(rpc, "sessionChanges.history", { cwd, sessionId })
      .then((value) => setHistoryItems(value.items ?? []))
      .catch(() => {
        /* 历史刷新失败不打断主流程 */
      });
  }, [cwd, rpc, sessionId]);

  // 并行加载：pending + history
  const load = useCallback(() => {
    if (!cwd) {
      setStatus("ready");
      setItems([]);
      setHistoryItems([]);
      setError(null);
      setOpError(null);
      onCountChange?.(0);
      return;
    }
    setStatus("loading");
    setError(null);
    setOpError(null);
    Promise.all([
      callRpc(rpc, "sessionChanges.list", { cwd, sessionId }),
      callRpc(rpc, "sessionChanges.history", { cwd, sessionId }),
    ])
      .then(([listVal, histVal]) => {
        const list = listVal.items ?? [];
        setItems(list);
        setHistoryItems(histVal.items ?? []);
        setStatus("ready");
        onCountChange?.(list.length); // 文件条数（非对话数）
      })
      .catch((err) => {
        setStatus("error");
        setError(String(err?.message ?? err));
      });
  }, [cwd, rpc, sessionId, onCountChange]);

  // 挂载 + cwd/sessionId 变化时加载
  useEffect(() => {
    load();
  }, [load]);

  // 待处理按 turn 分组（升序：turn 小在前）
  const pendingGroups = useMemo(() => {
    const byTurn = new Map();
    for (const rec of items) {
      if (!byTurn.has(rec.turn)) byTurn.set(rec.turn, []);
      byTurn.get(rec.turn).push(rec);
    }
    return [...byTurn.entries()].sort((a, b) => a[0] - b[0]);
  }, [items]);

  // 历史按 turn 分组（保持 handledAt 降序 → 最近对话在上；host 已截断 ≤10 对话）
  const historyGroups = useMemo(() => {
    const order = [];
    const byTurn = new Map();
    for (const entry of historyItems) {
      if (!byTurn.has(entry.rec.turn)) {
        byTurn.set(entry.rec.turn, []);
        order.push(entry.rec.turn);
      }
      byTurn.get(entry.rec.turn).push(entry);
    }
    return order.map((turn) => [turn, byTurn.get(turn)]);
  }, [historyItems]);

  const toggleExpanded = useCallback((callId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }, []);

  // 本地移除一条 + 更新计数（文件条数）
  const removeLocal = useCallback(
    (callId) => {
      const next = itemsRef.current.filter((r) => r.callId !== callId);
      itemsRef.current = next;
      setItems(next);
      onCountChange?.(next.length);
    },
    [onCountChange],
  );

  const runOp = useCallback(
    (rec, endpoint) => {
      setOpError(null);
      setBusy((prev) => new Set(prev).add(rec.callId));
      callRpc(rpc, endpoint, { cwd, sessionId, callId: rec.callId })
        .then(() => {
          removeLocal(rec.callId);
          return loadHistory(); // 采用/撤回成功后刷入已处理区
        })
        .catch((err) => setOpError(String(err?.message ?? err)))
        .finally(() => {
          setBusy((prev) => {
            const next = new Set(prev);
            next.delete(rec.callId);
            return next;
          });
        });
    },
    [cwd, rpc, sessionId, removeLocal, loadHistory],
  );

  const onAdopt = useCallback((rec) => runOp(rec, "sessionChanges.adopt"), [runOp]);
  const onRevert = useCallback((rec) => runOp(rec, "sessionChanges.revert"), [runOp]);

  const onClear = useCallback(() => {
    setOpError(null);
    setClearing(true);
    callRpc(rpc, "sessionChanges.clearHistory", { cwd, sessionId })
      .then(() => setHistoryItems([]))
      .catch((err) => setOpError(String(err?.message ?? err)))
      .finally(() => setClearing(false));
  }, [cwd, rpc, sessionId]);

  // ── 渲染 ──
  let pendingSection;
  if (status === "loading") {
    pendingSection = jsx("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-label-secondary, #666)" }, children: "加载中…" });
  } else if (status === "error") {
    pendingSection = jsx("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: error });
  } else if (items.length === 0) {
    pendingSection = jsx("div", { style: { padding: 12, color: "var(--dsw-alias-label-secondary, #666)" }, children: "没有待处理的会话变更" });
  } else {
    pendingSection = jsx("div", {
      children: pendingGroups.map(([turn, recs]) =>
        jsx("div", {
          key: `p-${turn}`,
          children: [
            jsx(TurnHeader, { turn, count: recs.length }),
            recs.map((rec) =>
              jsx(PendingItem, {
                key: rec.callId,
                rec,
                expanded,
                busy,
                onToggle: toggleExpanded,
                onAdopt,
                onRevert,
              }),
            ),
          ],
        }),
      ),
    });
  }

  const historySection = jsx("div", {
    "data-wt-sesschg-history": true,
    style: {
      borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
      paddingTop: 4,
      marginTop: 4,
    },
    children: [
      jsx("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          flexShrink: 0,
          color: "var(--dsw-alias-label-secondary, #666)",
          fontSize: 12,
        },
        children: [
          jsx("span", { style: { flex: 1 }, children: "已处理历史" }),
          jsx("button", {
            type: "button",
            "data-wt-sesschg-clear": true,
            disabled: clearing || historyItems.length === 0,
            onClick: onClear,
            style: {
              ...BTN,
              opacity: clearing || historyItems.length === 0 ? 0.45 : 1,
              cursor: clearing || historyItems.length === 0 ? "default" : "pointer",
            },
            children: "清除",
          }),
        ],
      }),
      historyItems.length === 0
        ? jsx("div", { style: { padding: "2px 10px 10px", color: "var(--dsw-alias-label-secondary, #666)" }, children: "暂无已处理记录" })
        : jsx("div", {
            children: historyGroups.map(([turn, entries]) =>
              jsx("div", {
                key: `h-${turn}`,
                children: [
                  jsx(TurnHeader, { turn, count: entries.length }),
                  entries.map((entry) => jsx(HistoryItem, { key: entry.rec.callId, entry })),
                ],
              }),
            ),
          }),
    ],
  });

  return jsx("div", {
    "data-wt-sesschg": true,
    style: { display: "flex", flexDirection: "column", minHeight: 0 },
    children: [
      opError &&
        jsx("div", {
          style: {
            padding: "4px 8px",
            color: "#e06c75",
            fontSize: 12,
            flexShrink: 0,
            background: "rgba(224,108,117,0.08)",
            borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
          },
          children: opError,
        }),
      jsx("div", { style: { flex: 1, minHeight: 0 }, children: pendingSection }),
      historySection,
    ],
  });
}
