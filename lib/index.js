// lib/index.js
import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { createSessionChangesStore, captureIntents, captureTurnMap, captureResults, revertRecord } from "./services/session-changes.js";
import { listChanges, getDiff } from "./services/git-diff.js";
import { logCommits, commitAll, resetTo, currentBranch, showCommitFiles, showCommitFile } from "./services/git-history.js";
import { previewKind, TEXT_MAX_BYTES, IMAGE_MAX_BYTES } from "./services/file-preview.js";
import { assertInside, resolvePath } from "./services/workspace-fs.js";
import { createShellSession } from "./services/console.js";
import { createFrameParser } from "./services/ws-frames.js";
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
            case "git.log": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await logCommits(payload.cwd, { limit: payload.limit ?? 50 }));
            }
            case "git.show": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await showCommitFiles(payload.cwd, payload.target));
            }
            case "git.showFile": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await showCommitFile(payload.cwd, payload.target, payload.file));
            }
            case "git.branch": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await currentBranch(payload.cwd));
            }
            case "git.commit": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              if (typeof payload.message !== "string" || payload.message.trim() === "") {
                return fail("bad-request", "提交消息不能为空", { issues: [] });
              }
              if (payload.files !== undefined && (!Array.isArray(payload.files) || payload.files.some((f) => typeof f !== "string"))) {
                return fail("bad-request", "files 必须是字符串数组", { issues: [] });
              }
              return ok(await commitAll(payload.cwd, payload.message, payload.files));
            }
            case "git.reset": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok(await resetTo(payload.cwd, payload.target));
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
              // ctx.fs.resolve 返回 FsTarget 对象（{targetKey, displayPath}）；opts.cwd 必须传绝对路径字符串
              // （内部 path.resolve(cwd, path)），否则 ERR_INVALID_ARG_TYPE。用 processPath 取字符串。
              const target = payload.relPath ? await ctx.fs.resolve(payload.relPath, { cwd: ctx.fs.processPath(root) }) : root;
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
            case "fs.readText": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              try {
                assertInside(payload.cwd, payload.file ?? "");
              } catch {
                return fail("bad-request", "路径越出工作区", { issues: [] });
              }
              if (previewKind(payload.file) !== "text") {
                return fail("bad-request", "不支持预览该文件类型", { issues: [] });
              }
              const rootT = await ctx.fs.resolve(payload.cwd);
              const targetT = await ctx.fs.resolve(payload.file, { cwd: ctx.fs.processPath(rootT) });
              const stT = await ctx.fs.stat(targetT);
              if (stT && stT.size > TEXT_MAX_BYTES) {
                return fail("bad-request", "文件过大", { issues: [] });
              }
              try {
                const text = await ctx.fs.readText(targetT);
                return ok({ text });
              } catch (err) {
                return failFrom(translateFsError(err));
              }
            }
            case "fs.readImage": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              try {
                assertInside(payload.cwd, payload.file ?? "");
              } catch {
                return fail("bad-request", "路径越出工作区", { issues: [] });
              }
              if (previewKind(payload.file) !== "image") {
                return fail("bad-request", "不支持预览该文件类型", { issues: [] });
              }
              const rootI = await ctx.fs.resolve(payload.cwd);
              const targetI = await ctx.fs.resolve(payload.file, { cwd: ctx.fs.processPath(rootI) });
              const stI = await ctx.fs.stat(targetI);
              if (stI && stI.size > IMAGE_MAX_BYTES) {
                return fail("bad-request", "图片过大", { issues: [] });
              }
              try {
                const buf = await ctx.fs.readBytes(targetI, undefined, IMAGE_MAX_BYTES);
                return ok({ base64: buf.toString("base64") });
              } catch (err) {
                return failFrom(translateFsError(err));
              }
            }
            case "console.create": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              const s = await createShellSession(
                { spawnTerminal: (opts) => ctx.subprocess.spawnTerminal(opts) },
                // M4-A8：透传 client 指定 rows/cols（client 固定 40×120；无 resize API，spawn 尺寸即终态）
                { cwd: payload.cwd, rows: payload.rows, cols: payload.cols },
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
            case "console.resize": {
              // M5-W：win32 node-pty 直连后支持动态 resize（PSReadLine 按真实行列重绘，
              // 修复历史导航时重绘错位）；POSIX spawnTerminal 无 resize API，静默忽略。
              const s = sessions.get(payload.sessionId);
              if (!s) {
                if (typeof payload.sessionId === "string") {
                  return fail("session-not-found", "会话不存在", { sessionId: payload.sessionId });
                }
                return fail("bad-request", "sessionId 必须提供", { issues: [] });
              }
              if (
                !Number.isInteger(payload.cols) || !Number.isInteger(payload.rows) ||
                payload.cols < 2 || payload.cols > 500 || payload.rows < 1 || payload.rows > 200
              ) {
                return fail("bad-request", "cols/rows 必须为合理正整数", { issues: [] });
              }
              s.handle.resize?.(payload.cols, payload.rows);
              return ok(true);
            }
            case "sessionChanges.list": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok({ items: store.list(payload.sessionId) });
            }
            case "sessionChanges.history": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              return ok({ items: store.history(payload.sessionId) });
            }
            case "sessionChanges.clearHistory": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              store.clearHistory(payload.sessionId);
              return ok(true);
            }
            case "sessionChanges.adopt": {
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              store.adopt(payload.sessionId, payload.callId);
              return ok(true);
            }
            case "sessionChanges.revert": {
              // 写回 before（新增文件 → 删除）；失败经 translateFsError 结构化返回（记录留在 pending 可重试）
              const guardError = guardCwd(payload);
              if (guardError) return guardError;
              await revertRecord(store, payload.sessionId, payload.callId, { rm, writeFile });
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
            sessions.delete(sessionId); // M4：自然退出清理（M1 遗留）
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
        // 入站帧解析（RFC6455，client→server 必须 masked）——M4 替换 M1 hack
        const parser = createFrameParser();
        socket.on("data", (buf) => {
          for (const ev of parser.push(buf)) {
            if (ev.type === "text") {
              try {
                const msg = JSON.parse(ev.payload);
                if (msg.sessionId) attach(msg.sessionId);
              } catch {
                /* 非 JSON 帧忽略 */
              }
            } else if (ev.type === "close") {
              socket.destroy();
            }
          }
        });
      },
    });

    // ── 3) 清理：dispose 时终止所有会话 ─────────────────────────────────
    ctx.effect(() => () => {
      for (const s of sessions.values()) s.kill();
      sessions.clear();
    });

    // ── 4) M6：会话变更捕获层（write/edit 工具快照 + turn 归属；纯内存，与 git 解耦）──
    // 事件：fs/*-intent（waterfall，读 before + 透传决策）→ session/event（turn 映射）→
    // tools/result（读 after，组装 Record）。capture* 自检 ctx 事件能力，最小 ctx 下跳过。
    const store = createSessionChangesStore();
    const pendingIntents = new Map();
    const turnMap = new Map();
    // 修复（2026-08-16）：captureIntents 原用 ctx.waterfall 注册触发 API → fatal load failure；
    // 已改为 ctx.on 注册（prepend），此处恢复调用。
    captureIntents(ctx, pendingIntents);
    captureTurnMap(ctx, turnMap);
    captureResults(ctx, store, pendingIntents, turnMap);
    ctx.effect(() => () => {
      store.clear();
      pendingIntents.clear();
      turnMap.clear();
    }, "session-changes teardown");
}

// 双保险：默认导出兼容按 default 解析的加载器
export default { name, inject, apply };
