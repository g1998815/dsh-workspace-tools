// test/session-changes.test.js —— M6 会话变更捕获层
// 覆盖：store 纯逻辑（push/list 顺序、adopt/revertDone 状态迁移、turn 截断 ≤10、
//       history 倒序、clearHistory）、revertRecord 语义（fake {rm, writeFile}）、
//       buildTurnIndex 纯函数、捕获流（intent → tool/call → result）组装与防泄漏、
//       以及经 lib/index.js apply() 的 RPC 接线（guard + 信封 + 真实文件撤回）。
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdtemp, writeFile as fsWriteFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createSessionChangesStore,
  truncateByTurn,
  buildTurnIndex,
  revertRecord,
  captureIntents,
  captureTurnMap,
  captureResults,
} from "../lib/services/session-changes.js";
import { apply } from "../lib/index.js";

// 跨平台 cwd 夹具（与 rpc-integration.test.js 同款）
const CWD = resolve("/w");

function rec(overrides = {}) {
  return {
    callId: "c1",
    tool: "write",
    file: "a.txt",
    abs: "/w/a.txt",
    before: null,
    after: "content",
    sessionId: "s1",
    turn: 0,
    step: 0,
    at: 1000,
    ...overrides,
  };
}

// ── store：push/list 顺序 ──
test("push/list：保持 (turn, step) 升序", () => {
  const store = createSessionChangesStore();
  store.push("s1", rec({ callId: "a", turn: 1, step: 0 }));
  store.push("s1", rec({ callId: "b", turn: 0, step: 1 }));
  store.push("s1", rec({ callId: "c", turn: 0, step: 0 }));
  assert.deepEqual(
    store.list("s1").map((r) => r.callId),
    ["c", "b", "a"],
  );
  // 不同会话互不影响
  assert.deepEqual(store.list("other"), []);
});

test("同一 turn 多文件 → 多条记录（turn 相同按 step 升序）", () => {
  const store = createSessionChangesStore();
  store.push("s1", rec({ callId: "f1", file: "a.txt", turn: 2, step: 1 }));
  store.push("s1", rec({ callId: "f2", file: "b.txt", turn: 2, step: 0 }));
  store.push("s1", rec({ callId: "f3", file: "c.txt", turn: 1, step: 0 }));
  const items = store.list("s1");
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((r) => [r.turn, r.step, r.file]),
    [
      [1, 0, "c.txt"],
      [2, 0, "b.txt"],
      [2, 1, "a.txt"],
    ],
  );
});

// ── store：adopt / revertDone 状态迁移 ──
test("adopt：pending 移出 → processed(action=adopted)；重复 adopt 幂等返回 false", () => {
  const store = createSessionChangesStore();
  store.push("s1", rec({ callId: "c1", turn: 0, step: 0 }));
  assert.equal(store.adopt("s1", "c1"), true);
  assert.deepEqual(store.list("s1"), []);
  const hist = store.history("s1");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].rec.callId, "c1");
  assert.equal(hist[0].action, "adopted");
  assert.equal(typeof hist[0].handledAt, "number");
  // 幂等：记录已不在 pending，再 adopt 返回 false 且不抛、历史不变
  assert.equal(store.adopt("s1", "c1"), false);
  assert.equal(store.history("s1").length, 1);
  assert.equal(store.adopt("s1", "ghost"), false);
});

test("revertDone：action=reverted", () => {
  const store = createSessionChangesStore();
  store.push("s1", rec({ callId: "c1" }));
  assert.equal(store.revertDone("s1", "c1"), true);
  assert.deepEqual(store.list("s1"), []);
  const hist = store.history("s1");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].rec.callId, "c1");
  assert.equal(hist[0].action, "reverted");
});

