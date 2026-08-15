// build.mjs —— client 束打包（esbuild CJS → 官方 __ModuleLoader__.load 工厂形状）
// 契约（dsh-client-modules/lib/client.js 实测 + §12 client 侧报告 1dc9c01c）：
//   · 束路径由 package.json exports["./client"] 解析（dsh-client-modules 的 clientExportOf）
//   · 束**只做一件事**：window.__ModuleLoader__.load({ id, factory }) 注册 factory。
//     arrive() 在 script load 事件后检查 factories.has(id)，未注册即抛
//     "bundle loaded without registering" —— 所以束执行期间不能有任何前置异常。
//   · 全部模块体 + require() 必须在 factory 闭包内：require 是 loader 注入的
//     makeRequire（seed react 等 + 图内 client 包），在 materialization 时才执行；
//     浏览器执行期**没有全局 require**。
//   · 官方束（rolldown CJS，如 dsh-client-ui-workspace）形状：
//       __ModuleLoader__.load({ id, factory: (require) => {
//         var module = { exports: {} }; var exports = module.exports;
//         ...CJS bundle（require() 全部在闭包内）...
//         return module.exports;
//       } });
// 坑（M2 已踩，repro 见 test/client-bundle.test.js）：
//   esbuild format:"iife" + globalName 会把 external（react 等）在 IIFE 顶部**急切**
//   __require()，浏览器无全局 require → 抛 "Dynamic require ... is not supported"，
//   footer 的 load() 永不执行 → HARNESS "loaded without registering"。
//   因此这里用 format:"cjs" 并手动包进 factory 闭包（与官方产物同构）。
// 注：包装在束前加了 5 行，sourcemap 的 mappings 已前置 5 个空段对齐（列不变）。
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const ID = "dsh-workspace-tools";
const OUT = "client.js";
// 包装行数（束之前）：load({ / id / factory / var module / var exports = 5 行
const WRAP_LINES = 5;

const result = await build({
  entryPoints: ["src/index.js"],
  outfile: OUT,
  bundle: true,
  format: "cjs", // CJS：external 以 require(...) 出现在模块顶层 —— 在 factory 闭包内即用 loader 的 require
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  write: false, // 手动写盘：外层包官方工厂形状
  external: ["react", "react/jsx-runtime", "@deepseek-ai/*"], // 运行时经 makeRequire 解析
  loader: { ".css": "text" }, // css 以文本字符串打包（如 @xterm/xterm/css/xterm.css）
  logLevel: "info",
});

// esbuild 在束尾自带 sourceMappingURL 注释；剥离它，由外层包装在文件真正末尾追加
const bundle = result.outputFiles
  .find((f) => f.path.endsWith(".js"))
  .text.replace(/\/\/# sourceMappingURL=.*\n?$/, "");
const mapText = result.outputFiles.find((f) => f.path.endsWith(".map")).text;
const map = JSON.parse(mapText);
// 对齐：束代码前有 WRAP_LINES 行包装，mappings 前置等量空段（每输出行一个 ';'）
map.mappings = ";".repeat(WRAP_LINES) + map.mappings;
map.file = OUT;

const wrapped = `window.__ModuleLoader__.load({
  id: "${ID}",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${bundle}
    return module.exports;
  }
});
//# sourceMappingURL=${OUT}.map
`;

writeFileSync(OUT, wrapped);
writeFileSync(`${OUT}.map`, JSON.stringify(map));
console.log(`[build] wrote ${OUT} (${wrapped.length} bytes, ${bundle.split("\n").length} bundle lines)`);
