// src/components/session-changes.js —— "变更"页签（M6 Task 2）
// 与 git 完全解耦：本组件只调 sessionChanges.* RPC（lib/index.js 的 guardCwd 端点）。
// 结构：上方待处理区（按 turn 分组："对话 #N" + 文件条数；组头带 全部采用/全部撤回；
// 点击单行打开 git 同款 diff 弹窗 —— DiffWindow 壳 + DiffLines 渲染 before→after
// （diff-text.js 行级 diff，与 git parseDiff 同形状）；逐条 采用/撤回 或整组操作，
// 成功后本地移除 + onCountChange 回调）；
// 下方已处理历史区（分隔线以下：按 turn 分组 ≤10 对话、最近在上，action 徽标
// 已采用/已撤回 + 文件名 + handledAt 时间；点击行同样打开 diff 弹窗；清除按钮清空）。
// 操作失败（如 revert 文件写回失败）：组件内联错误提示，记录保留可重试。
// 标记：data-wt-sesschg / -turn / -item / -adopt / -revert / -adopt-all / -revert-all / -history / -clear
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { relativeTime } from "../lib/git-history-client.js";
import { diffText } from "../lib/diff-text.js";
import { DiffWindow } from "./diff-window.js";

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

// 待处理单条：工具徽标 + 路径（目录前缀次要色）+ 时间 + 采用/撤回。
// 点击整行打开 git 同款 diff 弹窗（DiffWindow/DiffLines 渲染 before→after 差异）——
// 与「变更」页签点击文件打开的弹窗及其中 diff 文本格式完全一致。
function PendingItem({ rec, busy, onView, onAdopt, onRevert }) {
  const { dir, base } = splitPath(rec.file);
  const opBusy = busy.has(rec.callId);
  const btnStyle = { ...BTN, opacity: opBusy ? 0.45 : 1, cursor: opBusy ? "default" : "pointer" };
  return jsx("div", {
    "data-wt-sesschg-item": true,
    children: [
      jsx("div", {
        role: "button",
        tabIndex: 0,
        title: "点击查看变更",
        onClick: () => onView(rec),
        onKeyDown: (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            onView(rec);
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
          jsx("span", { style: { width: 12, flexShrink: 0, display: "inline-block", textAlign: "center", fontSize: 10 }, children: "▸" }),
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
            style: { ...btnStyle, color: "var(--dsw-alias-state-success-primary, #22c55e)", borderColor: "var(--dsw-alias-border-l2, #444)" },
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
            style: { ...btnStyle, color: "var(--dsw-alias-state-warn-primary, #f59e0b)", borderColor: "var(--dsw-alias-border-l2, #444)" },
            children: "撤回",
          }),
        ],
      }),
    ],
  });
}

