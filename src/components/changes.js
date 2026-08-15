// src/components/changes.js
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { normalizeChanges, groupByDir, visibleRows, parseDiff } from "../lib/git-changes.js";
import { DiffWindow } from "./diff-window.js";

const STATUS_COLOR = {
  M: "#e6b450",
  "??": "#9a9a9a",
  D: "#e06c75",
  A: "#7ec699",
  R: "#61afef",
};

export function Changes({ cwd, sessionId, rpc }) {
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selected, setSelected] = useState(null); // { path, untracked }
  const [diffLines, setDiffLines] = useState(null);
  const [diffError, setDiffError] = useState(null);

  const load = useCallback(() => {
    if (!cwd) {
      setGroups([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    callRpc(rpc, "git.listChanges", { cwd, sessionId })
      .then((value) => {
        setGroups(groupByDir(normalizeChanges(value.changes)));
        setStatus("ready");
        setError(null);
      })
      .catch((err) => {
        setStatus("error");
        setError(String(err?.message ?? err));
      });
  }, [cwd, rpc, sessionId]);

  // cwd 变化（工作区切换）→ 重载并清空选中
  useEffect(() => {
    setSelected(null);
    setDiffLines(null);
    setDiffError(null);
    setCollapsed(new Set());
    load();
  }, [load]);

  const openFile = useCallback(
    (c) => {
      setSelected({ path: c.path, untracked: c.untracked });
      setDiffLines(null);
      setDiffError(null);
      callRpc(rpc, "git.getDiff", { cwd, file: c.path, untracked: c.untracked, sessionId })
        .then((value) => setDiffLines(parseDiff(value.diff)))
        .catch((err) => setDiffError(String(err?.message ?? err)));
    },
    [cwd, rpc, sessionId],
  );

  const toggleDir = useCallback((dir) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  const rows = useMemo(() => visibleRows(groups, collapsed), [groups, collapsed]);

  let list;
  if (status === "loading") {
    list = jsx("div", { "data-wt-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (status === "error") {
    list = jsx("div", { "data-wt-error": true, style: { padding: 12, color: "#e06c75" }, children: error });
  } else if (rows.length === 0) {
    list = jsx("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "没有变更" });
  } else {
    list = jsx("div", {
      "data-wt-changes-list": true,
      children: rows.map((row) =>
        row.kind === "dir"
          ? jsx("div", {
              key: `dir-${row.dir}`,
              "data-wt-changes-dir": true,
              onClick: () => toggleDir(row.dir),
              style: {
                padding: "4px 10px",
                fontWeight: 600,
                cursor: "pointer",
                color: "var(--dsw-alias-text-secondary, #999)",
                display: "flex",
                gap: 6,
                alignItems: "center",
              },
              children: [
                jsx("span", { children: collapsed.has(row.dir) ? "▸" : "▾" }),
                jsx("span", { children: row.dir === "" ? "（根目录）" : row.dir }),
                jsx("span", { style: { opacity: 0.6 }, children: `${row.count}` }),
              ],
            })
          : jsx("div", {
              key: `file-${row.path}`,
              role: "button",
              "data-wt-changes-file": true,
              "data-selected": selected?.path === row.path || undefined,
              onClick: () => openFile(row),
              style: {
                padding: "3px 10px",
                paddingLeft: 26,
                cursor: "pointer",
                display: "flex",
                gap: 6,
                alignItems: "center",
                background: selected?.path === row.path ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
              },
              children: [
                jsx("span", {
                  style: {
                    width: 20,
                    textAlign: "center",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: STATUS_COLOR[row.status] ?? "#ccc",
                    border: `1px solid ${STATUS_COLOR[row.status] ?? "#ccc"}`,
                    borderRadius: 3,
                    flexShrink: 0,
                  },
                  children: row.status === "??" ? "?" : row.status,
                }),
                jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: row.base }),
              ],
            }),
      ),
    });
  }

  let diffWindow = null;
  if (selected) {
    diffWindow = jsx(DiffWindow, {
      file: selected.path,
      untracked: selected.untracked,
      diffLines,
      diffError,
      onClose: () => {
        setSelected(null);
        setDiffLines(null);
        setDiffError(null);
      },
    });
  }

  return jsx("div", {
    "data-wt-changes": true,
    style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
    children: [
      jsx("div", {
        style: { display: "flex", justifyContent: "flex-end", padding: "2px 6px", flexShrink: 0 },
        children: jsx("button", {
          type: "button",
          "data-wt-refresh": true,
          onClick: load,
          style: { background: "none", border: "none", cursor: "pointer", color: "var(--dsw-alias-text-secondary, #999)", fontSize: "12px", padding: "2px 8px" },
          children: "↻ 刷新",
        }),
      }),
      jsx("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: list }),
      diffWindow,
    ],
  });
}
