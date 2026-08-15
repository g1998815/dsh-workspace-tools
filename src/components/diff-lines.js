// src/components/diff-lines.js —— unified diff 行渲染（行号列 + 红删绿加 + hunk + 匹配高亮）
import { jsx } from "react/jsx-runtime";

export function DiffLines({ lines, matches = [] }) {
  return jsx("div", {
    "data-wt-diff": true,
    style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", paddingBottom: 8 },
    children: lines.map((l, i) => {
      let bg = "none";
      let color = "var(--dsw-alias-text-primary, #ddd)";
      if (l.kind === "add") { bg = "rgba(126,198,153,0.15)"; color = "#7ec699"; }
      else if (l.kind === "del") { bg = "rgba(224,108,117,0.15)"; color = "#e06c75"; }
      else if (l.kind === "hunk") { bg = "rgba(97,175,239,0.12)"; color = "#61afef"; }
      else if (l.kind === "meta") { color = "var(--dsw-alias-text-secondary, #999)"; }
      const isMatch = matches.includes(i);
      if (isMatch) { bg = "rgba(230,180,80,0.28)"; color = "#f0d59a"; }
      const oldCell = l.oldLine !== null ? String(l.oldLine) : " ";
      const newCell = l.newLine !== null ? String(l.newLine) : " ";
      return jsx("div", {
        key: i,
        "data-line": i,
        "data-wt-diff-line": true,
        "data-kind": l.kind,
        "data-wt-match": isMatch || undefined,
        style: { display: "flex", background: bg, color, padding: "0 8px", whiteSpace: "pre" },
        children: [
          jsx("span", { style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 4 }, children: oldCell }),
          jsx("span", { style: { width: 44, flexShrink: 0, textAlign: "right", color: "var(--dsw-alias-text-secondary, #666)", paddingRight: 8 }, children: newCell }),
          jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: l.text }),
        ],
      });
    }),
  });
}
