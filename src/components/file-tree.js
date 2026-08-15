import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { parseEntries, visibleRows, fileGlyph, toggleExpanded } from "../lib/fs-tree.js";
import { PreviewWindow } from "./preview-window.js";
import { previewKind } from "../lib/preview.js";

// 懒加载文件树：根 = 当前会话 cwd；key=cwd 由父组件控制 → 工作区切换重新挂载（状态清零）。
// 行右键菜单：复制绝对路径 / 发送到对话框（相对路径追加到输入框末尾）。
export function FileTree({ cwd, sessionId, rpc, insertIntoComposer }) {
  const [nodes, setNodes] = useState(() => new Map());
  const [expanded, setExpanded] = useState(() => new Set());
  const [selected, setSelected] = useState(null); // rel
  const [preview, setPreview] = useState(null); // {rel, name}
  const [menu, setMenu] = useState(null); // {x, y, rel, name, absolute, isDir}
  const panelRef = useRef(null);
  const menuRef = useRef(null);
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // 根加载（cwd 变化 → 重新挂载语义：清空状态）
  useEffect(() => {
    let cancelled = false;
    setNodes(new Map());
    setExpanded(new Set());
    setSelected(null);
    setMenu(null);
    if (!cwd) return undefined;
    callRpc(rpc, "fs.listDir", { cwd, relPath: "", sessionId })
      .then((value) => {
        if (cancelled) return;
        setNodes((prev) => {
          const next = new Map(prev);
          next.set("", { status: "ready", entries: parseEntries(value.entries) });
          return next;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setNodes((prev) => {
          const next = new Map(prev);
          next.set("", { status: "error", error: String(err?.message ?? err) });
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, rpc, sessionId]);

  const loadDir = useCallback(
    (rel) => {
      const current = nodesRef.current.get(rel);
      if (current && current.status !== "error") return; // 已加载或加载中；error 允许重试
      setNodes((prev) => {
        if (prev.has(rel) && prev.get(rel).status !== "error") return prev;
        const next = new Map(prev);
        next.set(rel, { status: "loading", entries: [] });
        return next;
      });
      callRpc(rpc, "fs.listDir", { cwd, relPath: rel, sessionId })
        .then((value) => {
          setNodes((prev) => {
            const next = new Map(prev);
            next.set(rel, { status: "ready", entries: parseEntries(value.entries) });
            return next;
          });
        })
        .catch((err) => {
          setNodes((prev) => {
            const next = new Map(prev);
            next.set(rel, { status: "error", error: String(err?.message ?? err) });
            return next;
          });
        });
    },
    [cwd, rpc, sessionId],
  );

  const toggle = useCallback(
    (rel) => {
      const wasOpen = expanded.has(rel);
      setExpanded((prev) => toggleExpanded(prev, rel));
      if (!wasOpen) loadDir(rel);
    },
    [expanded, loadDir],
  );

  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
  const root = nodes.get("");

  // 右键菜单：面板内定位 + 外部点击/Escape 关闭
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (ev) => {
      if (menuRef.current && !menuRef.current.contains(ev.target)) setMenu(null);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = useCallback((ev, row) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    setMenu({ x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0), ...row });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onCopy = useCallback(async () => {
    if (!menu) return;
    try {
      await navigator.clipboard.writeText(menu.absolute || menu.rel);
    } catch {
      /* 剪贴板不可用（非安全上下文等）时静默失败 */
    }
    closeMenu();
  }, [menu, closeMenu]);

  const onInsert = useCallback(() => {
    if (!menu || !sessionId) {
      closeMenu();
      return;
    }
    insertIntoComposer(sessionId, menu.rel);
    closeMenu();
  }, [menu, sessionId, insertIntoComposer, closeMenu]);

  let body;
  if (!cwd) {
    body = jsx("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "当前会话没有工作目录" });
  } else if (!root || root.status === "loading") {
    body = jsx("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (root.status === "error") {
    body = jsx("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: root.error });
  } else {
    body = jsx("div", {
      "data-wt-tree": true,
      children: [
        rows.map((row) => {
          const isOpen = row.isDir && expanded.has(row.rel);
          return jsx("div", {
            key: row.rel,
            role: "button",
            tabIndex: 0,
            "data-wt-row": true,
            "data-dir": row.isDir || undefined,
            "data-selected": selected === row.rel || undefined,
            onClick: () => {
              setSelected(row.rel);
              if (row.isDir) {
                toggle(row.rel);
              } else {
                const kind = previewKind(row.name);
                if (kind) setPreview({ rel: row.rel, name: row.name });
              }
            },
            onContextMenu: (ev) => openMenu(ev, row),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                setSelected(row.rel);
                if (row.isDir) toggle(row.rel);
              }
            },
            style: {
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              paddingLeft: 8 + row.depth * 14,
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: selected === row.rel ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
            },
            children: [
              jsx("span", { style: { width: 14, flexShrink: 0, display: "inline-block", textAlign: "center" }, children: row.isDir ? (isOpen ? "▾" : "▸") : "" }),
              jsx("span", { children: fileGlyph(row.name, row.isDir) }),
              jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: row.name }),
            ],
          });
        }),
        ...[...expanded]
          .filter((rel) => nodes.get(rel)?.status === "error")
          .map((rel) =>
            jsx("div", {
              key: `err-${rel}`,
              "data-wt-row-error": true,
              style: { padding: "2px 8px", paddingLeft: 8 + (rel.split("/").length) * 14, color: "#e06c75", fontSize: "12px" },
              children: `${rel}: ${nodes.get(rel).error}`,
            }),
          ),
      ],
    });
  }

  return jsx("div", {
    ref: panelRef,
    "data-wt-filetree": true,
    style: { position: "relative", minHeight: 0 },
    children: [
      body,
      menu &&
        jsx("div", {
          ref: menuRef,
          "data-wt-context-menu": true,
          style: {
            position: "absolute",
            left: menu.x,
            top: menu.y,
            zIndex: 30,
            minWidth: 150,
            background: "var(--dsw-alias-bg-float, #1f1f1f)",
            border: "1px solid var(--dsw-alias-border-l2, #333)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            padding: 4,
          },
          children: [
            jsx("div", {
              role: "menuitem",
              onClick: onCopy,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "复制绝对路径",
            }),
            jsx("div", {
              role: "menuitem",
              onClick: onInsert,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "发送到对话框",
            }),
          ],
        }),
      preview &&
        jsx(PreviewWindow, {
          file: preview.rel,
          cwd,
          sessionId,
          rpc,
          onClose: () => setPreview(null),
        }),
    ],
  });
}
