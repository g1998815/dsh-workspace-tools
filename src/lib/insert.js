// src/lib/insert.js —— 追加路径到输入框 draft（caret 未发布，退化方案：追加末尾）
export function composeDraftInsert(draft, text) {
  const base = draft.replace(/\s+$/, "");
  return base === "" ? text : `${base} ${text}`;
}
