// src/lib/rpc.js —— client 侧 RPC 封装（契约见 lib/rpc.js；常量与 host 共用 lib/constants.js）
import { RPC_CHANNEL } from "../../lib/constants.js";

export { RPC_CHANNEL };

export function unwrapResult(result) {
  if (result && result.ok === true) return result.value;
  const message = result?.error?.message ?? "RPC 调用失败";
  const err = new Error(message);
  err.code = result?.error?.code;
  throw err;
}

export function callRpc(rpc, endpoint, payload) {
  return rpc.call(RPC_CHANNEL, endpoint, payload).then(unwrapResult);
}
