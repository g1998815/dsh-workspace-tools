// src/components/console.js —— 底部控制台面板：多标签 PTY（xterm + WS 输出 + RPC 输入）
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import xtermCss from "@xterm/xterm/css/xterm.css";
import { callRpc } from "../lib/rpc.js";
import { WS_PATH } from "../../lib/constants.js";

// xterm css 注入（一次性）。防御式守卫：真实浏览器 document.getElementById 一定存在；
// 但 client.js 的加载契约回归测试（test/client-bundle.test.js）在 vm 沙箱里 materialize 工厂，
// 其 document 只有 createElement/head，没有 getElementById/appendChild —— 此处短路即可（测试不需要 css）。
if (typeof document !== "undefined" && typeof document.getElementById === "function" && !document.getElementById("dshwt-xterm-css")) {
  const s = document.createElement("style");
  s.id = "dshwt-xterm-css";
  s.textContent = xtermCss;
  document.head.appendChild(s);
}

const MIN_H = 120;
const MAX_H = 480;
const ROWS = 40;
const COLS = 120;

// 设计修正（Step 2 注）：面板**常驻渲染**，open 只控制 style.display（展开 flex / 收起 none），
// 收起不卸载组件、不 kill 会话——标签与 PTY 会话保留，重开立即恢复；组件卸载时才 dispose 全部。
export function ConsolePanel({ cwd, sessionId, rpc, open, onToggle }) {
  const [height, setHeight] = useState(280);
  const [tabs, setTabs] = useState([]); // [{id, ttyId, status: "running"|"exited", title}]
  const [active, setActive] = useState(null); // tab id
  const [panelError, setPanelError] = useState(null);
  const mountRefs = useRef({}); // tabId -> {term, fit, ws}
  const seq = useRef(0);

  // 新建标签
  const addTab = useCallback(() => {
    if (!cwd) { setPanelError("当前会话没有工作目录"); return; }
    const id = `c${++seq.current}`;
    const tab = { id, ttyId: null, status: "starting", title: `终端 ${tabs.length + 1}` };
    setTabs((prev) => [...prev, tab]);
    setActive(id);
    setPanelError(null);
    callRpc(rpc, "console.create", { cwd, sessionId })
      .then((value) => {
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ttyId: value.sessionId, status: "running" } : t)));
      })
      .catch((err) => {
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, status: "exited" } : t)));
        setPanelError(String(err?.message ?? err)); // Windows 等：spawnTerminal 不支持 → 结构化错误
      });
  }, [cwd, rpc, sessionId, tabs.length]);

  // 挂载 effect：增量挂载每个 running 标签的 xterm + WS。
  // 注意与 brief 源不同：这里**不返回清理函数**（React 会在每次 tabs 变化重跑 effect 前执行上次的清理，
  // 若清理 dispose 全部挂载，则每次新增标签都会销毁并重挂所有既有终端，丢失滚动与 WS 会话）。
  // 全部挂载的 dispose 统一放在下方的卸载 effect（仅在组件真正卸载时执行一次）。
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.status !== "running" || !tab.ttyId) continue;
      if (mountRefs.current[tab.id]) continue; // 已挂
      const el = document.getElementById(`dshwt-term-${tab.id}`);
      if (!el) continue;
      const term = new Terminal({ rows: ROWS, cols: COLS, fontSize: 12, theme: { background: "#141414" } });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      try { fit.fit(); } catch { /* 忽略 */ }
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        // 浏览器 WebSocket 发送自动 masked ✓；首帧带 ttyId
        ws.send(JSON.stringify({ sessionId: tab.ttyId }));
      };
      ws.onmessage = (ev) => {
        const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
        try {
          const msg = JSON.parse(text);
          if (msg.type === "exit") {
            setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, status: "exited" } : t)));
            term.write("\r\n\x1b[31m[会话已退出]\x1b[0m\r\n");
            return;
          }
        } catch { /* 非 JSON = PTY 输出 */ }
        term.write(text);
      };
      ws.onclose = () => {
        setTabs((prev) => prev.map((t) => (t.id === tab.id && t.status === "running" ? { ...t, status: "exited" } : t)));
      };
      term.onData((data) => {
        // console.write 的 payload 键是 sessionId（ttyId 复用同键），不传 cwd（端点只读 sessions Map）
        if (tab.ttyId) callRpc(rpc, "console.write", { sessionId: tab.ttyId, data }).catch(() => {});
      });
      mountRefs.current[tab.id] = { term, fit, ws };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, rpc]);

  // 卸载清理：仅在组件真正卸载时执行一次（dispose 全部 term/ws）
  useEffect(() => {
    return () => {
      for (const [id, m] of Object.entries(mountRefs.current)) {
        m.ws?.close();
        m.term?.dispose();
        delete mountRefs.current[id];
      }
    };
  }, []);

  // 重新展开或切换标签时重算尺寸（收起 display:none 期间尺寸为 0；隐藏标签切回时同样需要 re-fit）
  useEffect(() => {
    if (!open || typeof requestAnimationFrame === "undefined") return;
    const raf = requestAnimationFrame(() => {
      for (const [id, m] of Object.entries(mountRefs.current)) {
        try { m.fit?.fit(); } catch { /* 忽略 */ }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, active]);

  // 关闭标签
  const closeTab = useCallback((tab) => {
    if (tab.ttyId) {
      callRpc(rpc, "console.kill", { sessionId: tab.ttyId }).catch(() => {});
    }
    mountRefs.current[tab.id]?.ws?.close();
    mountRefs.current[tab.id]?.term?.dispose();
    delete mountRefs.current[tab.id];
    setTabs((prev) => prev.filter((t) => t.id !== tab.id));
    setActive((prev) => (prev === tab.id ? null : prev));
  }, [rpc]);

  // 重开：新建标签并激活（保留 tab 结构——直接 addTab）
  const reopen = useCallback(() => addTab(), [addTab]);

  // 拖高把手
  const onDragDown = useCallback((e) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev) => setHeight(Math.min(MAX_H, Math.max(MIN_H, startH + (startY - ev.clientY))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [height]);

  return jsx("div", {
    "data-wt-console": true,
    style: {
      position: "fixed", left: 0, right: 0, bottom: 0, height, zIndex: 12,
      background: "#141414", borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
      display: open ? "flex" : "none", // 常驻渲染：收起仅隐藏，不卸载
      flexDirection: "column",
    },
    children: [
      jsx("div", { "data-wt-console-drag": true, onMouseDown: onDragDown, style: { height: 4, cursor: "row-resize", flexShrink: 0 } }),
      jsx("div", { "data-wt-console-bar": true, style: { display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)", flexShrink: 0 }, children: [
        jsx("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-text-secondary, #999)" }, children: "控制台" }),
        jsx("div", { style: { display: "flex", gap: 4, flex: 1, overflow: "auto" }, children: tabs.map((t) =>
          jsx("span", { key: t.id, "data-wt-console-tab": true, "data-active": active === t.id || undefined, onClick: () => setActive(t.id), style: { fontSize: 12, padding: "2px 10px", borderRadius: 4, cursor: "pointer", background: active === t.id ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.08))" : "none", display: "flex", gap: 6, alignItems: "center" }, children: [
            t.title,
            t.status === "exited" && jsx("span", { style: { color: "#e06c75", fontSize: 10 }, children: "已退出" }),
            t.status === "exited" && jsx("span", { role: "button", "data-wt-console-reopen": true, onClick: (e) => { e.stopPropagation(); reopen(); }, style: { color: "#98c379", fontSize: 10, cursor: "pointer" }, children: "重开" }),
            jsx("span", { role: "button", "data-wt-console-close": true, onClick: (e) => { e.stopPropagation(); closeTab(t); }, style: { cursor: "pointer", color: "var(--dsw-alias-text-secondary, #999)" }, children: "✕" }),
          ]}),
        )}) ,
        jsx("button", { type: "button", "data-wt-console-new": true, onClick: addTab, style: { background: "none", border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 4, color: "var(--dsw-alias-text-secondary, #999)", cursor: "pointer", fontSize: 12, padding: "0 8px" }, children: "+" }),
        jsx("button", { type: "button", "data-wt-console-collapse": true, onClick: onToggle, style: { background: "none", border: "none", cursor: "pointer", color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12 }, children: "▾" }),
      ] }),
      panelError && jsx("div", { "data-wt-console-error": true, style: { padding: "4px 10px", color: "#e06c75", fontSize: 12, borderBottom: "1px solid var(--dsw-alias-border-l2, #333)" }, children: panelError }),
      jsx("div", { style: { flex: 1, minHeight: 0, position: "relative", display: "flex" }, children: tabs.map((t) =>
        jsx("div", {
          key: t.id,
          id: `dshwt-term-${t.id}`,
          "data-wt-console-term": true,
          style: { flex: 1, minWidth: 0, display: active === t.id ? "block" : "none", position: "relative", padding: 4 },
        }),
      ) }),
      tabs.length === 0 && jsx("div", { style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dsw-alias-text-secondary, #666)", fontSize: 12 }, children: "点击 + 新建终端" }),
    ],
  });
}