// 已处理历史单条：action 徽标 + 路径 + handledAt 时间；点击行打开 diff 弹窗（与待处理一致）
function HistoryItem({ entry, onView }) {
  const { dir, base } = splitPath(entry.rec.file);
  const adopted = entry.action === "adopted";
  const color = adopted ? "#7ec699" : "#e6b450";
  return jsx("div", {
    role: "button",
    tabIndex: 0,
    title: "点击查看变更",
    onClick: () => onView(entry.rec),
    onKeyDown: (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        onView(entry.rec);
      }
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px",
      minHeight: 24,
      cursor: "pointer",
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

// 对话组头："对话 #N" + 条数（待处理/历史共用）；actions（如全部采用/全部撤回）渲染到行尾
function TurnHeader({ turn, count, actions }) {
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
    children: [
      jsx("span", { children: `对话 #${turn}` }),
      jsx("span", { style: { opacity: 0.6, fontWeight: 400 }, children: `(${count})` }),
      actions &&
        jsx("span", { style: { marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 }, children: actions }),
    ],
  });
}

export function SessionChanges({ cwd, sessionId, rpc, onCountChange }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]); // 待处理 Records（(turn,step) 升序，host 保证）
  const [historyItems, setHistoryItems] = useState([]); // [{rec, action, handledAt}]（handledAt 降序）
  const [viewRec, setViewRec] = useState(null); // 打开 diff 弹窗的 rec
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

  // 打开/关闭 diff 弹窗（git 变更页签同款：点击行打开，Esc/✕ 关闭）
  const openView = useCallback((rec) => setViewRec(rec), []);
  const closeView = useCallback(() => setViewRec(null), []);

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

  // 整组移除（全部采用/全部撤回成功后清掉该对话的 pending 记录）+ 更新计数
  const removeLocalAll = useCallback(
    (ids) => {
      const idSet = new Set(ids);
      const next = itemsRef.current.filter((r) => !idSet.has(r.callId));
      itemsRef.current = next;
      setItems(next);
      onCountChange?.(next.length);
    },
    [onCountChange],
  );

  // 整组操作：该对话内各条按 callId 并发执行（host 端独立），全部成功才整组移除并刷历史
  const runTurnOp = useCallback(
    (turn, endpoint) => {
      const recs = itemsRef.current.filter((r) => r.turn === turn);
      if (recs.length === 0) return;
      const ids = recs.map((r) => r.callId);
      setOpError(null);
      setBusy((prev) => new Set([...prev, ...ids]));
      Promise.all(recs.map((rec) => callRpc(rpc, endpoint, { cwd, sessionId, callId: rec.callId })))
        .then(() => {
          removeLocalAll(ids);
          return loadHistory();
        })
        .catch((err) => setOpError(String(err?.message ?? err)))
        .finally(() => {
          setBusy((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
          });
        });
    },
    [cwd, rpc, sessionId, removeLocalAll, loadHistory],
  );

  const onAdoptAll = useCallback((turn) => runTurnOp(turn, "sessionChanges.adopt"), [runTurnOp]);
  const onRevertAll = useCallback((turn) => runTurnOp(turn, "sessionChanges.revert"), [runTurnOp]);

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
      children: pendingGroups.map(([turn, recs]) => {
        const anyBusy = recs.some((r) => busy.has(r.callId));
        const groupBtn = { ...BTN, opacity: anyBusy ? 0.45 : 1, cursor: anyBusy ? "default" : "pointer" };
        return jsx("div", {
          key: `p-${turn}`,
          children: [
            jsx(TurnHeader, {
              turn,
              count: recs.length,
              actions: [
                jsx("button", {
                  type: "button",
                  "data-wt-sesschg-adopt-all": true,
                  disabled: anyBusy,
                  title: "采用该对话的全部修改",
                  onClick: () => onAdoptAll(turn),
                  style: { ...groupBtn, color: "var(--dsw-alias-state-success-primary, #22c55e)", borderColor: "var(--dsw-alias-border-l2, #444)" },
                  children: "全部采用",
                }),
                jsx("button", {
                  type: "button",
                  "data-wt-sesschg-revert-all": true,
                  disabled: anyBusy,
                  title: "撤回该对话的全部修改",
                  onClick: () => onRevertAll(turn),
                  style: { ...groupBtn, color: "var(--dsw-alias-state-warn-primary, #f59e0b)", borderColor: "var(--dsw-alias-border-l2, #444)" },
                  children: "全部撤回",
                }),
              ],
            }),
            recs.map((rec) =>
              jsx(PendingItem, {
                key: rec.callId,
                rec,
                busy,
                onView: openView,
                onAdopt,
                onRevert,
              }),
            ),
          ],
        });
      }),
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
                  entries.map((entry) => jsx(HistoryItem, { key: entry.rec.callId, entry, onView: openView })),
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
      // diff 弹窗（M6 改版：与 git 变更页签一致 —— 点击行打开，DiffLines 渲染文本）
      viewRec &&
        jsx(DiffWindow, {
          key: viewRec.callId,
          file: viewRec.file,
          badge: viewRec.tool,
          diffLines: diffText(viewRec.before, viewRec.after),
          onClose: closeView,
        }),
    ],
  });
}
