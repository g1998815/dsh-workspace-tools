// test/rpc.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { RPC_CHANNEL, WS_PATH } from "../lib/constants.js";
import { ok, fail, failFrom, checkCwdGuard } from "../lib/rpc.js";

test("constants: RPC_CHANNEL 为单级路径且非保留字", () => {
  assert.match(RPC_CHANNEL, /^\/[A-Za-z0-9._~-]+$/); // CHANNEL_PATTERN
  assert.notEqual(RPC_CHANNEL, "/api");
  assert.equal(WS_PATH, "/plugins/dsh-workspace-tools/console");
});

test("ok/fail: 信封形状满足 client serverResponseSchema", () => {
  assert.deepEqual(ok({ changes: [] }), { ok: true, value: { changes: [] } });
  assert.deepEqual(fail("internal", "boom", {}), {
    ok: false,
    error: { code: "internal", message: "boom", details: {} },
  });
});

test("failFrom: 插件结构化错误映射为 internal，原 code 嵌入 message", () => {
  const e = failFrom({ code: "dir-not-found", message: "目录不存在: /x" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, "internal");
  assert.equal(e.error.message, "[dir-not-found] 目录不存在: /x");
  assert.deepEqual(e.error.details, {});
});

test("failFrom: 无 code 的异常也能映射", () => {
  const e = failFrom(new Error("kaboom"));
  assert.equal(e.error.code, "internal");
  assert.match(e.error.message, /kaboom/);
});

test("checkCwdGuard: ok / conflict / session-not-found / missing-session-id 分派", () => {
  const session = { header: { cwd: "/a/b" } };
  assert.deepEqual(checkCwdGuard(session, { sessionId: "s1", cwd: "/a/b" }), { status: "ok" });
  assert.deepEqual(checkCwdGuard(session, { sessionId: "s1", cwd: "/a/c" }), {
    status: "conflict",
    requestedCwd: "/a/c",
    existingCwd: "/a/b",
  });
  assert.deepEqual(checkCwdGuard(session, { sessionId: "s1" }), {
    status: "conflict",
    requestedCwd: "",
    existingCwd: "/a/b",
  });
  assert.deepEqual(checkCwdGuard(undefined, { sessionId: "s1", cwd: "/a/b" }), { status: "session-not-found" });
  assert.deepEqual(checkCwdGuard(session, { cwd: "/a/b" }), { status: "missing-session-id" });
  assert.deepEqual(checkCwdGuard(session, { sessionId: "", cwd: "/a/b" }), { status: "missing-session-id" });
  assert.deepEqual(checkCwdGuard(session, undefined), { status: "missing-session-id" });
});
