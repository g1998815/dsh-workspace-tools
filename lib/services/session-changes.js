// lib/services/session-changes.js
// M6 会话变更捕获层（host 内存，与 git 完全解耦）。
// 捕获 write/edit 工具的 before/after 快照与 turn/step 归属，支撑"会话变更"tab 的
// 逐条查看与采用/撤回：
//   · fs/write-intent、fs/edit-intent（waterfall）→ 读 before，按 actor.callId 记 pending 意图
//   · session/event（tool/call）→ callId→{turn,step} 索引
//   · tools/result → 按 callId 匹配意图，读 after，组装 Record 入 store
// 设计：纯函数优先（记录排序 / turn 截断 / turn 索引）便于单测；store 为
// Map<sessionId, …> 内存实现；捕获函数自检 ctx 事件能力，最小 ctx（RPC 单测桩）
// 下自动跳过事件注册。
// 不引入任何 npm 依赖：仅 node:fs/promises（调用方注入 rm/writeFile）。

export const MAX_TURNS = 10;

// ── 纯函数 ──

// 记录排序键：(turn, step) 升序
export function compareRecords(a, b) {
  if (a.turn !== b.turn) return a.turn - b.turn;
  return a.step - b.step;
}

// 已处理历史截断：按 turn 分组后只保留最近 maxTurns 个 turn（超出丢最旧 turn 的全部项）。
// 返回新数组、不改入参、保留相对顺序。
export function truncateByTurn(items, maxTurns = MAX_TURNS) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const turns = [...new Set(items.map((it) => it.rec.turn))].sort((a, b) => a - b);
  if (turns.length <= maxTurns) return items.slice();
  const keep = new Set(turns.slice(turns.length - maxTurns));
  return items.filter((it) => keep.has(it.rec.turn));
}

// session/event 流 → callId→{turn,step} 索引（仅 tool/call 事件且含 callId）
export function buildTurnIndex(events) {
  const map = new Map();
  for (const ev of events ?? []) {
    const data = ev?.data;
    if (ev?.type === "tool/call" && data && typeof data.callId === "string") {
      map.set(data.callId, { turn: data.turn, step: data.step });
    }
  }
  return map;
}

// ── store ──

// createSessionChangesStore({ now }) → store
//   pending:   Map<sessionId, Record[]>（(turn,step) 升序）
//   processed: Map<sessionId, {rec, action, handledAt}[]>（adopt/revertDone 后追加，截断 ≤10 turn）
// Record（不可变）：{ callId, tool, file, abs, before, after, sessionId, turn, step, at }
export function createSessionChangesStore({ now = Date.now } = {}) {
  const pending = new Map();
  const processed = new Map();

  // 追加到 pending（保持 turn,step 升序）
  function push(sessionId, rec) {
    const list = pending.get(sessionId) ?? [];
    const idx = list.findIndex((r) => compareRecords(rec, r) < 0);
    if (idx === -1) list.push(rec);
    else list.splice(idx, 0, rec);
    pending.set(sessionId, list);
  }

  // 当前会话全部 pending 记录（副本）
  function list(sessionId) {
    return [...(pending.get(sessionId) ?? [])];
  }

  function find(sessionId, callId) {
    return (pending.get(sessionId) ?? []).find((r) => r.callId === callId);
  }

  // pending 移出 → processed 追加（按 handledAt 截断 ≤10 turn）；不存在返回 false（幂等不抛）
  function moveToProcessed(sessionId, callId, action) {
    const list = pending.get(sessionId);
    if (!list) return false;
    const idx = list.findIndex((r) => r.callId === callId);
    if (idx === -1) return false;
    const [rec] = list.splice(idx, 1);
    const hist = processed.get(sessionId) ?? [];
    hist.push({ rec, action, handledAt: now() });
    processed.set(sessionId, truncateByTurn(hist));
    return true;
  }

  function adopt(sessionId, callId) {
    return moveToProcessed(sessionId, callId, "adopted");
  }

  function revertDone(sessionId, callId) {
    return moveToProcessed(sessionId, callId, "reverted");
  }

  // 已处理历史（按 handledAt 倒序）
  function history(sessionId) {
    return [...(processed.get(sessionId) ?? [])].sort((a, b) => b.handledAt - a.handledAt);
  }

  function clearHistory(sessionId) {
    processed.delete(sessionId);
  }

  // teardown：清空全部会话数据
  function clear() {
    pending.clear();
    processed.clear();
  }

  return { push, list, find, adopt, revertDone, history, clearHistory, clear };
}

