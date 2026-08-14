// build.mjs —— client 束打包（esbuild，自包含 classic script）
// 契约（§12 client 侧报告 1dc9c01c）：
//   · client 束路径由 package.json exports["./client"] 解析（dsh-client-modules 的 clientExportOf）
//   · 产物以 window.__ModuleLoader__.load({ id, factory }) 收尾；factory 返回本插件导出对象
//   · peer 依赖（react + @deepseek-ai/*）一律 external，运行时经 __ModuleLoader__ 的 makeRequire 解析
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.js"],
  outfile: "client.js",
  bundle: true,
  format: "iife",
  globalName: "__dshwt",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  external: ["react", "react/jsx-runtime", "@deepseek-ai/*"], // M2 起实际生效
  footer: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-workspace-tools", factory: (require) => __dshwt });',
  },
  logLevel: "info",
});
