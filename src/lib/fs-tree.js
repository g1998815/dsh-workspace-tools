// src/lib/fs-tree.js —— 文件树纯逻辑（无 React 依赖）
export function parseEntries(raw) {
  return (raw ?? []).map((e) => ({
    name: e.name,
    isDir: !!e.isDir,
    absolute: e.absolute ?? "",
  }));
}

export function joinRel(base, name) {
  return base === "" ? name : `${base}/${name}`;
}

export function toggleExpanded(expanded, rel) {
  const next = new Set(expanded);
  if (next.has(rel)) next.delete(rel);
  else next.add(rel);
  return next;
}

// nodes: Map<rel, {status:"loading"|"ready"|"error", entries?: Array<{name,isDir,absolute}>, error?: string}>
// expanded: Set<rel>（目录的 rel）
// 返回按 host 返回顺序展开的行；未 ready 的目录不展开（loading/error 由组件单独提示）
export function visibleRows(nodes, expanded) {
  const rows = [];
  const walk = (rel, depth) => {
    const node = nodes.get(rel);
    if (!node || node.status !== "ready") return;
    for (const e of node.entries) {
      const key = joinRel(rel, e.name);
      rows.push({ rel: key, name: e.name, isDir: e.isDir, absolute: e.absolute, depth });
      if (e.isDir && expanded.has(key)) walk(key, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

const GLYPHS = {
  js: "🟨", ts: "🟦", json: "📋", md: "📝", yml: "⚙️", yaml: "⚙️",
  py: "🐍", html: "🌐", css: "🎨", sh: "💻",
};

export function fileGlyph(name, isDir) {
  if (isDir) return "📁";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return GLYPHS[ext] ?? "📄";
}
