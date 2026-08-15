var __dshwt = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name2 in all)
      __defProp(target, name2, { get: all[name2], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    apply: () => apply,
    default: () => index_default,
    inject: () => inject,
    name: () => name
  });

  // src/components/workspace-browser.js
  var import_jsx_runtime3 = __require("react/jsx-runtime");
  var import_react2 = __require("react");

  // src/components/session-list.js
  var import_jsx_runtime = __require("react/jsx-runtime");
  function SessionList({ useSessions, openSession }) {
    const { ids, byId, current } = useSessions((s) => s);
    return (0, import_jsx_runtime.jsx)("div", {
      "data-wt-sessions": true,
      children: ids.map((id) => {
        const s = byId[id];
        const active = id === current;
        return (0, import_jsx_runtime.jsx)("div", {
          key: id,
          role: "button",
          tabIndex: 0,
          "data-current": active || void 0,
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
            background: active ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none"
          },
          children: s?.displayTitle ?? id
        });
      })
    });
  }

  // src/components/file-tree.js
  var import_jsx_runtime2 = __require("react/jsx-runtime");
  var import_react = __require("react");

  // lib/constants.js
  var RPC_CHANNEL = "/workspace-tools";

  // src/lib/rpc.js
  function unwrapResult(result) {
    if (result && result.ok === true) return result.value;
    const message = result?.error?.message ?? "RPC \u8C03\u7528\u5931\u8D25";
    const err = new Error(message);
    err.code = result?.error?.code;
    throw err;
  }
  function callRpc(rpc, endpoint, payload) {
    return rpc.call(RPC_CHANNEL, endpoint, payload).then(unwrapResult);
  }

  // src/lib/fs-tree.js
  function parseEntries(raw) {
    return (raw ?? []).map((e) => ({
      name: e.name,
      isDir: !!e.isDir,
      absolute: e.absolute ?? ""
    }));
  }
  function joinRel(base, name2) {
    return base === "" ? name2 : `${base}/${name2}`;
  }
  function toggleExpanded(expanded, rel) {
    const next = new Set(expanded);
    if (next.has(rel)) next.delete(rel);
    else next.add(rel);
    return next;
  }
  function visibleRows(nodes, expanded) {
    const rows = [];
    const walk = (rel, depth) => {
      const node = nodes.get(rel);
      if (!node || node.status !== "ready") return;
      for (const e of node.entries ?? []) {
        const key = joinRel(rel, e.name);
        rows.push({ rel: key, name: e.name, isDir: e.isDir, absolute: e.absolute, depth });
        if (e.isDir && expanded.has(key)) walk(key, depth + 1);
      }
    };
    walk("", 0);
    return rows;
  }
  var GLYPHS = {
    js: "\u{1F7E8}",
    ts: "\u{1F7E6}",
    json: "\u{1F4CB}",
    md: "\u{1F4DD}",
    yml: "\u2699\uFE0F",
    yaml: "\u2699\uFE0F",
    py: "\u{1F40D}",
    html: "\u{1F310}",
    css: "\u{1F3A8}",
    sh: "\u{1F4BB}"
  };
  function fileGlyph(name2, isDir) {
    if (isDir) return "\u{1F4C1}";
    const ext = name2.includes(".") ? name2.split(".").pop().toLowerCase() : "";
    return GLYPHS[ext] ?? "\u{1F4C4}";
  }

  // src/components/file-tree.js
  function FileTree({ cwd, sessionId, rpc, insertIntoComposer }) {
    const [nodes, setNodes] = (0, import_react.useState)(() => /* @__PURE__ */ new Map());
    const [expanded, setExpanded] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
    const [selected, setSelected] = (0, import_react.useState)(null);
    const [menu, setMenu] = (0, import_react.useState)(null);
    const panelRef = (0, import_react.useRef)(null);
    const menuRef = (0, import_react.useRef)(null);
    const nodesRef = (0, import_react.useRef)(nodes);
    (0, import_react.useEffect)(() => {
      nodesRef.current = nodes;
    }, [nodes]);
    (0, import_react.useEffect)(() => {
      let cancelled = false;
      setNodes(/* @__PURE__ */ new Map());
      setExpanded(/* @__PURE__ */ new Set());
      setSelected(null);
      setMenu(null);
      if (!cwd) return void 0;
      callRpc(rpc, "fs.listDir", { cwd, relPath: "", sessionId }).then((value) => {
        if (cancelled) return;
        setNodes((prev) => {
          const next = new Map(prev);
          next.set("", { status: "ready", entries: parseEntries(value.entries) });
          return next;
        });
      }).catch((err) => {
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
    const loadDir = (0, import_react.useCallback)(
      (rel) => {
        const current = nodesRef.current.get(rel);
        if (current && current.status !== "error") return;
        setNodes((prev) => {
          if (prev.has(rel) && prev.get(rel).status !== "error") return prev;
          const next = new Map(prev);
          next.set(rel, { status: "loading", entries: [] });
          return next;
        });
        callRpc(rpc, "fs.listDir", { cwd, relPath: rel, sessionId }).then((value) => {
          setNodes((prev) => {
            const next = new Map(prev);
            next.set(rel, { status: "ready", entries: parseEntries(value.entries) });
            return next;
          });
        }).catch((err) => {
          setNodes((prev) => {
            const next = new Map(prev);
            next.set(rel, { status: "error", error: String(err?.message ?? err) });
            return next;
          });
        });
      },
      [cwd, rpc, sessionId]
    );
    const toggle = (0, import_react.useCallback)(
      (rel) => {
        const wasOpen = expanded.has(rel);
        setExpanded((prev) => toggleExpanded(prev, rel));
        if (!wasOpen) loadDir(rel);
      },
      [expanded, loadDir]
    );
    const rows = (0, import_react.useMemo)(() => visibleRows(nodes, expanded), [nodes, expanded]);
    const root = nodes.get("");
    (0, import_react.useEffect)(() => {
      if (!menu) return void 0;
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
    const openMenu = (0, import_react.useCallback)((ev, row) => {
      ev.preventDefault();
      ev.stopPropagation();
      const rect = panelRef.current?.getBoundingClientRect();
      setMenu({ x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0), ...row });
    }, []);
    const closeMenu = (0, import_react.useCallback)(() => setMenu(null), []);
    const onCopy = (0, import_react.useCallback)(async () => {
      if (!menu) return;
      try {
        await navigator.clipboard.writeText(menu.absolute || menu.rel);
      } catch {
      }
      closeMenu();
    }, [menu, closeMenu]);
    const onInsert = (0, import_react.useCallback)(() => {
      if (!menu || !sessionId) {
        closeMenu();
        return;
      }
      insertIntoComposer(sessionId, menu.rel);
      closeMenu();
    }, [menu, sessionId, insertIntoComposer, closeMenu]);
    let body;
    if (!cwd) {
      body = (0, import_jsx_runtime2.jsx)("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u4F5C\u76EE\u5F55" });
    } else if (!root || root.status === "loading") {
      body = (0, import_jsx_runtime2.jsx)("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u52A0\u8F7D\u4E2D\u2026" });
    } else if (root.status === "error") {
      body = (0, import_jsx_runtime2.jsx)("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: root.error });
    } else {
      body = (0, import_jsx_runtime2.jsx)("div", {
        "data-wt-tree": true,
        children: [
          rows.map((row) => {
            const isOpen = row.isDir && expanded.has(row.rel);
            return (0, import_jsx_runtime2.jsx)("div", {
              key: row.rel,
              role: "button",
              tabIndex: 0,
              "data-wt-row": true,
              "data-dir": row.isDir || void 0,
              "data-selected": selected === row.rel || void 0,
              onClick: () => {
                setSelected(row.rel);
                if (row.isDir) toggle(row.rel);
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
                background: selected === row.rel ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none"
              },
              children: [
                (0, import_jsx_runtime2.jsx)("span", { style: { width: 14, flexShrink: 0, display: "inline-block", textAlign: "center" }, children: row.isDir ? isOpen ? "\u25BE" : "\u25B8" : "" }),
                (0, import_jsx_runtime2.jsx)("span", { children: fileGlyph(row.name, row.isDir) }),
                (0, import_jsx_runtime2.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: row.name })
              ]
            });
          }),
          ...[...expanded].filter((rel) => nodes.get(rel)?.status === "error").map(
            (rel) => (0, import_jsx_runtime2.jsx)("div", {
              key: `err-${rel}`,
              "data-wt-row-error": true,
              style: { padding: "2px 8px", paddingLeft: 8 + rel.split("/").length * 14, color: "#e06c75", fontSize: "12px" },
              children: `${rel}: ${nodes.get(rel).error}`
            })
          )
        ]
      });
    }
    return (0, import_jsx_runtime2.jsx)("div", {
      ref: panelRef,
      "data-wt-filetree": true,
      style: { position: "relative", minHeight: 0 },
      children: [
        body,
        menu && (0, import_jsx_runtime2.jsx)("div", {
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
            padding: 4
          },
          children: [
            (0, import_jsx_runtime2.jsx)("div", {
              role: "menuitem",
              onClick: onCopy,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "\u590D\u5236\u7EDD\u5BF9\u8DEF\u5F84"
            }),
            (0, import_jsx_runtime2.jsx)("div", {
              role: "menuitem",
              onClick: onInsert,
              style: { padding: "6px 10px", cursor: "pointer", borderRadius: 4 },
              children: "\u53D1\u9001\u5230\u5BF9\u8BDD\u6846"
            })
          ]
        })
      ]
    });
  }

  // src/components/workspace-browser.js
  var TABS = [
    { id: "sessions", label: "\u4F1A\u8BDD" },
    { id: "files", label: "\u6587\u4EF6" },
    { id: "changes", label: "\u53D8\u66F4" }
  ];
  function WorkspaceBrowser({ useSessions, rpc, openSession, insertIntoComposer }) {
    const [tab, setTab] = (0, import_react2.useState)("files");
    const current = useSessions((s) => s.current);
    const cwd = useSessions((s) => s.current ? s.byId[s.current]?.cwd : void 0);
    return (0, import_jsx_runtime3.jsx)("div", {
      "data-wt-sidebar": true,
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        fontSize: "13px",
        color: "var(--dsw-alias-text-primary, #ddd)"
      },
      children: [
        (0, import_jsx_runtime3.jsx)("div", {
          "data-wt-tabs": true,
          style: {
            display: "flex",
            borderBottom: "1px solid var(--dsw-alias-border-l2, #333)",
            flexShrink: 0
          },
          children: TABS.map(
            (t) => (0, import_jsx_runtime3.jsx)("button", {
              key: t.id,
              type: "button",
              onClick: () => setTab(t.id),
              "data-active": tab === t.id || void 0,
              style: {
                flex: 1,
                padding: "8px 4px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "12px",
                color: tab === t.id ? "var(--dsw-alias-text-primary, #fff)" : "var(--dsw-alias-text-secondary, #999)",
                borderBottom: tab === t.id ? "2px solid var(--dsw-alias-accent, #4f8cff)" : "2px solid transparent"
              },
              children: t.label
            })
          )
        }),
        (0, import_jsx_runtime3.jsx)("div", {
          "data-wt-tabpanel": true,
          style: { flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" },
          children: tab === "sessions" ? (0, import_jsx_runtime3.jsx)(SessionList, { useSessions, openSession }) : tab === "files" ? (0, import_jsx_runtime3.jsx)(FileTree, { key: cwd ?? "no-cwd", cwd, sessionId: current, rpc, insertIntoComposer }) : (0, import_jsx_runtime3.jsx)("div", { "data-wt-changes-placeholder": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "\u53D8\u66F4\u5217\u8868\u5C06\u5728 M3 \u63D0\u4F9B" })
        })
      ]
    });
  }

  // src/lib/insert.js
  function composeDraftInsert(draft, text) {
    const base = draft.replace(/\s+$/, "");
    return base === "" ? text : `${base} ${text}`;
  }

  // src/index.js
  var name = "dsh-workspace-tools";
  var inject = ["slots", "sessions", "connection"];
  function apply(ctx) {
    ctx.slots.inject(
      "sidebar.workspaces",
      () => ctx.slots.register(
        {
          name: "sidebar.workspaces",
          priority: -1,
          inject: () => ({
            rpc: ctx.connection.rpc,
            openSession: (id) => ctx.sessions.open(id),
            insertIntoComposer: (sessionId, relPath) => {
              const conversation = ctx.get("conversation");
              if (!conversation) return false;
              try {
                const shell = conversation.input.shell(sessionId);
                const { draft } = shell.state.getSnapshot();
                shell.actions.setDraft(composeDraftInsert(draft, relPath));
                return true;
              } catch {
                return false;
              }
            }
          })
        },
        WorkspaceBrowser
      )
    );
  }
  var index_default = { name, inject, apply };
  return __toCommonJS(index_exports);
})();
window.__ModuleLoader__.load({ id: "dsh-workspace-tools", factory: (require) => __dshwt });
//# sourceMappingURL=client.js.map
