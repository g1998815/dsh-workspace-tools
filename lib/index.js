// lib/index.js
import { createHash } from "node:crypto";
import { listChanges, getDiff } from "./services/git-diff.js";
import { assertInside, resolvePath } from "./services/workspace-fs.js";
import { createShellSession } from "./services/console.js";
import { RPC_CHANNEL, WS_PATH } from "./constants.js";
import { ok, fail, failFrom, checkCwdGuard } from "./rpc.js";

function translateFsError(err) {
  // ctx.fs 的 FS_* 错误码翻译为插件结构化错误（spec §8 风格）
  if (err && typeof err.code === "string" && err.code.startsWith("FS_")) {
    const map = {
      FS_NOT_FOUND: "dir-not-found",
      FS_NOT_DIRECTORY: "dir-not-found",
      FS_PERMISSION_DENIED: "fs-permission",
      FS_SANDBOX_DENIED: "fs-permission",
    };
    return { code: map[err.code] ?? "fs-error", message: err.message ?? err.code };
  }
  return err;
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// 官方插件形态：命名导出 { name, inject, apply }（对照 @deepseek-ai/dsh-terminal-bash）。
// 部分加载器/Node 版本不 unwrap default（拿到的 namespace 或 {default} 包装无 apply），
// 命名导出让 apply 始终在模块顶层可见；default 同时保留以兼容按 default 解析的加载器。
export const name = "dsh-workspace-tools";
export const inject = ["connection", "webServer", "fs", "subprocess", "sessions"];

export function apply(ctx) {
  const sessions = new Map();

    // ── 1) 一元 RPC：client -> host 调用三服务（契约见 lib/rpc.js）──────────
    // handler 签名 = (endpoint, payload, signal)；返回值必须是 ok/fail 信封。
    // cwd 校验（fail-closed）：带 cwd 的 op 必须携带当前 UI 会话 sessionId，
    // 未知会话拒绝；cwd 与会话 header.cwd 不一致拒绝（枚举内 code session-conflict）。
    const cwdGuardResult = (payload) => {
      const session = payload?.sessionId ? ctx.sessions?.get(payload.sessionId) : undefined;
      return checkCwdGuard(session, payload);
    };
    const guardCwd = (payload) => {
      const g = cwdGuardResult(payload);
      if (g.status === "missing-session-id") return fail("bad-request", "sessionId 必须提供", { issues: [] });
      if (g.status === "session-not-found") return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
      if (g.status === "conflict") {
        return fail("session-conflict", `cwd 与当前会话工作区不一致: ${g.requestedCwd} ≠ ${g.existingCwd}`, {
          sessionId: payload.sessionId,
          requestedCwd: g.requestedCwd,
          existingCwd: g.existingCwd,
        });
      }
      return null;
    };
    ctx.connection.rpc.handle(
      RPC_CHANNEL,
      async (endpoint, payload) => {
        try {
          switch (endpoint) {
            case "git.listChanges": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await listChanges(payload.cwd));
            }
            case "git.getDiff": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await getDiff(payload.cwd, payload.file, { untracked: payload.untracked }));
            }
            case "fs.listDir": {
              // 路径包含校验：ctx.fs.resolve 是纯路径解析（无工作区约束），relPath 越界必须在此拦截
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              try {
                assertInside(payload.cwd, payload.relPath ?? "");
              } catch {
                return fail("bad-request", "路径越出工作区", { issues: [] });
              }
              const root = await ctx.fs.resolve(payload.cwd);
              const target = payload.relPath ? await ctx.fs.resolve(payload.relPath, { cwd: root }) : root;
              const entries = await ctx.fs.listDir(target);
              return ok({
                entries: entries
                  .filter((e) => !e.name.startsWith("."))
                  .map((e) => ({ name: e.name, isDir: e.type === "directory", absolute: ctx.fs.processPath(e.target) })),
              });
            }
            case "fs.resolvePath": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              try {
                assertInside(payload.cwd, payload.relPath ?? "");
              } catch {
                return fail("bad-request", "路径越出工作区", { issues: [] });
              }
              return ok({ absolute: resolvePath(payload.cwd, payload.relPath).absolute });
            }
            case "console.create": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              const s = await createShellSession(
                { spawnTerminal: (opts) => ctx.subprocess.spawnTerminal(opts) },
                { cwd: payload.cwd },
              );
              sessions.set(s.sessionId, s);
              return ok({ sessionId: s.sessionId });
            }
            case "console.write": {
              const s = sessions.get(payload.sessionId);
              if (!s) {
                // 仅当 sessionId 为字符串时才放进 details（避免 client 严格 schema 解析失败）
                if (typeof payload.sessionId === "string") {
                  return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
                }
                return fail("bad-request", "sessionId 必须提供", { issues: [] });
              }
              s.write(payload.data);
              return ok(true);
            }
            case "console.kill": {
              const s = sessions.get(payload.sessionId);
              if (!s) {
                // 仅当 sessionId 为字符串时才放进 details（避免 client 严格 schema 解析失败）
                if (typeof payload.sessionId === "string") {
                  return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
                }
                return fail("bad-request", "sessionId 必须提供", { issues: [] });
              }
              s.kill();
              sessions.delete(payload.sessionId);
              return ok(true);
            }
            default:
              return fail("bad-request", `unknown endpoint: ${endpoint}`, { issues: [] });
          }
        } catch (err) {
          return failFrom(translateFsError(err));
        }
      },
      { authority: "loopback" },
    );

    // ── 2) console 输出流：自建 WebSocket 泵（M4 client 消费）────────────
    ctx.webServer.registerUpgrade({
      path: WS_PATH,
      handler: (req, socket) => {
        if (!isLoopback(req)) {
          socket.destroy();
          return;
        }
        const key = req.headers["sec-websocket-key"];
        if (!key) {
          socket.destroy();
          return;
        }
        // 标准 WS 握手（RFC 6455）
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        // 帧泵：会话输出 -> 文本帧（0x81 + len + payload）
        const frame = (data) => {
          const buf = Buffer.from(data, "utf8");
          const len = buf.length;
          let header;
          if (len < 126) header = Buffer.from([0x81, len]);
          else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(len, 2);
          } else {
            header = Buffer.alloc(10);
            header[0] = 0x81;
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
          }
          socket.write(Buffer.concat([header, buf]));
        };
        const attach = (sessionId) => {
          const s = sessions.get(sessionId);
          if (!s) return;
          const onData = (chunk) => frame(chunk.toString("utf8"));
          const onExit = () => {
            frame(JSON.stringify({ type: "exit" }));
            cleanup();
          };
          const cleanup = () => {
            s.handle.output.off("data", onData);
            s.handle.output.off("end", onExit);
            s.handle.output.off("error", onExit);
            socket.destroy();
          };
          s.handle.output.on("data", onData);
          s.handle.output.on("end", onExit);
          s.handle.output.on("error", onExit);
          socket.on("close", cleanup);
          socket.on("error", cleanup);
        };
        // 首个客户端帧携带 { sessionId }（M4 定义 client 协议）
        socket.on("data", (buf) => {
          try {
            const msg = JSON.parse(buf.toString("utf8").replace(/^\x81.\x00?/, ""));
            if (msg.sessionId) attach(msg.sessionId);
          } catch {
            /* 非 JSON 帧忽略（M4 完善协议） */
          }
        });
      },
    });

    // ── 3) 清理：dispose 时终止所有会话 ─────────────────────────────────
    ctx.effect(() => () => {
      for (const s of sessions.values()) s.kill();
      sessions.clear();
    });
}

// 双保险：默认导出兼容按 default 解析的加载器
export default { name, inject, apply };
