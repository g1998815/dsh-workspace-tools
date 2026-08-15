// src/lib/git-changes.js —— 变更列表 + unified diff 纯逻辑（无 React 依赖）
export function normalizeChanges(raw) {
  return (raw ?? []).map((c) => {
    const path = c.path ?? "";
    const idx = path.lastIndexOf("/");
    return {
      status: c.status,
      untracked: !!c.untracked,
      path,
      dir: idx === -1 ? "" : path.slice(0, idx),
      base: idx === -1 ? path : path.slice(idx + 1),
    };
  });
}

export function statusLabel(s) {
  switch (s) {
    case "??": return "未跟踪";
    case "M": return "修改";
    case "D": return "删除";
    case "A": return "新增";
    case "R": return "重命名";
    default: return s;
  }
}

export function groupByDir(changes) {
  const groups = [];
  const byDir = new Map();
  for (const c of changes) {
    if (!byDir.has(c.dir)) {
      byDir.set(c.dir, []);
      groups.push({ dir: c.dir, items: byDir.get(c.dir) });
    }
    byDir.get(c.dir).push(c);
  }
  return groups;
}

export function visibleRows(groups, collapsed) {
  const rows = [];
  for (const g of groups) {
    rows.push({ kind: "dir", dir: g.dir, count: g.items.length });
    if (collapsed.has(g.dir)) continue;
    for (const it of g.items) {
      const { dir, ...rest } = it; // file rows carry no dir → r.dir ?? r.base 取 base
      rows.push({ kind: "file", ...rest });
    }
  }
  return rows;
}

// unified diff 行解析：meta/hunk 不带行号；add/del/ctx 带行号（从 hunk 头累计）
export function parseDiff(text) {
  if (!text) return [];
  const lines = [];
  let oldLine = null;
  let newLine = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = m ? Number(m[1]) : null;
      newLine = m ? Number(m[2]) : null;
      lines.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line, oldLine: null, newLine });
      if (newLine !== null) newLine += 1;
    } else if (line.startsWith("-")) {
      lines.push({ kind: "del", text: line, oldLine, newLine: null });
      if (oldLine !== null) oldLine += 1;
    } else if (line.startsWith(" ")) {
      lines.push({ kind: "ctx", text: line, oldLine, newLine });
      if (oldLine !== null) oldLine += 1;
      if (newLine !== null) newLine += 1;
    } else if (line === "") {
      // split("\n") 末尾空串：非 diff 行，跳过
    } else {
      // "\ No newline at end of file" 等
      lines.push({ kind: "ctx", text: line, oldLine: null, newLine: null });
    }
  }
  return lines;
}
