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

// cwd 必须等于当前会话 header.cwd（host 无"当前活动工作区"概念，以会话 header 为准）
export function assertCwdMatchesSession(headerCwd, cwd) {
  if (headerCwd === undefined) return;
  if (headerCwd !== cwd) {
    throw { code: "cwd-mismatch", message: `cwd 与当前会话工作区不一致: ${cwd} ≠ ${headerCwd}` };
  }
}
