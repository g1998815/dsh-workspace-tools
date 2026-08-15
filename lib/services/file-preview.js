// lib/services/file-preview.js —— 预览类型判断 + 大小上限（纯函数，无 Node 依赖）
export const TEXT_MAX_BYTES = 256 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "js", "ts", "jsx", "tsx", "mjs", "cjs", "md", "json", "java", "py", "c", "h", "cpp", "cc", "go", "rs",
  "yml", "yaml", "xml", "html", "htm", "css", "scss", "sh", "bash", "zsh", "sql", "toml", "ini",
  "cfg", "conf", "log", "csv", "env", "gitignore", "editorconfig", "dockerfile",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);

export function previewKind(name) {
  if (typeof name !== "string") return null;
  const idx = name.lastIndexOf(".");
  if (idx === -1 || idx === name.length - 1) return null;
  const ext = name.slice(idx + 1).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}
