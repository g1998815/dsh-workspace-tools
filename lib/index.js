// lib/index.js
import { createHash } from "node:crypto";
import { listChanges, getDiff } from "./services/git-diff.js";
import { resolvePath } from "./services/workspace-fs.js";
import { createShellSession } from "./services/console.js";
import { RPC_CHANNEL, WS_PATH } from "./constants.js";
import { ok, fail, failFrom, assertCwdMatchesSession } from "./rpc.js";

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
    // cwd 校验：payload.sessionId 存在时，cwd 必须等于会话 header.cwd。
    const guardCwd = (payload) => {
      if (payload?.sessionId) {
        const session = ctx.sessions?.get(payload.sessionId);
        if (session) assertCwdMatchesSession(session.header?.cwd, payload.cwd);
      }
    };
    ctx.connection.rpc.handle(
      RPC_CHANNEL,
      async (endpoint, payload) => {
        try {
          switch (endpoint) {
            case "git.listChanges": {
              guardCwd(payload);
              return ok(await listChanges(payload.cwd));
            }
            case "git.getDiff": {
              guardCwd(payload);
              return ok(await getDiff(payload.cwd, payload.file, { untracked: payload.untracked }));
            }
            case "fs.listDir": {
              // 优先 ctx.fs：resolve 防越界 + listDir 一层懒加载；隐藏全部 dot 条目
              guardCwd(payload);
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
              guardCwd(payload);
              return ok({ absolute: resolvePath(payload.cwd, payload.relPath).absolute });
            }
            case "console.create": {
              guardCwd(payload);
              const s = await createShellSession(
                { spawnTerminal: (opts) => ctx.subprocess.spawnTerminal(opts) },
                { cwd: payload.cwd },
              );
              sessions.set(s.sessionId, s);
              return ok({ sessionId: s.sessionId });
            }
            case "console.write": {
              const s = sessions.get(payload.sessionId);
              if (!s) return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
              s.write(payload.data);
              return ok(true);
            }
            case "console.kill": {
              const s = sessions.get(payload.sessionId);
              if (!s) return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
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
