// lib/services/console.js
// PTY 用 ctx.subprocess.spawnTerminal（验证结论 4cffa5fd：不用 ctx.terminals——owner=Agent、无 resize、无输出事件）。
// 无 resize API：spawn 时固定 rows/cols（M1）；动态 resize 留 M4 评估 node-pty 直连。
// Windows：spawnTerminal 在 win32 必抛（process-inspector 未实现）→ 本实现为 POSIX 路径。
import { platform } from "node:os";

export function detectShell({ platform: plat = platform(), env = process.env } = {}) {
  if (plat !== "win32") {
    return env.SHELL || "/bin/zsh";
  }
  // 探测顺序：pwsh -> powershell.exe -> cmd（Windows PTY 未落地，仅保留顺序逻辑）
  return "pwsh";
}

export async function createShellSession(deps, { cwd, rows = 80, cols = 24 } = {}) {
  const shell = deps.shell ?? detectShell();
  const argv = [shell, "-i"];
  let handle;
  try {
    handle = await deps.spawnTerminal({
      argv,
      cwd,
      rows,
      cols,
      env: { ...process.env, TERM: "xterm-256color" },
      graceMs: deps.graceMs ?? 3000,
    });
  } catch (err) {
    if (err && (err.code === "ENOENT" || /ENOENT/.test(String(err?.message ?? err)))) {
      throw { code: "shell-not-found", message: `shell 不可用: ${shell}` };
    }
    throw { code: "pty-spawn-failed", message: String(err?.message ?? err) };
  }
  const sessionId = deps.sessionId ?? `tty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    sessionId,
    handle,
    write: (data) => handle.write(data),
    kill: () => handle.terminate(),
  };
}
