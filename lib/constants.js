// lib/constants.js
// RPC channel 必须为单级路径（dsh-client-connection 的 CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/，
// 不含斜杠；"/api" 为保留字）。host（lib/index.js）与 client（src/lib/rpc.js）共用，勿单独改。
export const RPC_CHANNEL = "/workspace-tools";
export const WS_PATH = "/plugins/dsh-workspace-tools/console";
