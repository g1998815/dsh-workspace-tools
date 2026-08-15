// test/rpc-integration.test.js —— guard→envelope 分派集成测试
// 以最小 ctx stub 驱动 lib/index.js 的 apply()，捕获 connection.rpc.handle 注册的
// handler，逐 guard 结果断言信封形状（code + details）与 op 短路行为。
import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

function captureHandler(fsFake) {
  let handler = null;
  const ctx = {
    connection: { rpc: { handle: (_channel, h) => { handler = h; } } },
    webServer: { registerUpgrade: () => {} },
    fs: fsFake,
    subprocess: { spawnTerminal: async () => { throw new Error("unused"); } },
    sessions: new Map(), // { sessionId -> { header: { cwd } } } 语义：直接用 get 的 Map
    effect: () => () => {},
  };
  apply(ctx);
  return { handler: (endpoint, payload) => handler(endpoint, payload), sessions: ctx.sessions };
}

test("fs.listDir: 缺 sessionId → bad-request（guard 短路，fs 不被调用）", async () => {
  let fsCalled = false;
  const { handler } = captureHandler({ resolve: async () => { fsCalled = true; }, listDir: async () => [] });
  const res = await handler("fs.listDir", { cwd: "/w", relPath: "" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
  assert.deepEqual(res.error.details, { issues: [] });
  assert.equal(fsCalled, false);
});

test("fs.listDir: 未知 sessionId → session-not-found", async () => {
  const { handler } = captureHandler({});
  const res = await handler("fs.listDir", { cwd: "/w", relPath: "", sessionId: "nope" });
  assert.equal(res.error.code, "session-not-found");
  assert.equal(res.error.details.sessionId, "nope");
});

test("fs.listDir: cwd 不匹配 → session-conflict（带字符串 details）", async () => {
  const { handler, sessions } = captureHandler({});
  sessions.set("s1", { header: { cwd: "/w" } });
  const res = await handler("fs.listDir", { cwd: "/other", relPath: "", sessionId: "s1" });
  assert.equal(res.error.code, "session-conflict");
  assert.equal(res.error.details.requestedCwd, "/other");
  assert.equal(res.error.details.existingCwd, "/w");
});

test("fs.listDir: cwd 缺失但 sessionId 有效 → session-conflict 且 requestedCwd 为字符串", async () => {
  const { handler, sessions } = captureHandler({});
  sessions.set("s1", { header: { cwd: "/w" } });
  const res = await handler("fs.listDir", { relPath: "", sessionId: "s1" });
  assert.equal(res.error.code, "session-conflict");
  assert.equal(typeof res.error.details.requestedCwd, "string");
});

test("fs.listDir: relPath 越界 → bad-request（assertInside 拦截）", async () => {
  let listCalled = false;
  const { handler, sessions } = captureHandler({
    resolve: async () => { listCalled = true; return "t"; },
    listDir: async () => [],
  });
  sessions.set("s1", { header: { cwd: "/w" } });
  const res = await handler("fs.listDir", { cwd: "/w", relPath: "../..", sessionId: "s1" });
  assert.equal(res.error.code, "bad-request");
  assert.equal(listCalled, false);
});

test("fs.listDir: 合法请求 → ok + entries（FsTarget 契约：resolve 返回对象，opts.cwd 必须为字符串）", async () => {
  const { handler, sessions } = captureHandler({
    resolve: async (p, o) => {
      // 复刻 dsh-fs-local resolve 契约：opts.cwd 必须是绝对路径字符串（否则 path.resolve 抛 ERR_INVALID_ARG_TYPE）
      if (o?.cwd !== undefined && typeof o.cwd !== "string") {
        throw new TypeError('The "paths[0]" argument must be of type string. Received an instance of Object');
      }
      const base = o?.cwd ?? "/w";
      const abs = p.startsWith("/") ? p : `${base}/${p}`;
      return { targetKey: abs, displayPath: abs };
    },
    listDir: async (t) => [{ name: "a.txt", type: "file", target: { targetKey: `${t.targetKey}/a.txt`, displayPath: `${t.displayPath}/a.txt` } }],
    processPath: (t) => String(t.targetKey),
  });
  sessions.set("s1", { header: { cwd: "/w" } });
  const res = await handler("fs.listDir", { cwd: "/w", relPath: "sub", sessionId: "s1" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { entries: [{ name: "a.txt", isDir: false, absolute: "/w/sub/a.txt" }] });
});

test("fs.listDir: 未知 endpoint → bad-request", async () => {
  const { handler } = captureHandler({});
  const res = await handler("nope.op", {});
  assert.equal(res.error.code, "bad-request");
});
