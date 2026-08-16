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

// ── 主题（M5-W 修复，2026-08-16）：xterm 配色跟随 DSH 主题 ──────────────
// DSH 主题 token（dsh-client-ui-theme/design-platform.css）：light 定义在 body，
// dark 覆盖在 body[data-ds-dark-theme]；核心变量 --dsw-alias-bg-base（背景）、
// --dsw-alias-label-primary（前景）、--dsw-alias-brand-primary-new-colorprimary-new-color（品牌蓝）。
// 这里在渲染时读 getComputedStyle 构造 xterm theme，并在 body 属性变化时热更新。
const LIGHT_ANSI = {
  black: "#1a1a1a", red: "#cd3131", green: "#0c7c3d", yellow: "#9e6a03",
  blue: "#0451a5", magenta: "#bc05bc", cyan: "#0598bc", white: "#555555",
  brightBlack: "#666666", brightRed: "#cd3131", brightGreen: "#0c7c3d",
  brightYellow: "#9e6a03", brightBlue: "#0451a5", brightMagenta: "#bc05bc",
  brightCyan: "#0598bc", brightWhite: "#1a1a1a",
};
const DARK_ANSI = {
  black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#c4a000",
  blue: "#3465a4", magenta: "#75507b", cyan: "#06989a", white: "#d3d7cf",
  brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#8ae234", brightYellow: "#fce94f",
  brightBlue: "#729fcf", brightMagenta: "#ad7fa8", brightCyan: "#34e2e2", brightWhite: "#eeeeec",
};

function readCssVar(name, fallback) {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name)?.trim();
  return v || fallback;
}

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(65, 118, 230, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// 构造 xterm theme：背景/前景/cursor 取 DSH 变量，ANSI 16 色按明暗主题选配套
export function buildXtermTheme() {
  const dark = typeof document !== "undefined" && document.body?.hasAttribute("data-ds-dark-theme");
  const bg = readCssVar("--dsw-alias-bg-base", dark ? "#141414" : "#ffffff");
  const fg = readCssVar("--dsw-alias-label-primary", dark ? "#e6e6e6" : "#1a1a1a");
  const accent = readCssVar("--dsw-alias-brand-primary-new-colorprimary-new-color", "#4176e6");
  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: hexToRgba(accent, 0.28),
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
  };
}

