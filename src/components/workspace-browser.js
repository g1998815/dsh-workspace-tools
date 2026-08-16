import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { SessionList } from "./session-list.js";
import { FileTree } from "./file-tree.js";
import { Changes } from "./changes.js";
import { SessionChanges } from "./session-changes.js";
import { ConsolePanel } from "./console.js";

// 页签顺序（2026-08-15 用户定）：文件 → 变更 → 会话变更 → 会话（会话放最后）
const TABS = [
  { id: "files", label: "文件" },
  { id: "changes", label: "变更" },
  { id: "sessionChanges", label: "会话变更" },
  { id: "sessions", label: "会话" },
];

// M5：收起/展开按钮官方 panelIcon（与 dsh 左侧栏同款 SVG，2026-08-15 用户指定）。
// 收起按钮原样；展开按钮旋转 180°（保持 ▸/◂ 的方向语义）。
const PANEL_ICON_PATH =
  "M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z";

// panelIcon：返回 svg jsx；rotate=true 时旋转 180°（展开按钮用）
function panelIcon(rotate) {
  return jsx("svg", {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
    style: rotate ? { transform: "rotate(180deg)" } : undefined,
    children: jsx("path", { fillRule: "evenodd", clipRule: "evenodd", d: PANEL_ICON_PATH, fill: "currentColor" }),
  });
}

// 右侧独立侧边栏（2026-08-15 用户要求改版）：
// 注册进 shell.overlay（list 孔 / root scope，layout 的浮层，z-index 20、inset 0、子元素可交互），
// 不再遮蔽左侧 sidebar.workspaces 的 shipped 工作区浏览器（恢复原样）。
// 面板 fixed 在右缘，可点击收起/展开（收起后仅剩按钮条）。
export function RightSidebar({ useSessions, rpc, openSession, insertIntoComposer }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("files");
  const [railW, setRailW] = useState(300);
  const [changeCount, setChangeCount] = useState(0);
  const [sessionChangeCount, setSessionChangeCount] = useState(0);
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

  // M5 需求 1：rail 与 dsh 主页面**同层**（不再浮于上层遮挡主内容）。
  // 方法：把 dsh frame 的 grid 改成 4 列（sidebar | center | details | 本 rail 占位列），
  // center 列随 rail 宽度收缩——rail 占据右侧留白，主内容（含输入框）始终不被遮挡。
  // 收起态同样让出 56px；卸载/关闭时恢复 frame 原 3 列。
  const railWidth = open ? railW : 56;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const frame = document.querySelector('[class$="_frame"]');
    if (!frame) return;
    frame.style.gridTemplateColumns = `280px 1fr 0px ${railWidth}px`;
    let spacer = document.getElementById("dshwt-rail-spacer");
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.id = "dshwt-rail-spacer";
      spacer.setAttribute("data-wt-rail-spacer", "true");
      spacer.style.gridColumn = "4";
      spacer.style.gridRow = "1 / -1";
      frame.appendChild(spacer);
    }
    return () => {
      frame.style.gridTemplateColumns = "";
      document.getElementById("dshwt-rail-spacer")?.remove();
    };
  }, [railWidth]);

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
      color: "var(--dsw-alias-label-primary, #1a1a1a)",
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
          background: "var(--dsw-alias-bg-overlay, #ffffff)",
          borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
        },
      }),
      open &&
        jsx("div", {
          "data-wt-panel": true,
          style: {
            flex: 1,
            minWidth: 0,
            background: "var(--dsw-alias-bg-base, #ffffff)",
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
                // M5 需求 2：收起按钮放在「文件」页签左侧（原来在 rail 独立窄条）
                jsx("button", {
                  type: "button",
                  "data-wt-toggle": true,
                  "aria-label": "收起工具侧边栏",
                  title: "收起",
                  onClick: () => setOpen(false),
                  style: {
                    padding: "0 10px",
                    background: "none",
                    border: "none",
                    borderRight: "1px solid var(--dsw-alias-border-l2, #333)",
                    cursor: "pointer",
                    color: "var(--dsw-alias-label-secondary, #666)",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  children: panelIcon(false),
                }),
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
                      color: tab === t.id ? "var(--dsw-alias-label-primary, #1a1a1a)" : "var(--dsw-alias-label-secondary, #666)",
                      borderBottom: tab === t.id ? "2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)" : "2px solid transparent",
                    },
                    children:
                      t.id === "changes" && changeCount > 0
                        ? `变更 ${changeCount}`
                        : t.id === "sessionChanges" && sessionChangeCount > 0
                          ? `会话变更 ${sessionChangeCount}`
                          : t.label,
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
                    color: consoleOpen ? "var(--dsw-alias-label-primary, #1a1a1a)" : "var(--dsw-alias-label-secondary, #666)",
                    borderBottom: consoleOpen ? "2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)" : "2px solid transparent",
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
                    : tab === "sessionChanges"
                      ? jsx(SessionChanges, { cwd, sessionId: current, rpc, onCountChange: setSessionChangeCount })
                      : jsx(Changes, { cwd, sessionId: current, rpc, onCountChange: setChangeCount }),
            }),
          ],
        }),
      // ── 收起态：56px 窄 rail，竖排图标（M5 需求 2：文件图标上方加「展开」按钮）──
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
            background: "var(--dsw-alias-bg-overlay, #ffffff)",
            borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
          },
          children: [
            // M5 需求 2：展开右侧边栏按钮（文件图标上面）
            jsx("button", {
              type: "button",
              "data-wt-expand": true,
              title: "展开右侧边栏",
              "aria-label": "展开右侧边栏",
              onClick: () => setOpen(true),
              style: { width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dsw-alias-label-secondary, #666)" },
              children: panelIcon(true),
            }),
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
            // M5 需求 3：终端图标只弹控制台，不展开右侧边栏
            jsx("button", {
              type: "button",
              "data-wt-icon": "console",
              title: "终端",
              "data-active": consoleOpen || undefined,
              onClick: () => setConsoleOpen((v) => !v),
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