// ── 撤回（RPC 层使用；文件写回由调用方注入的 {rm, writeFile} 完成）──

// 撤回一条记录：写回 before（before===null 表示新增文件 → 删除）。文件操作成功后才
// 移入 processed（action="reverted"）。记录不存在 → {status:"not-found"}（RPC 层映射为幂等 ok）。
export async function revertRecord(store, sessionId, callId, { rm, writeFile }) {
  const rec = store.find(sessionId, callId);
  if (!rec) return { status: "not-found" };
  if (rec.before === null) {
    await rm(rec.abs, { force: true });
  } else {
    await writeFile(rec.abs, rec.before, "utf8");
  }
  store.revertDone(sessionId, callId);
  return { status: "reverted" };
}

// ── 捕获接线（ctx 为 Cordis 上下文；自检事件能力，最小 ctx 下跳过）──

// 注册 fs/write-intent、fs/edit-intent（waterfall）：在 next() 之前读 before
// （读失败/不存在 → before=null 表示新增），按 actor.callId 记 pending 意图。
// 必须 return next() 透传决策（官方 fs-observation-policy 同模式）。
export function captureIntents(ctx, pendingIntents = new Map()) {
  if (typeof ctx.waterfall !== "function") return pendingIntents;
  const handler = async (target, actor, next) => {
    let before = null;
    try {
      before = await ctx.fs.readText(target);
    } catch {
      before = null;
    }
    const sessionId = actor?.agent?.session?.id;
    if (typeof actor?.callId === "string" && sessionId) {
      pendingIntents.set(actor.callId, { target, before, sessionId, at: Date.now() });
    }
    return next();
  };
  ctx.waterfall("fs/write-intent", handler);
  ctx.waterfall("fs/edit-intent", handler);
  return pendingIntents;
}

// 注册 session/event 监听：tool/call 事件（data 含 {turn, step, callId, name}）→
// callId→{turn,step} 索引
export function captureTurnMap(ctx, turnMap = new Map()) {
  if (typeof ctx.on !== "function") return turnMap;
  ctx.on("session/event", (_session, event) => {
    const data = event?.data;
    if (event?.type === "tool/call" && data && typeof data.callId === "string") {
      turnMap.set(data.callId, { turn: data.turn, step: data.step });
    }
  });
  return turnMap;
}

// 注册 tools/result 监听：按 exec.callId 匹配 pending 意图 → 读 after（失败 → null 仍入记录）
// → 组装 Record 入 store；清理 pendingIntents / turnMap 对应键（防泄漏）。
// turn 缺失（未捕获到 tool/call 事件）时按 (0, 0) 兜底。
export function captureResults(ctx, store, pendingIntents = new Map(), turnMap = new Map()) {
  if (typeof ctx.on !== "function") return;
  ctx.on("tools/result", async (exec) => {
    const callId = exec?.callId;
    if (!callId) return;
    const intent = pendingIntents.get(callId);
    if (!intent) return; // 非 write/edit 工具或意图未捕获
    const tt = turnMap.get(callId) ?? { turn: 0, step: 0 };
    let after = null;
    try {
      after = await ctx.fs.readText(intent.target);
    } catch {
      after = null;
    }
    store.push(intent.sessionId, {
      callId,
      tool: exec.name,
      file: intent.target.displayPath,
      abs: ctx.fs.processPath(intent.target),
      before: intent.before,
      after,
      sessionId: intent.sessionId,
      turn: tt.turn,
      step: tt.step,
      at: intent.at,
    });
    pendingIntents.delete(callId);
    turnMap.delete(callId);
  });
}
