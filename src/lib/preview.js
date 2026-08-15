// src/lib/preview.js —— client 侧预览辅助（re-export host 纯函数，esbuild 打包进 client bundle）
export { previewKind, TEXT_MAX_BYTES, IMAGE_MAX_BYTES } from "../../lib/services/file-preview.js";

export function dataUrlFrom(kind, base64) {
  // kind 为 "image"，扩展名从 previewKind 已判定的后缀取——这里直接由调用方传 mime 前缀
  return `data:${kind};base64,${base64}`;
}
