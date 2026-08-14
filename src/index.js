// M1 空壳：client 端 UI 自 M2（文件浏览器）起填充。
// 打包后必须自包含 classic script，并以 window.__ModuleLoader__.load({id, factory}) 收尾
// （收尾由 build.mjs 的 footer 注入；M2 起本文件导出 { name, inject, apply }，factory 返回它）。
export {};
