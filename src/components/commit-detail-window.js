// src/components/commit-detail-window.js —— 提交详情浮窗：文件列表 + 点击查看单文件 diff
import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { callRpc } from "../lib/rpc.js";
import { parseDiff } from "../lib/git-changes.js";
import { DraggableWindow } from "./draggable-window.js";
import { DiffLines } from "./diff-lines.js";

const STATUS_COLOR = { A: "#7ec699", M: "#e6b450", D: "#e06c75", R: "#61afef", C: "#61afef" };

export function CommitDetailWindow({ target, cwd, sessionId, rpc, onClose }) {
  const [files, setFiles] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null); // path
  const [diffLines, setDiffLines] = useState(null);
  const [diffError, setDiffError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    callRpc(rpc, "git.show", { cwd, sessionId, target })
      .then((value) => {
        if (cancelled) return;
        setFiles(value.files);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(String(err?.message ?? err));
      });
    return () => { cancelled = true; };
  }, [cwd, rpc, sessionId, target]);

  const openFile = useCallback(
    (f) => {
      setSel(f.path);
      setDiffLines(null);
      setDiffError(null);
      callRpc(rpc, "git.showFile", { cwd, sessionId, target, file: f.path })
        .then((value) => setDiffLines(parseDiff(value.diff)))
        .catch((err) => setDiffError(String(err?.message ?? err)));
    },
    [cwd, rpc, sessionId, target],
  );

  let body;
  if (status === "loading") {
    body = jsx("div", { "data-wt-commit-detail-loading": true, style: { padding: 16, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载中…" });
  } else if (status === "error") {
    body = jsx("div", { "data-wt-commit-detail-error": true, style: { padding: 16, color: "#e06c75" }, children: error });
  } else {
    body = jsx("div", {
      style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
      children: [
        // 文件列表（上半，可滚动）
        jsx("div", {
          "data-wt-commit-files": true,
          style: { flex: sel ? "0 0 35%" : 1, overflow: "auto", borderBottom: sel ? "1px solid var(--dsw-alias-border-l2, #333)" : "none" },
          children: files.map((f) =>
            jsx("div", {
              key: f.path,
              role: "button",
              "data-wt-commit-file": true,
              "data-selected": sel === f.path || undefined,
              onClick: () => openFile(f),
              style: {
                padding: "4px 10px",
                cursor: "pointer",
                display: "flex",
                gap: 6,
                alignItems: "center",
                background: sel === f.path ? "var(--dsw-alias-fill-hover, rgba(255,255,255,0.06))" : "none",
              },
              children: [
                jsx("span", {
                  style: {
                    width: 20, textAlign: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0,
                    color: STATUS_COLOR[f.status] ?? "#ccc", border: `1px solid ${STATUS_COLOR[f.status] ?? "#ccc"}`, borderRadius: 3,
                  },
                  children: f.status,
                }),
                jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: f.path }),
              ],
            }),
          ),
        }),
        // diff 视图（下半）
        sel &&
          (diffError
            ? jsx("div", { "data-wt-commit-diff-error": true, style: { padding: 12, color: "#e06c75" }, children: diffError })
            : !diffLines
              ? jsx("div", { style: { padding: 12, color: "var(--dsw-alias-text-secondary, #999)" }, children: "加载 diff…" })
              : jsx("div", { style: { flex: 1, overflow: "auto", minHeight: 0 }, children: jsx(DiffLines, { lines: diffLines }) })),
      ],
    });
  }

  return jsx(DraggableWindow, {
    title: `${target} 的变更`,
    badge: `${files ? files.length : "…"} 个文件`,
    width: 1080, // M5：原 720 × 1.5（用户需求：默认宽度为原来的 1.5 倍）
    onClose,
    children: body,
  });
}
