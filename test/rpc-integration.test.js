// test/rpc-integration.test.js —— guard→envelope 分派集成测试
// 以最小 ctx stub 驱动 lib/index.js 的 apply()，捕获 connection.rpc.handle 注册的
// handler，逐 guard 结果断言信封形状（code + details）与 op 短路行为。
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { apply } from "../lib/index.js";

// 跨平台 cwd 夹具（M5-W2）：POSIX 下为 "/w"，Windows 下为当前盘根下的 "\w"。
// assertInside 的 root 比较依赖平台真实根前缀；字面量 "/w" 在 Windows 上
// parse().root 为 "/" 而 resolve("/w", x) 落到盘根（如 F:\），会把所有相对路径误判越界。
const CWD = resolve("/w");

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
  const res = await handler("fs.listDir", { cwd: CWD, relPath: "" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
  assert.deepEqual(res.error.details, { issues: [] });
  assert.equal(fsCalled, false);
});

test("fs.listDir: 未知 sessionId → session-not-found", async () => {
  const { handler } = captureHandler({});
  const res = await handler("fs.listDir", { cwd: CWD, relPath: "", sessionId: "nope" });
  assert.equal(res.error.code, "session-not-found");
  assert.equal(res.error.details.sessionId, "nope");
});

test("fs.listDir: cwd 不匹配 → session-conflict（带字符串 details）", async () => {
  const { handler, sessions } = captureHandler({});
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.listDir", { cwd: "/other", relPath: "", sessionId: "s1" });
  assert.equal(res.error.code, "session-conflict");
  assert.equal(res.error.details.requestedCwd, "/other");
  assert.equal(res.error.details.existingCwd, CWD);
});

test("fs.listDir: cwd 缺失但 sessionId 有效 → session-conflict 且 requestedCwd 为字符串", async () => {
  const { handler, sessions } = captureHandler({});
  sessions.set("s1", { header: { cwd: CWD } });
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
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.listDir", { cwd: CWD, relPath: "../..", sessionId: "s1" });
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
      const abs = resolve(o?.cwd ?? CWD, p);
      return { targetKey: abs, displayPath: abs };
    },
    listDir: async (t) => [{ name: "a.txt", type: "file", target: { targetKey: join(t.targetKey, "a.txt"), displayPath: join(t.displayPath, "a.txt") } }],
    processPath: (t) => String(t.targetKey),
  });
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.listDir", { cwd: CWD, relPath: "sub", sessionId: "s1" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { entries: [{ name: "a.txt", isDir: false, absolute: join(CWD, "sub", "a.txt") }] });
});

test("fs.listDir: 未知 endpoint → bad-request", async () => {
  const { handler } = captureHandler({});
  const res = await handler("nope.op", {});
  assert.equal(res.error.code, "bad-request");
});

// ── M3b 预览端点（fs.readText / fs.readImage）集成测试 ──
// fake 复刻 dsh-fs-local 契约：resolve 返回 {targetKey, displayPath}（opts.cwd 必须字符串）、
// stat 返回 {size}、readText/readBytes 返回内容。
function previewFs({ size = 100, text = "hello", bytes = Buffer.from("abc") } = {}) {
  return {
    resolve: async (p, o) => {
      if (o?.cwd !== undefined && typeof o.cwd !== "string") throw new TypeError("paths[0] must be string");
      const abs = resolve(o?.cwd ?? CWD, p);
      return { targetKey: abs, displayPath: abs };
    },
    processPath: (t) => String(t.targetKey),
    stat: async () => ({ size, type: "file", version: "v1" }),
    readText: async () => text,
    readBytes: async () => bytes,
  };
}

test("fs.readText: 文本 happy path → ok({text})", async () => {
  const { handler, sessions } = captureHandler(previewFs());
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.readText", { cwd: CWD, file: "a.md", sessionId: "s1" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { text: "hello" });
});

test("fs.readText: 非文本扩展名 → bad-request（readText 不被调用）", async () => {
  let readCalled = false;
  const { handler, sessions } = captureHandler({ ...previewFs(), readText: async () => { readCalled = true; return ""; } });
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.readText", { cwd: CWD, file: "a.zip", sessionId: "s1" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
  assert.equal(readCalled, false);
});

test("fs.readText: 超过文本上限 → bad-request 文件过大", async () => {
  let readCalled = false;
  const { handler, sessions } = captureHandler({ ...previewFs({ size: 300 * 1024 }), readText: async () => { readCalled = true; return ""; } });
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.readText", { cwd: CWD, file: "big.md", sessionId: "s1" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
  assert.match(res.error.message, /过大/);
  assert.equal(readCalled, false);
});

test("fs.readImage: 图片 happy path → ok({base64})", async () => {
  const { handler, sessions } = captureHandler(previewFs({ bytes: Buffer.from("abc") }));
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.readImage", { cwd: CWD, file: "a.png", sessionId: "s1" });
  assert.equal(res.ok, true);
  assert.equal(res.value.base64, Buffer.from("abc").toString("base64"));
});

test("fs.readImage: 超过图片上限 → bad-request 图片过大", async () => {
  const { handler, sessions } = captureHandler(previewFs({ size: 6 * 1024 * 1024 }));
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("fs.readImage", { cwd: CWD, file: "big.png", sessionId: "s1" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
  assert.match(res.error.message, /过大/);
});

test("git.commit: files 非数组 → bad-request（校验先于任何 git 调用）", async () => {
  const { handler, sessions } = captureHandler({});
  sessions.set("s1", { header: { cwd: CWD } });
  const res = await handler("git.commit", { cwd: CWD, message: "m", files: "oops", sessionId: "s1" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
  assert.match(res.error.message, /字符串数组/);
});

// ── M5-W：console.resize 端点守卫（win32 动态 resize；session 查找先于尺寸校验）──
test("console.resize: 缺 sessionId → bad-request", async () => {
  const { handler } = captureHandler({});
  const res = await handler("console.resize", { cols: 100, rows: 30 });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
});

test("console.resize: 未知 sessionId → session-not-found", async () => {
  const { handler } = captureHandler({});
  const res = await handler("console.resize", { sessionId: "nope", cols: 100, rows: 30 });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "session-not-found");
});
