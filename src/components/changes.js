// src/components/changes.js
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { normalizeChanges, groupByDir, visibleRows, parseDiff, statusLabel } from "../lib/git-changes.js";

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

  let diffPanel = null;
  if (selected) {
    if (diffError) {
      diffPanel = jsx("div", { "data-wt-diff-error": true, style: { padding: 12, color: "#e06c75", borderTop: "1px solid var(--dsw-alias-border-l2, #333)" }, children: diffError });
    } else if (!diffLines) {
      diffPanel = jsx("div", { "data-wt-diff-loading": true, style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)", borderTop: "1px solid var(--dsw-alias-border-l2, #333)" }, children: "加载 diff…" });
    } else {
      diffPanel = jsx("div", {
        "data-wt-diff": true,
        style: {
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
          maxHeight: "45%",
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "11px",
          flexShrink: 0,
        },
        children: [
          jsx("div", {
            "data-wt-diff-head": true,
            style: { padding: "6px 10px", color: "var(--dsw-alias-text-secondary, #999)", background: "var(--dsw-alias-bg-float, #1f1f1f)" },
            children: `${selected.path} · ${statusLabel(selected.untracked ? "??" : "M")}`,
          }),
          jsx("div", {
            children: diffLines.map((l, i) => {
              let bg = "none";
              let color = "var(--dsw-alias-text-primary, #ddd)";
              if (l.kind === "add") { bg = "rgba(126,198,153,0.15)"; color = "#7ec699"; }
              else if (l.kind === "del") { bg = "rgba(224,108,117,0.15)"; color = "#e06c75"; }
              else if (l.kind === "hunk") { bg = "rgba(97,175,239,0.12)"; color = "#61afef"; }
              else if (l.kind === "meta") { color = "var(--dsw-alias-text-secondary, #999)"; }
              const oldCell = l.oldLine !== null ? String(l.oldLine) : " ";
              const newCell = l.newLine !== null ? String(l.newLine) : " ";
              return jsx("div", {
                key: i,
                "data-wt-diff-line": true,
                "data-kind": l.kind,
                style: { display: "flex", background: bg, color, padding: "0 6px", whiteSpace: "pre" },
                children: [
                  jsx("span", { style: { width: 42, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 4 }, children: oldCell }),
                  jsx("span", { style: { width: 42, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 6 }, children: newCell }),
                  jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: l.text }),
                ],
              });
            }),
          }),
        ],
      });
    }
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
      diffPanel,
    ],
  });
}
