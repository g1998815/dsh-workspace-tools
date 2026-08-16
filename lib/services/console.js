// lib/services/console.js
// PTY 用 ctx.subprocess.spawnTerminal（验证结论 4cffa5fd：不用 ctx.terminals——owner=Agent、无 resize、无输出事件）。
// 无 resize API：spawn 时固定 rows/cols（M1）；动态 resize 留 M4 评估 node-pty 直连。
// Windows（M5-W 修复，2026-08-16）：dsh-subprocess 的 spawnTerminal 在 win32 必抛
// （createProcessInspector 只实现 linux/darwin，dsh-subprocess-local/lib/index.js:295-299）
// → win32 分支绕开 seam 直连 node-pty（M4/M5 计划早已列为备选）：
//   · node-pty 经插件根 node_modules junction（→ profiles/node_modules）解析，与 DSH 同实例；
//   · shell 探测顺序：pwsh 7 → Windows PowerShell → cmd（完整路径，node-pty win32 需要）；
//   · node-pty 加载失败仍抛 unsupported-platform（保留 M5 显式降级路径）。
import { platform, homedir } from "node:os";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { PassThrough } from "node:stream";

export function detectShell({ platform: plat = platform(), env = process.env } = {}) {
  if (plat !== "win32") {
    return env.SHELL || "/bin/zsh";
  }
  // 探测顺序语义（M1）：pwsh -> powershell.exe -> cmd；真实解析在 resolveWindowsShellPath
  return "pwsh";
}

// pwsh 7 标准安装位置（非系统目录，单独列出）
const PW_SH_PATH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

// win32 shell 候选（完整路径）：pwsh 7 → Windows PowerShell → cmd
export function windowsShellCandidates({ windir = process.env.windir ?? "C:\\Windows" } = {}) {
  return [
    PW_SH_PATH,
    join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    join(windir, "System32", "cmd.exe"),
  ];
}

// 探测第一个真实存在的 win32 shell；都不可用返回 null
export function resolveWindowsShellPath({ exists = existsSync } = {}) {
  return windowsShellCandidates().find((p) => exists(p)) ?? null;
}

// node-pty 延迟加载：先按模块名解析（插件根 node_modules junction → profiles/node_modules，
// 与 DSH 加载的是同一实例），再按 DSH profile 绝对路径兜底。失败返回 null（调用方降级）。
function loadNodePty() {
  const require = createRequire(import.meta.url);
  const candidates = [
    () => require("node-pty"),
    () => require(join(homedir(), ".dsh", "profiles", "node_modules", "node-pty")),
  ];
  for (const load of candidates) {
    try {
      return load();
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return null;
}

// 把 node-pty handle 包装成插件 handle 契约：{ output: Readable, write, terminate }
// （与 dsh-subprocess LocalTerminalHandle 同形状：output 流 + write + 终止；lib/index.js
// 的 WS 泵只消费 output 的 data/end/error 事件）。exited 幂等：kill 后 write 抛错、
// output 已 end，onExit 回调不再重复 end。
function wrapPty(pty) {
  const output = new PassThrough();
  let exited = false;
  pty.onData((data) => {
    if (!exited) output.write(Buffer.from(data, "utf8"));
  });
  pty.onExit(() => {
    if (exited) return;
    exited = true;
    output.end();
  });
  return {
    output,
    write: (data) => {
      if (exited) throw new Error("terminal process has exited");
      pty.write(data);
    },
    resize: (cols, rows) => {
      if (exited) return;
      try {
        pty.resize(cols, rows);
      } catch {
        /* conpty 已关闭等 */
      }
    },
    terminate: () => {
      if (exited) return;
      exited = true;
      try {
        pty.kill();
      } catch {
        /* 已退出 */
      }
      output.end();
    },
  };
}

// win32 shell 启动参数（真机验证 2026-08-16）：PowerShell 系无 -i 参数——
// powershell.exe 会把 -i 解析成 -InputFormat 的缩写并报"需要一个参量"；
// pwsh 7 支持 -i 但 -NoLogo -NoExit 两者通用。cmd.exe 直接交互，无需参数。
export function winShellArgs(shell) {
  const base = basename(shell ?? "").toLowerCase();
  if (base.includes("pwsh") || base.includes("powershell")) return ["-NoLogo", "-NoExit"];
  return [];
}

// win32 分支：直连 node-pty（绕开 dsh-subprocess 的 win32 限制）
async function createWindowsShellSession(deps, { cwd, rows, cols }) {
  const nodePty = deps.nodePty ?? (deps.loadNodePty ?? loadNodePty)();
  if (!nodePty) throw { code: "unsupported-platform", message: "Windows 控制台需要 node-pty（未找到）" };
  const shell = deps.shell ?? (deps.resolveShell ?? resolveWindowsShellPath)();
  if (!shell) throw { code: "shell-not-found", message: "未找到可用 shell（pwsh / powershell / cmd）" };
  const args = winShellArgs(shell);
  let pty;
  try {
    pty = nodePty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });
  } catch (err) {
    if (err && (err.code === "ENOENT" || /ENOENT|not found|找不到/i.test(String(err?.message ?? err)))) {
      throw { code: "shell-not-found", message: `shell 不可用: ${shell}` };
    }
    throw { code: "pty-spawn-failed", message: String(err?.message ?? err) };
  }
  const sessionId = deps.sessionId ?? `tty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const handle = wrapPty(pty);
  return {
    sessionId,
    handle,
    write: (data) => handle.write(data),
    kill: () => handle.terminate(),
  };
}

export async function createShellSession(deps, { cwd, rows = 80, cols = 24 } = {}) {
  if ((deps.platform ?? platform()) === "win32") {
    return createWindowsShellSession(deps, { cwd, rows, cols });
  }
  // POSIX：走 ctx.subprocess.spawnTerminal（M1 验证路径，不变）
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
