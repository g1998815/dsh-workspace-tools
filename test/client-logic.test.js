// test/client-logic.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { RPC_CHANNEL, unwrapResult, callRpc } from "../src/lib/rpc.js";
import { parseEntries, joinRel, toggleExpanded, visibleRows, fileGlyph } from "../src/lib/fs-tree.js";
import { composeDraftInsert } from "../src/lib/insert.js";

test("rpc: RPC_CHANNEL 与 host 常量一致", () => {
  assert.equal(RPC_CHANNEL, "/workspace-tools");
});

test("rpc: unwrapResult 透传 ok.value", () => {
  assert.deepEqual(unwrapResult({ ok: true, value: { entries: [] } }), { entries: [] });
});

test("rpc: unwrapResult 对 error 抛错并带 code/message", () => {
  assert.throws(
    () => unwrapResult({ ok: false, error: { code: "internal", message: "[dir-not-found] x", details: {} } }),
    (err) => err.code === "internal" && /dir-not-found/.test(err.message),
  );
});

test("rpc: unwrapResult 对畸形结果抛默认错误", () => {
  assert.throws(() => unwrapResult(undefined), /RPC 调用失败/);
});

test("rpc: callRpc 走 rpc.call 并解包", async () => {
  const calls = [];
  const rpc = {
    call: async (channel, endpoint, payload) => {
      calls.push([channel, endpoint, payload]);
      return { ok: true, value: { entries: [{ name: "a", isDir: false, absolute: "/x/a" }] } };
    },
  };
  const value = await callRpc(rpc, "fs.listDir", { cwd: "/x", relPath: "" });
  assert.deepEqual(calls, [["/workspace-tools", "fs.listDir", { cwd: "/x", relPath: "" }]]);
  assert.equal(value.entries[0].name, "a");
});

test("fs-tree: parseEntries 规范化 RPC 条目", () => {
  const out = parseEntries([{ name: "d", isDir: true, absolute: "/x/d" }, { name: "f", isDir: false }]);
  assert.deepEqual(out, [
    { name: "d", isDir: true, absolute: "/x/d" },
    { name: "f", isDir: false, absolute: "" },
  ]);
  assert.deepEqual(parseEntries(undefined), []);
});

test("fs-tree: joinRel 根与嵌套拼接", () => {
  assert.equal(joinRel("", "a"), "a");
  assert.equal(joinRel("src", "a.js"), "src/a.js");
});

test("fs-tree: toggleExpanded 纯函数增删", () => {
  const s = new Set(["src"]);
  const next = toggleExpanded(s, "src");
  assert.deepEqual([...next], []);
  assert.deepEqual([...s], ["src"]); // 原集合不变
  assert.deepEqual([...toggleExpanded(s, "lib")], ["src", "lib"]);
});

test("fs-tree: visibleRows 展开顺序与深度（目录优先由 host 排序保证）", () => {
  const nodes = new Map([
    ["", { status: "ready", entries: [
      { name: "a.txt", isDir: false, absolute: "/w/a.txt" },
      { name: "src", isDir: true, absolute: "/w/src" },
    ] }],
    ["src", { status: "ready", entries: [
      { name: "b.js", isDir: false, absolute: "/w/src/b.js" },
      { name: "deep", isDir: true, absolute: "/w/src/deep" },
    ] }],
    ["src/deep", { status: "loading", entries: [] }],
  ]);
  // 未展开：只两行
  let rows = visibleRows(nodes, new Set());
  assert.deepEqual(rows.map((r) => r.rel), ["a.txt", "src"]);
  assert.equal(rows[0].depth, 0);
  // 展开 src：src 目录下 children 出现（deep 处于 loading，不展开；rel 为完整相对路径）
  rows = visibleRows(nodes, new Set(["src"]));
  assert.deepEqual(rows.map((r) => `${r.depth}:${r.rel}`), ["0:a.txt", "0:src", "1:src/b.js", "1:src/deep"]);
  // 展开 src + src/deep：deep 未 ready，不展开
  rows = visibleRows(nodes, new Set(["src", "src/deep"]));
  assert.deepEqual(rows.map((r) => r.rel), ["a.txt", "src", "src/b.js", "src/deep"]);
  // 根未加载：空
  assert.deepEqual(visibleRows(new Map(), new Set()), []);
});

test("fs-tree: fileGlyph 目录与常见扩展名", () => {
  assert.equal(fileGlyph("src", true), "📁");
  assert.equal(fileGlyph("a.js", false), "🟨");
  assert.equal(fileGlyph("a.xyz", false), "📄");
});

test("insert: composeDraftInsert 追加文本", () => {
  assert.equal(composeDraftInsert("", "src"), "src");
  assert.equal(composeDraftInsert("hello", "src"), "hello src");
  assert.equal(composeDraftInsert("hello  ", "src"), "hello src");
});
