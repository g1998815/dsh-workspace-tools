// lib/rpc.js
// 与 @deepseek-ai/dsh-client-connection@0.1.0-rc.6 的 RPC 信封契约对齐（2026-08-14 源码实测）：
//   · host `connection.rpc.handle(channel, handler)` 中 handler 签名 = (endpoint, payload, signal)
//   · handler 返回值直接进入 `{type:"server-response", rpcId, result}`；client 端
//     `serverResponseSchema` 严格解析 result 为 `{ok:true, value}` 或 `{ok:false, error}`
//   · error.code 必须是封闭枚举（rpcErrorSchema 的 discriminatedUnion，40 个预置 code），
//     插件自定义 code 一律映射为 "internal"（枚举内），原 code 嵌入 message 保留可读性
export function ok(value) {
  return { ok: true, value };
}

export function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

export function failFrom(err) {
  const code = err?.code;
  const message = err?.message ?? String(err ?? "unknown error");
  return fail("internal", `[${code ?? "error"}] ${message}`);
}

// cwd 校验（fail-closed，用户裁定 2026-08-15）：cwd 相关操作强制要求 sessionId；
// 未知会话 / cwd 与会话 header 不一致一律拒绝。session 为 ctx.sessions.get(sessionId) 的结果
// （含 undefined），payload 为 RPC 入参。
export function checkCwdGuard(session, payload) {
  if (typeof payload?.sessionId !== "string" || payload.sessionId === "") {
    return { status: "missing-session-id" };
  }
  if (!session) return { status: "session-not-found" };
  if (session.header?.cwd !== payload.cwd) {
    return { status: "conflict", requestedCwd: payload.cwd, existingCwd: session.header.cwd };
  }
  return { status: "ok" };
}
