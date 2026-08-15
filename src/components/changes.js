// src/components/changes.js —— 变更页签 v2（M3c Task 3）
// 分区：上半区=未提交变更（勾选多选 + 提交选中/全部 + 预览选中 + 分支 + 最近消息复用），
//       下半区=提交历史（安全回退：二段确认 + 推送风险提示）；分隔条可拖拽调比例。
// M3d Task 2：历史行点击打开提交详情浮窗（CommitDetailWindow：文件列表 + 单文件 diff）。
// 保留 M3 能力：变更列表分组/折叠/单文件 diff 浮窗（与预览选中浮窗共用 DiffWindow）。
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { normalizeChanges, groupByDir, visibleRows, parseDiff } from "../lib/git-changes.js";
import { relativeTime } from "../lib/git-history-client.js";
import { DiffWindow } from "./diff-window.js";
import { CommitDetailWindow } from "./commit-detail-window.js";

const STATUS_COLOR = {
  M: "#e6b450",
  "??": "#9a9a9a",
  D: "#e06c75",
  A: "#7ec699",
  R: "#61afef",
};

// 工具行按钮基础样式（disabled 时降透明度）
const BTN = {
  background: "var(--dsw-alias-bg-float, #1f1f1f)",
  border: "1px solid var(--dsw-alias-border-l2, #444)",
  borderRadius: 4,
  color: "var(--dsw-alias-text-primary, #ddd)",
  cursor: "pointer",
  padding: "2px 8px",
  fontSize: 12,
  flexShrink: 0,
};