// ── 截断：processed 只保留最近 10 个 turn ──
test("truncateByTurn 纯函数：12 个 turn → 剩 10，最旧 turn 全部消失（不改入参）", () => {
  const items = [];
  for (let t = 0; t < 12; t++) {
    items.push({ rec: rec({ callId: `c${t}`, turn: t, step: 0 }), action: "adopted", handledAt: t });
  }
  const kept = truncateByTurn(items, 10);
  assert.equal(kept.length, 10);
  assert.deepEqual(
    [...new Set(kept.map((it) => it.rec.turn))].sort((a, b) => a - b),
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert.equal(items.length, 12); // 入参未被修改
  // 未超上限 → 原样保留
  assert.equal(truncateByTurn(items, 20).length, 12);
});

test("store：adopt 累积 12 个 turn → 历史截断至 10，丢最旧 2 个 turn", () => {
  const store = createSessionChangesStore({ now: () => 5000 });
  for (let t = 0; t < 12; t++) store.push("s1", rec({ callId: `c${t}`, turn: t, step: 0 }));
  for (let t = 0; t < 12; t++) assert.equal(store.adopt("s1", `c${t}`), true);
  const hist = store.history("s1");
  assert.equal(hist.length, 10);
  assert.deepEqual(
    [...new Set(hist.map((it) => it.rec.turn))].sort((a, b) => a - b),
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

// ── history 排序 / clearHistory ──
test("history：按 handledAt 倒序（可注入时钟）", () => {
  let t = 1000;
  const store = createSessionChangesStore({ now: () => t });
  store.push("s1", rec({ callId: "a", turn: 0, step: 0 }));
  store.push("s1", rec({ callId: "b", turn: 0, step: 1 }));
  store.push("s1", rec({ callId: "c", turn: 0, step: 2 }));
  t = 1001; store.adopt("s1", "a");
  t = 1002; store.adopt("s1", "b");
  t = 1003; store.adopt("s1", "c");
  assert.deepEqual(store.history("s1").map((h) => h.rec.callId), ["c", "b", "a"]);
  assert.deepEqual(store.history("s1").map((h) => h.handledAt), [1003, 1002, 1001]);
});

test("clearHistory：清空该会话 processed（pending 不受影响）", () => {
  const store = createSessionChangesStore();
  store.push("s1", rec({ callId: "a" }));
  store.push("s2", rec({ callId: "b", sessionId: "s2" }));
  store.adopt("s1", "a");
  store.clearHistory("s1");
  assert.deepEqual(store.history("s1"), []);
  assert.equal(store.list("s1").length, 0);
  assert.equal(store.list("s2").length, 1);
});

// ── revertRecord 语义（fake {rm, writeFile}）──
test("revertRecord：before=null → rm(abs)；before=文本 → writeFile(abs, before, utf8)；not-found 幂等", async () => {
  const calls = [];
  const store = createSessionChangesStore();
  store.push("s1", rec({ callId: "new", abs: join(CWD, "new.txt"), before: null }));
  const r1 = await revertRecord(store, "s1", "new", {
    rm: async (p, opts) => calls.push(["rm", p, opts]),
    writeFile: async (p, c, enc) => calls.push(["writeFile", p, c, enc]),
  });
  assert.equal(r1.status, "reverted");
  assert.deepEqual(calls, [["rm", join(CWD, "new.txt"), { force: true }]]);
  assert.deepEqual(store.list("s1"), []);
  assert.equal(store.history("s1")[0].action, "reverted");

  calls.length = 0;
  store.push("s1", rec({ callId: "edit", abs: join(CWD, "e.txt"), before: "old text" }));
  const r2 = await revertRecord(store, "s1", "edit", {
    rm: async () => calls.push(["rm"]),
    writeFile: async (p, c, enc) => calls.push(["writeFile", p, c, enc]),
  });
  assert.equal(r2.status, "reverted");
  assert.deepEqual(calls, [["writeFile", join(CWD, "e.txt"), "old text", "utf8"]]);

  // 记录不存在 → not-found，不触碰 fs
  calls.length = 0;
  const r3 = await revertRecord(store, "s1", "ghost", {
    rm: async () => calls.push(["rm"]),
    writeFile: async () => calls.push(["writeFile"]),
  });
  assert.equal(r3.status, "not-found");
  assert.deepEqual(calls, []);
});

// ── turn 索引纯函数 ──
test("buildTurnIndex：tool/call 事件 → callId→{turn,step}；其余事件忽略", () => {
  const idx = buildTurnIndex([
    { type: "session/event", data: {} },
    { type: "tool/call", data: { turn: 2, step: 3, callId: "c1", name: "write" } },
    { type: "tool/call", data: { turn: 3, step: 0, callId: "c2", name: "edit" } },
    { type: "tool/call", data: { name: "no-id" } }, // 缺 callId → 忽略
  ]);
  assert.deepEqual(idx.get("c1"), { turn: 2, step: 3 });
  assert.deepEqual(idx.get("c2"), { turn: 3, step: 0 });
  assert.equal(idx.has("c2"), true);
  assert.equal(idx.size, 2);
});

// ── 捕获流：intent → tool/call → result 组装 Record 并防泄漏 ──
test("captureIntents+captureTurnMap+captureResults：完整流组装 Record，next() 透传，map 清理", async () => {
  const waterFalls = new Map();
  const emits = new Map();
  const files = new Map();
  const ctx = {
    on: (name, fn) => {
      // 与真实 Cordis 一致：waterfall 监听器也用 ctx.on 注册（prepend 存前）
      if (name.startsWith("fs/")) waterFalls.set(name, fn);
      else emits.set(name, fn);
    },
    fs: {
      readText: async (t) => {
        if (!files.has(t.targetKey)) throw Object.assign(new Error("missing"), { code: "FS_NOT_FOUND" });
        return files.get(t.targetKey);
      },
      processPath: (t) => t.targetKey,
    },
  };
  const store = createSessionChangesStore();
  const pendingIntents = new Map();
  const turnMap = new Map();
  captureIntents(ctx, pendingIntents);
  captureTurnMap(ctx, turnMap);
  captureResults(ctx, store, pendingIntents, turnMap);
  assert.equal(waterFalls.has("fs/write-intent"), true);
  assert.equal(waterFalls.has("fs/edit-intent"), true);
  assert.equal(emits.has("session/event"), true);
  assert.equal(emits.has("tools/result"), true);

  const target = { targetKey: join(CWD, "a.txt"), displayPath: "a.txt" };
  const actor = { callId: "call-1", name: "write", agent: { session: { id: "s1" } } };
  files.set(target.targetKey, "before-content");

  // write-intent：读 before，必须 return next()（透传决策）
  const decision = await waterFalls.get("fs/write-intent")(target, actor, async () => "decision");
  assert.equal(decision, "decision");
  assert.equal(pendingIntents.get("call-1").before, "before-content");

  // tool/call 事件 → turn 映射
  emits.get("session/event")({ id: "s1" }, { type: "tool/call", data: { turn: 0, step: 4, callId: "call-1", name: "write" } });
  assert.deepEqual(turnMap.get("call-1"), { turn: 0, step: 4 });

  // tools/result：读 after → 组装 Record → push → 防泄漏清理
  files.set(target.targetKey, "after-content");
  await emits.get("tools/result")({ callId: "call-1", name: "write" }, {});
  const items = store.list("s1");
  assert.equal(items.length, 1);
  const r = items[0];
  assert.equal(r.callId, "call-1");
  assert.equal(r.tool, "write");
  assert.equal(r.file, "a.txt");
  assert.equal(r.abs, target.targetKey);
  assert.equal(r.before, "before-content");
  assert.equal(r.after, "after-content");
  assert.equal(r.sessionId, "s1");
  assert.equal(r.turn, 0);
  assert.equal(r.step, 4);
  assert.equal(typeof r.at, "number");
  assert.equal(pendingIntents.size, 0);
  assert.equal(turnMap.size, 0);

  // after 读失败 → after=null 仍入记录
  files.delete(target.targetKey);
  await waterFalls.get("fs/edit-intent")(target, actor, async () => "decision");
  emits.get("session/event")({ id: "s1" }, { type: "tool/call", data: { turn: 1, step: 0, callId: "call-1", name: "edit" } });
  await emits.get("tools/result")({ callId: "call-1", name: "edit" }, {});
  const r2 = store.list("s1").find((x) => x.callId === "call-1" && x.tool === "edit");
  assert.equal(r2.after, null);
});

// ── RPC 接线（经 lib/index.js apply()）──
function rpcHarness({ files = new Map() } = {}) {
  let handler;
  const waterfalls = new Map();
  const emits = new Map();
  const ctx = {
    connection: { rpc: { handle: (_channel, h) => { handler = h; } } },
    webServer: { registerUpgrade: () => {} },
    fs: {
      readText: async (t) => {
        if (!files.has(String(t.targetKey))) throw Object.assign(new Error("missing"), { code: "FS_NOT_FOUND" });
        return files.get(String(t.targetKey));
      },
      processPath: (t) => String(t.targetKey),
    },
    subprocess: { spawnTerminal: async () => { throw new Error("unused"); } },
    sessions: new Map(),
    effect: () => () => {},
    on: (name, fn) => {
      if (name.startsWith("fs/")) waterfalls.set(name, fn);
      else emits.set(name, fn);
    },
  };
  apply(ctx);
  return {
    handler: (endpoint, payload) => handler(endpoint, payload),
    sessions: ctx.sessions,
    fireIntent: (target, actor) => waterfalls.get("fs/write-intent")(target, actor, async () => "decision"),
    fireToolCall: (data) => emits.get("session/event")({ id: "s1" }, { type: "tool/call", data }),
    fireResult: (exec) => emits.get("tools/result")(exec, {}),
  };
}

// 经捕获流制造一条 pending 记录（turn 0 / step 0）
async function seedPending(h, files, abs, display, { callId = "call-1", before, after } = {}) {
  if (before !== undefined) files.set(abs, before);
  await h.fireIntent({ targetKey: abs, displayPath: display }, { callId, name: "write", agent: { session: { id: "s1" } } });
  h.fireToolCall({ turn: 0, step: 0, callId, name: "write" });
  if (after !== undefined) files.set(abs, after);
  await h.fireResult({ callId, name: "write" });
}

test("RPC: sessionChanges.list 缺 sessionId → bad-request（guard 短路）", async () => {
  const h = rpcHarness();
  const res = await h.handler("sessionChanges.list", { cwd: CWD });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "bad-request");
});

test("RPC: sessionChanges.list 经捕获流返回记录（含 before/after/turn/step/abs）", async () => {
  const files = new Map();
  const h = rpcHarness({ files });
  h.sessions.set("s1", { header: { cwd: CWD } });
  const abs = join(CWD, "a.txt");
  await seedPending(h, files, abs, "a.txt", { before: "old", after: "new" });
  const res = await h.handler("sessionChanges.list", { sessionId: "s1", cwd: CWD });
  assert.equal(res.ok, true);
  assert.equal(res.value.items.length, 1);
  const it = res.value.items[0];
  assert.equal(it.callId, "call-1");
  assert.equal(it.tool, "write");
  assert.equal(it.file, "a.txt");
  assert.equal(it.abs, abs);
  assert.equal(it.before, "old");
  assert.equal(it.after, "new");
  assert.equal(it.sessionId, "s1");
  assert.equal(it.turn, 0);
  assert.equal(it.step, 0);
  assert.equal(typeof it.at, "number");
});

test("RPC: sessionChanges.adopt → ok(true)，pending 清空、history 出现 adopted", async () => {
  const files = new Map();
  const h = rpcHarness({ files });
  h.sessions.set("s1", { header: { cwd: CWD } });
  await seedPending(h, files, join(CWD, "a.txt"), "a.txt", { before: "old", after: "new" });
  const adopt = await h.handler("sessionChanges.adopt", { sessionId: "s1", cwd: CWD, callId: "call-1" });
  assert.equal(adopt.ok, true);
  const list = await h.handler("sessionChanges.list", { sessionId: "s1", cwd: CWD });
  assert.deepEqual(list.value.items, []);
  const hist = await h.handler("sessionChanges.history", { sessionId: "s1", cwd: CWD });
  assert.equal(hist.value.items.length, 1);
  assert.equal(hist.value.items[0].action, "adopted");
  assert.equal(hist.value.items[0].rec.callId, "call-1");
});

test("RPC: sessionChanges.clearHistory 清空后 history 为空", async () => {
  const files = new Map();
  const h = rpcHarness({ files });
  h.sessions.set("s1", { header: { cwd: CWD } });
  await seedPending(h, files, join(CWD, "a.txt"), "a.txt", { before: "old", after: "new" });
  await h.handler("sessionChanges.adopt", { sessionId: "s1", cwd: CWD, callId: "call-1" });
  const clear = await h.handler("sessionChanges.clearHistory", { sessionId: "s1", cwd: CWD });
  assert.equal(clear.ok, true);
  const hist = await h.handler("sessionChanges.history", { sessionId: "s1", cwd: CWD });
  assert.deepEqual(hist.value.items, []);
});

test("RPC: sessionChanges.revert 写回 before（真实文件），记录移入 history=reverted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wt-m6-"));
  const abs = join(dir, "a.txt");
  const files = new Map([[abs, "old content"]]);
  const h = rpcHarness({ files });
  h.sessions.set("s1", { header: { cwd: CWD } });
  try {
    await fsWriteFile(abs, "new content", "utf8");
    await seedPending(h, files, abs, "a.txt", { before: "old content", after: "new content" });
    const res = await h.handler("sessionChanges.revert", { sessionId: "s1", cwd: CWD, callId: "call-1" });
    assert.equal(res.ok, true);
    assert.equal(await readFile(abs, "utf8"), "old content");
    const list = await h.handler("sessionChanges.list", { sessionId: "s1", cwd: CWD });
    assert.deepEqual(list.value.items, []);
    const hist = await h.handler("sessionChanges.history", { sessionId: "s1", cwd: CWD });
    assert.equal(hist.value.items[0].action, "reverted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RPC: sessionChanges.revert 删除新增文件（before=null，真实 fs.rm）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wt-m6-"));
  const abs = join(dir, "new.txt");
  const files = new Map(); // 文件原本不存在
  const h = rpcHarness({ files });
  h.sessions.set("s1", { header: { cwd: CWD } });
  try {
    // intent 时文件不存在 → before=null
    await h.fireIntent({ targetKey: abs, displayPath: "new.txt" }, { callId: "call-1", name: "write", agent: { session: { id: "s1" } } });
    h.fireToolCall({ turn: 0, step: 0, callId: "call-1", name: "write" });
    // 模拟 write 创建了文件
    await fsWriteFile(abs, "created", "utf8");
    files.set(abs, "created");
    await h.fireResult({ callId: "call-1", name: "write" });
    const res = await h.handler("sessionChanges.revert", { sessionId: "s1", cwd: CWD, callId: "call-1" });
    assert.equal(res.ok, true);
    await assert.rejects(readFile(abs, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RPC: sessionChanges.revert 不存在记录 → 幂等 ok(true)", async () => {
  const h = rpcHarness();
  h.sessions.set("s1", { header: { cwd: CWD } });
  const res = await h.handler("sessionChanges.revert", { sessionId: "s1", cwd: CWD, callId: "ghost" });
  assert.equal(res.ok, true);
});