// 设计修正（Step 2 注）：面板**常驻渲染**，open 只控制 style.display（展开 flex / 收起 none），
// 收起不卸载组件、不 kill 会话——标签与 PTY 会话保留，重开立即恢复；组件卸载时才 dispose 全部。
export function ConsolePanel({ cwd, sessionId, rpc, open, onToggle }) {
  const [height, setHeight] = useState(280);
  const [tabs, setTabs] = useState([]); // [{id, ttyId, status: "running"|"exited", title}]
  const [active, setActive] = useState(null); // tab id
  const [panelError, setPanelError] = useState(null);
  const mountRefs = useRef({}); // tabId -> {term, fit, ws}
  const cancelledRef = useRef(new Set()); // 关闭时 create 未 resolve 的 tabId（resolve 后补 kill，M4-A6）
  const seq = useRef(0);

  // 新建标签
  const addTab = useCallback(() => {
    if (!cwd) { setPanelError("当前会话没有工作目录"); return; }
    const id = `c${++seq.current}`;
    const tab = { id, ttyId: null, status: "starting", title: `终端 ${seq.current}` };
    setTabs((prev) => [...prev, tab]);
    setActive(id);
    setPanelError(null);
    callRpc(rpc, "console.create", { cwd, sessionId, rows: ROWS, cols: COLS })
      .then((value) => {
        if (cancelledRef.current.has(id)) {
          // 标签在 create resolve 前被关闭：补 kill，避免孤儿会话
          cancelledRef.current.delete(id);
          callRpc(rpc, "console.kill", { sessionId: value.sessionId }).catch(() => {});
          return;
        }
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ttyId: value.sessionId, status: "running" } : t)));
      })
      .catch((err) => {
        if (cancelledRef.current.has(id)) { cancelledRef.current.delete(id); return; }
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, status: "exited" } : t)));
        setPanelError(String(err?.message ?? err)); // Windows 等：spawnTerminal 不支持 → 结构化错误
      });
  }, [cwd, rpc, sessionId]);

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
      const term = new Terminal({ rows: ROWS, cols: COLS, fontSize: 12, theme: buildXtermTheme() });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      // M5-W：resize 同步必须先于 fit 注册——fit.fit() 会触发首个 resize 事件，
      // 若 onResize 在其后才注册，事件丢失 → PTY 停留在 spawn 尺寸（40×120）而 xterm
      // 已 fit 到实际尺寸，PSReadLine 按错误行列重绘（历史导航不自动清除、输入拼接）。
      term.onResize(({ cols, rows }) => {
        if (tab.ttyId) callRpc(rpc, "console.resize", { sessionId: tab.ttyId, cols, rows }).catch(() => {});
      });
      try { fit.fit(); } catch { /* 忽略 */ }
      // fit 后主动同步一次当前尺寸（覆盖首个 resize 事件已在注册前触发的情形）
      if (tab.ttyId) {
        callRpc(rpc, "console.resize", { sessionId: tab.ttyId, cols: term.cols, rows: term.rows }).catch(() => {});
      }
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        // 浏览器 WebSocket 发送自动 masked ✓；首帧带 ttyId
        ws.send(JSON.stringify({ sessionId: tab.ttyId }));
      };
      ws.onmessage = (ev) => {
        if (!mountRefs.current[tab.id]) return; // 已关闭/dispose（M4-A7：write-after-dispose 防御）
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
      // M5-W：xterm 实际尺寸（fit 后）同步给 PTY——PSReadLine 按真实行列重绘，
      // 修复历史导航（↑/↓）时重绘错位/不自动清除。POSIX 端无 resize API 时静默忽略。
      term.onResize(({ cols, rows }) => {
        if (tab.ttyId) callRpc(rpc, "console.resize", { sessionId: tab.ttyId, cols, rows }).catch(() => {});
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

  // 主题跟随（M5-W 修复）：DSH 主题切换（body[data-ds-dark-theme]）时热更新所有 xterm
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const update = () => {
      const theme = buildXtermTheme();
      for (const m of Object.values(mountRefs.current)) m.term?.setOption?.("theme", theme);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    return () => observer.disconnect();
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

  // 布局：面板展开时把 dsh frame 的底部让出 height 高度（grid 第二行占位），
  // 主内容区（含输入框）随之压缩上移 —— 面板与主页面同层，不再浮层遮挡输入框（用户 2026-08-15 改版）。
  // 收起/卸载时恢复原 grid 行定义。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const frame = document.querySelector('[class$="_frame"]');
    if (!frame) return;
    if (open) {
      frame.style.gridTemplateRows = `1fr ${height}px`;
      let spacer = document.getElementById("dshwt-console-spacer");
      if (!spacer) {
        spacer = document.createElement("div");
        spacer.id = "dshwt-console-spacer";
        spacer.setAttribute("data-wt-console-spacer", "true");
        spacer.style.gridRow = "2";
        spacer.style.gridColumn = "1 / -1";
        spacer.style.height = `${height}px`;
        frame.appendChild(spacer);
      } else {
        spacer.style.height = `${height}px`;
      }
    } else {
      frame.style.gridTemplateRows = "";
      document.getElementById("dshwt-console-spacer")?.remove();
    }
    return () => {
      frame.style.gridTemplateRows = "";
      document.getElementById("dshwt-console-spacer")?.remove();
    };
  }, [open, height]);

  // 关闭标签
  const closeTab = useCallback((tab) => {
    if (!tab.ttyId) cancelledRef.current.add(tab.id); // create 未 resolve：resolve 后补 kill
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
      background: "var(--dsw-alias-bg-base, #ffffff)", borderTop: "1px solid var(--dsw-alias-border-l2, #ddd)",
      display: open ? "flex" : "none", // 常驻渲染：收起仅隐藏，不卸载
      flexDirection: "column",
    },
    children: [
      jsx("div", { "data-wt-console-drag": true, onMouseDown: onDragDown, style: { height: 4, cursor: "row-resize", flexShrink: 0 } }),
      jsx("div", { "data-wt-console-bar": true, style: { display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--dsw-alias-border-l2, #333)", flexShrink: 0 }, children: [
        jsx("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, #666)" }, children: "控制台" }),
        jsx("div", { style: { display: "flex", gap: 4, flex: 1, overflow: "auto" }, children: tabs.map((t) =>
          jsx("span", { key: t.id, "data-wt-console-tab": true, "data-active": active === t.id || undefined, onClick: () => setActive(t.id), style: { fontSize: 12, padding: "2px 10px", borderRadius: 4, cursor: "pointer", background: active === t.id ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.08))" : "none", display: "flex", gap: 6, alignItems: "center" }, children: [
            t.title,
            t.status === "exited" && jsx("span", { style: { color: "#e06c75", fontSize: 10 }, children: "已退出" }),
            t.status === "exited" && jsx("span", { role: "button", "data-wt-console-reopen": true, onClick: (e) => { e.stopPropagation(); reopen(); }, style: { color: "#98c379", fontSize: 10, cursor: "pointer" }, children: "重开" }),
            jsx("span", { role: "button", "data-wt-console-close": true, onClick: (e) => { e.stopPropagation(); closeTab(t); }, style: { cursor: "pointer", color: "var(--dsw-alias-label-secondary, #666)" }, children: "✕" }),
          ]}),
        )}) ,
        jsx("button", { type: "button", "data-wt-console-new": true, onClick: addTab, style: { background: "none", border: "1px solid var(--dsw-alias-border-l2, #444)", borderRadius: 4, color: "var(--dsw-alias-label-secondary, #666)", cursor: "pointer", fontSize: 12, padding: "0 8px" }, children: "+" }),
        jsx("button", { type: "button", "data-wt-console-collapse": true, onClick: onToggle, style: { background: "none", border: "none", cursor: "pointer", color: "var(--dsw-alias-label-secondary, #666)", fontSize: 12 }, children: "▾" }),
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
      tabs.length === 0 && jsx("div", { style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dsw-alias-label-secondary, #888)", fontSize: 12 }, children: "点击 + 新建终端" }),
    ],
  });
}