export function Changes({ cwd, sessionId, rpc, onCountChange }) {
  // ── M3 既有状态 ──────────────────────────────────────────────
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selected, setSelected] = useState(null); // { path, untracked, preview? }
  const [diffLines, setDiffLines] = useState(null);
  const [diffError, setDiffError] = useState(null);

  // ── M3c 新增状态 ─────────────────────────────────────────────
  const [checked, setChecked] = useState(() => new Set()); // 勾选文件路径
  const [commitMsg, setCommitMsg] = useState("");
  const [showRecent, setShowRecent] = useState(false);
  const [recentMessages, setRecentMessages] = useState([]);
  const [branch, setBranch] = useState("");
  const [commits, setCommits] = useState([]);
  const [histStatus, setHistStatus] = useState("loading"); // loading | ready | error
  const [histError, setHistError] = useState(null);
  const [selCommit, setSelCommit] = useState(null);
  const [detail, setDetail] = useState(null); // {hash, shortHash} —— 提交详情浮窗
  const [confirmReset, setConfirmReset] = useState(false);
  const [splitPct, setSplitPct] = useState(50); // 上半区高度百分比
  const [previewLines, setPreviewLines] = useState(null); // 预览选中的拼接 diff
  const [opError, setOpError] = useState(null); // 提交/回退等操作失败的小型内联提示（不影响列表 status）

  // 并行加载：变更 + 分支 + 历史（recentMessages 复用 commits 前 5 条 subject）
  const load = useCallback(() => {
    if (!cwd) {
      setGroups([]);
      setCommits([]);
      setRecentMessages([]);
      setBranch("");
      setStatus("ready");
      setHistStatus("ready");
      setError(null);
      setHistError(null);
      setSelCommit(null);
      setDetail(null);
      setConfirmReset(false);
      setOpError(null);
      onCountChange?.(0);
      return;
    }
    setStatus("loading");
    setHistStatus("loading");
    setHistError(null);
    setOpError(null);
    Promise.all([
      callRpc(rpc, "git.listChanges", { cwd, sessionId }),
      callRpc(rpc, "git.branch", { cwd, sessionId }),
      callRpc(rpc, "git.log", { cwd, sessionId, limit: 50 }),
    ])
      .then(([changesVal, branchVal, logVal]) => {
        const changes = normalizeChanges(changesVal.changes);
        setGroups(groupByDir(changes));
        setBranch(branchVal.branch ?? "");
        const log = logVal.commits ?? [];
        setCommits(log);
        setRecentMessages(log.slice(0, 5).map((c) => c.subject));
        // 刷新后剔除已不存在的勾选路径
        setChecked((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set();
          for (const c of changes) if (prev.has(c.path)) next.add(c.path);
          return next;
        });
        setStatus("ready");
        setError(null);
        setHistStatus("ready");
        setSelCommit(null);
        setDetail(null);
        setConfirmReset(false);
        onCountChange?.(changes.length);
      })
      .catch((err) => {
        const msg = String(err?.message ?? err);
        setStatus("error");
        setError(msg);
        setHistStatus("error");
        setHistError(msg);
      });
  }, [cwd, rpc, sessionId, onCountChange]);

  // cwd 变化（工作区切换）→ 重载并清空全部选择态
  useEffect(() => {
    setSelected(null);
    setDiffLines(null);
    setDiffError(null);
    setPreviewLines(null);
    setCollapsed(new Set());
    setChecked(new Set());
    setCommitMsg("");
    setShowRecent(false);
    setSelCommit(null);
    setDetail(null);
    setConfirmReset(false);
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

  const toggleChecked = useCallback((path) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const rows = useMemo(() => visibleRows(groups, collapsed), [groups, collapsed]);

  // 提交选中（files=勾选路径）；失败用 opError 小型横幅提示，不影响列表加载态
  const commitSelected = useCallback(() => {
    const files = [...checked];
    if (files.length === 0) return;
    setOpError(null);
    callRpc(rpc, "git.commit", { cwd, sessionId, message: commitMsg.trim(), files })
      .then(() => {
        setChecked(new Set());
        setCommitMsg("");
        setShowRecent(false);
        setError(null);
        load();
      })
      .catch((err) => {
        setOpError(String(err?.message ?? err));
      });
  }, [cwd, rpc, sessionId, checked, commitMsg, load]);

  // 全部提交（无 files → host add -A）
  const commitAll = useCallback(() => {
    setOpError(null);
    callRpc(rpc, "git.commit", { cwd, sessionId, message: commitMsg.trim() })
      .then(() => {
        setChecked(new Set());
        setCommitMsg("");
        setShowRecent(false);
        setError(null);
        load();
      })
      .catch((err) => {
        setOpError(String(err?.message ?? err));
      });
  }, [cwd, rpc, sessionId, commitMsg, load]);

  // 预览选中：逐个拉 diff → parseDiff 拼接（文件间插入 meta 分隔行）→ DiffWindow
  const previewSelected = useCallback(() => {
    const files = [...checked];
    if (files.length === 0) return;
    const meta = new Map();
    for (const g of groups) for (const c of g.items) meta.set(c.path, c);
    setSelected({ path: `预览 ${files.length} 个文件`, untracked: false, preview: true });
    setPreviewLines(null);
    setDiffError(null);
    Promise.all(
      files.map((file) =>
        callRpc(rpc, "git.getDiff", { cwd, file, untracked: meta.get(file)?.untracked ?? false, sessionId })
          .then((value) => ({ file, lines: parseDiff(value.diff) }))
          .catch((err) => ({ file, lines: [{ kind: "meta", text: `（读取失败：${err?.message ?? err}）`, oldLine: null, newLine: null }] })),
      ),
    ).then((results) => {
      const lines = [];
      for (const r of results) {
        lines.push({ kind: "meta", text: `--- ${r.file} ---`, oldLine: null, newLine: null });
        lines.push(...r.lines);
      }
      setPreviewLines(lines);
    });
  }, [checked, cwd, groups, rpc, sessionId]);

  // 安全回退：二段确认（第一次点击进入 confirmReset，第二次真正执行）
  const doReset = useCallback(() => {
    if (!selCommit) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setOpError(null);
    callRpc(rpc, "git.reset", { cwd, sessionId, target: selCommit.hash })
      .then(() => {
        setSelCommit(null);
        setConfirmReset(false);
        setHistError(null);
        setError(null);
        load();
      })
      .catch((err) => {
        setOpError(String(err?.message ?? err));
      });
  }, [cwd, rpc, sessionId, selCommit, confirmReset, load]);

  // 分隔条拖拽：按容器高度换算百分比，clamp 20–80
  const onSplitDown = useCallback((e) => {
    const el = e.currentTarget.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev) => {
      if (rect.height <= 0) return;
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  // ── 渲染：变更列表（上半区） ────────────────────────────────
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
                jsx("input", {
                  type: "checkbox",
                  "data-wt-check": true,
                  checked: checked.has(row.path),
                  onChange: () => toggleChecked(row.path),
                  onClick: (e) => e.stopPropagation(), // 勾选不触发行点击（打开 diff）
                  style: { flexShrink: 0, margin: 0, accentColor: "var(--dsw-alias-accent, #4f8cff)" },
                }),
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

  // ── 渲染：历史（下半区） ────────────────────────────────────
  let history;
  if (histStatus === "loading") {
    history = jsx("div", { style: { padding: 10, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载历史…" });
  } else if (histStatus === "error") {
    history = jsx("div", { "data-wt-history-error": true, style: { padding: 10, color: "#e06c75" }, children: histError });
  } else if (commits.length === 0) {
    history = jsx("div", { style: { padding: 10, color: "var(--dsw-alias-text-secondary, #999)" }, children: "没有提交记录" });
  } else {
    history = jsx("div", {
      "data-wt-history-list": true,
      children: commits.map((c) =>
        jsx("div", {
          key: c.hash,
          "data-wt-history-row": true,
          "data-selected": selCommit?.hash === c.hash || undefined,
          title: "左键选中（回退）· 右键查看提交详情",
          onClick: () => {
            setSelCommit(c);
            setConfirmReset(false);
          },
          onContextMenu: (e) => {
            e.preventDefault();
            setDetail({ hash: c.hash, shortHash: c.shortHash });
          },
          style: {
            padding: "4px 10px",
            cursor: "pointer",
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: selCommit?.hash === c.hash ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
          },
          children: [
            jsx("span", { style: { color: "#e6b450", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", flexShrink: 0 }, children: c.shortHash }),
            jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.subject }),
            jsx("span", { style: { flexShrink: 0, color: "var(--dsw-alias-text-secondary, #999)", fontSize: 11 }, children: relativeTime(c.date) }),
          ],
        }),
      ),
    });
  }

  // 回退操作条（选中提交时出现）
  const resetBar = selCommit
    ? jsx("div", {
        "data-wt-reset-bar": true,
        style: {
          padding: "6px 10px",
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flexShrink: 0,
          background: "var(--dsw-alias-bg-base, #1a1a1a)",
        },
        children: [
          jsx("button", {
            type: "button",
            "data-wt-reset": true,
            onClick: doReset,
            style: {
              padding: "5px 10px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
              color: "#fff",
              background: confirmReset ? "#c0392b" : "#555", // 默认灰，确认时变红
            },
            children: confirmReset ? "确认回退？" : `回退到 ${selCommit.shortHash}`,
          }),
          jsx("div", {
            "data-wt-reset-warn": true,
            style: { color: "#e6b450", fontSize: 11, lineHeight: 1.4 },
            children: "若该提交已推送，回退后重新推送需 force",
          }),
        ],
      })
    : null;

  // 工具行：消息输入 + 最近消息 + 提交选中/全部 + 预览
  const n = checked.size;
  const msgEmpty = commitMsg.trim() === "";
  const toolRow = jsx("div", {
    style: { position: "relative", flexShrink: 0 },
    children: [
      jsx("div", {
        "data-wt-tools": true,
        style: { display: "flex", gap: 4, padding: "4px 6px", alignItems: "center", flexWrap: "wrap" },
        children: [
          jsx("input", {
            type: "text",
            "data-wt-commit-msg": true,
            placeholder: "提交消息…",
            value: commitMsg,
            onChange: (e) => setCommitMsg(e.target.value),
            style: {
              flex: "1 1 120px",
              minWidth: 100,
              background: "var(--dsw-alias-bg-base, #141414)",
              border: "1px solid var(--dsw-alias-border-l2, #333)",
              borderRadius: 4,
              color: "var(--dsw-alias-text-primary, #ddd)",
              padding: "3px 8px",
              fontSize: 12,
              outline: "none",
            },
          }),
          jsx("button", {
            type: "button",
            "data-wt-recent": true,
            title: "最近提交消息",
            onClick: () => setShowRecent((v) => !v),
            style: { ...BTN, color: "var(--dsw-alias-text-secondary, #999)" },
            children: "▾ 最近",
          }),
          jsx("button", {
            type: "button",
            "data-wt-commit-selected": true,
            disabled: n === 0 || msgEmpty,
            onClick: commitSelected,
            style: { ...BTN, opacity: n === 0 || msgEmpty ? 0.45 : 1, cursor: n === 0 || msgEmpty ? "default" : "pointer" },
            children: `提交选中(${n})`,
          }),
          jsx("button", {
            type: "button",
            "data-wt-commit-all": true,
            disabled: msgEmpty,
            onClick: commitAll,
            style: { ...BTN, opacity: msgEmpty ? 0.45 : 1, cursor: msgEmpty ? "default" : "pointer" },
            children: "全部提交",
          }),
          jsx("button", {
            type: "button",
            "data-wt-preview-selected": true,
            disabled: n === 0,
            onClick: previewSelected,
            style: { ...BTN, opacity: n === 0 ? 0.45 : 1, cursor: n === 0 ? "default" : "pointer" },
            children: `预览(${n})`,
          }),
        ],
      }),
      showRecent &&
        jsx("div", {
          "data-wt-recent-list": true,
          style: {
            position: "absolute",
            top: "100%",
            left: 6,
            right: 6,
            zIndex: 10,
            background: "var(--dsw-alias-bg-float, #1f1f1f)",
            border: "1px solid var(--dsw-alias-border-l2, #333)",
            borderRadius: 6,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
            maxHeight: 160,
            overflow: "auto",
          },
          children:
            recentMessages.length === 0
              ? jsx("div", { style: { padding: "6px 10px", color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12 }, children: "（暂无最近消息）" })
              : recentMessages.map((m, i) =>
                  jsx("div", {
                    key: i,
                    "data-wt-recent-item": true,
                    onClick: () => {
                      setCommitMsg(m);
                      setShowRecent(false);
                    },
                    style: {
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--dsw-alias-text-primary, #ddd)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                    children: m,
                  }),
                ),
        }),
    ],
  });

  // 顶部信息行：分支 + 刷新
  const infoRow = jsx("div", {
    "data-wt-info": true,
    style: { display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", flexShrink: 0, color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12 },
    children: [
      jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: `📌 ${branch || "detached"}` }),
      jsx("button", {
        type: "button",
        "data-wt-refresh": true,
        onClick: load,
        style: { background: "none", border: "none", cursor: "pointer", color: "var(--dsw-alias-text-secondary, #999)", fontSize: 12, padding: "2px 8px" },
        children: "↻ 刷新",
      }),
    ],
  });

  // 上半区（高度 = splitPct%）
  const upperPane = jsx("div", {
    "data-wt-upper": true,
    style: { height: `${splitPct}%`, minHeight: 0, flexShrink: 0, display: "flex", flexDirection: "column" },
    children: [
      toolRow,
      opError &&
        jsx("div", {
          "data-wt-op-error": true,
          style: { padding: "4px 8px", color: "#e06c75", fontSize: 12, flexShrink: 0, background: "rgba(224,108,117,0.08)" },
          children: opError,
        }),
      jsx("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: list }),
    ],
  });

  // 分隔条（可拖拽调比例）
  const splitBar = jsx("div", {
    "data-wt-split": true,
    onMouseDown: onSplitDown,
    title: "拖拽调整上下比例",
    style: { height: 5, flexShrink: 0, cursor: "row-resize", background: "var(--dsw-alias-border-l2, #333)" },
  });

  // 下半区（历史 + 回退操作条）
  const lowerPane = jsx("div", {
    "data-wt-history": true,
    style: {
      flex: 1,
      minHeight: 0,
      overflow: "auto",
      display: "flex",
      flexDirection: "column",
      borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
    },
    children: [jsx("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, children: history }), resetBar],
  });

  // diff 浮窗（单文件点击 / 预览选中共用 DiffWindow）
  let diffWindow = null;
  if (selected) {
    const isPreview = !!selected.preview;
    diffWindow = jsx(DiffWindow, {
      file: selected.path,
      untracked: selected.untracked,
      diffLines: isPreview ? previewLines : diffLines,
      diffError: isPreview ? null : diffError,
      onClose: () => {
        setSelected(null);
        setDiffLines(null);
        setDiffError(null);
        setPreviewLines(null);
      },
    });
  }

  return jsx("div", {
    "data-wt-changes": true,
    style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
    children: [infoRow, upperPane, splitBar, lowerPane, diffWindow, detail &&
      jsx(CommitDetailWindow, {
        key: detail.hash,
        target: detail.hash,
        cwd,
        sessionId,
        rpc,
        onClose: () => setDetail(null),
      })],
  });
}
