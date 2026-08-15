// test/client-bundle.test.js —— client.js 束的加载契约回归守卫
// 背景（HARNESS "loaded without registering"）：
//   esbuild format:iife + globalName 会把 external（react 等）在束执行期**急切**
//   __require()（IIFE 顶部），浏览器无全局 require → 抛 "Dynamic require ... is not supported"，
//   footer 的 window.__ModuleLoader__.load(...) 永远不执行 → dsh-client-modules arrive()
//   在 script load 后查 factories.has(id) 失败 → "bundle loaded without registering"。
// 契约（dsh-client-modules/lib/client.js 实测 + §12 client 侧报告 1dc9c01c）：
//   · 束只做一件事：__ModuleLoader__.load({ id, factory }) 注册 factory（同步、不抛）
//   · 全部模块体 + require() 都必须在 factory 闭包内；require 由 loader 的 makeRequire
//     在 materialization 时注入（react / react/jsx-runtime 等 seed 词）
//   · factory 返回插件导出：{ name, inject, apply, default }（CJS __toCommonJS 形状）
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const code = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** 浏览器式沙箱：有 window/document，但**没有**全局 require（与真实页面一致）。 */
function makeSandbox() {
  const factories = new Map();
  const sandbox = {
    window: {},
    document: {
      createElement: () => ({ addEventListener() {}, remove() {}, set src(_v) {}, append() {} }),
      head: { append() {} },
      querySelectorAll: () => [],
    },
    console,
    // 浏览器原生全局（xterm 模块顶层读取；vm 沙箱不自动提供 → 显式补上，M4-A13b）
    queueMicrotask: (cb) => Promise.resolve().then(cb),
    navigator: { userAgent: "", platform: "", language: "", maxTouchPoints: 0 },
  };
  sandbox.window.__ModuleLoader__ = {
    load: (handoff) => {
      factories.set(handoff.id, handoff.factory);
    },
  };
  sandbox.globalThis = sandbox;
  return { sandbox, factories };
}

test("client.js executes without throwing and registers its factory (no global require)", () => {
  const { sandbox, factories } = makeSandbox();
  assert.doesNotThrow(() => vm.runInNewContext(code, sandbox, { filename: "client.js" }));
  assert.ok(
    factories.has("dsh-workspace-tools"),
    'bundle must register "dsh-workspace-tools" via __ModuleLoader__.load during script execution',
  );
});

test("materialized factory resolves externals via loader require and returns plugin exports", () => {
  const { sandbox, factories } = makeSandbox();
  vm.runInNewContext(code, sandbox, { filename: "client.js" });
  const factory = factories.get("dsh-workspace-tools");
  assert.ok(factory, "factory must be registered");

  const noop = () => {};
  const exports_ = factory((spec) => {
    // loader makeRequire 的 seed 词（浏览器运行时由 boot manifest 提供）
    if (spec === "react") return { useState: noop, useCallback: noop, useEffect: noop, useMemo: noop, useRef: noop };
    if (spec === "react/jsx-runtime") return { jsx: noop, jsxs: noop, Fragment: "Fragment" };
    throw new Error(`materialization required unexpected specifier: "${spec}"`);
  });

  assert.equal(exports_.name, "dsh-workspace-tools");
  // 导出对象在 vm realm 内构造（Array.prototype 属 vm），拷贝到宿主 realm 再比较
  assert.deepEqual(Array.from(exports_.inject), ["slots", "sessions", "connection"]);
  assert.equal(typeof exports_.apply, "function");
  assert.equal(exports_.default.name, "dsh-workspace-tools");
});
