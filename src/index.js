// M1 最小 client 插件：浏览器端（harness/web UI）经 __ModuleLoader__ 加载本 bundle，
// factory 结果会被 cordis 按插件校验（isApplicable：object.apply 必须是 function）。
// 空导出会让 unwrapExports 返回 { __esModule: true }（无 apply）→ "invalid plugin, received object"。
// 因此 M1 即提供完整插件形状（命名导出 + default，与 host 端 lib/index.js 一致的双保险），
// apply 为空实现占位；client UI 自 M2（文件浏览器）起填充。
export const name = "dsh-workspace-tools";

// M1 空 apply 不需要任何服务；M2 起按需补充（slots / sessions / workspaces / locale 等）
export const inject = [];

export function apply(ctx) {
  // M1 占位：client UI 自 M2 起挂载（sidebar.workspaces + priority:-1，见 M2 计划）。
}

// 双保险：默认导出兼容按 default 解析的加载器（与 lib/index.js 同款）
export default { name, inject, apply };
