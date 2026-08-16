import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { detectShell, createShellSession, resolveWindowsShellPath, windowsShellCandidates, winShellArgs } from "../lib/services/console.js";

test("detectShell: respects SHELL env on non-win32", () => {
  assert.equal(detectShell({ platform: "darwin", env: { SHELL: "/bin/bash" } }), "/bin/bash");
  assert.equal(detectShell({ platform: "linux", env: {} }), "/bin/zsh");
});

test("detectShell: win32 returns pwsh first (powershell.exe/cmd fallback is M1 probe-order only)", () => {
  assert.equal(detectShell({ platform: "win32", env: {} }), "pwsh");
});

test("createShellSession: calls spawnTerminal with shell argv, cwd and fixed size", async () => {
  const calls = [];
  const fakeHandle = {
    output: Readable.from(["hi"]),
    write: (d) => calls.push(["write", d]),
    terminate: () => calls.push(["terminate"]),
  };
  const deps = {
    platform: "linux", // M5-W：win32 走 node-pty 分支，POSIX 用例显式声明平台
    shell: "/bin/zsh",
    sessionId: "s1",
    spawnTerminal: async (opts) => {
      calls.push(["spawn", opts]);
      return fakeHandle;
    },
  };
  const s = await createShellSession(deps, { cwd: "/tmp", rows: 40, cols: 120 });
  assert.equal(s.sessionId, "s1");
  assert.deepEqual(calls.find(([k]) => k === "spawn")[1].argv, ["/bin/zsh", "-i"]);
  assert.equal(calls.find(([k]) => k === "spawn")[1].cwd, "/tmp");
  assert.equal(calls.find(([k]) => k === "spawn")[1].rows, 40);
  assert.equal(calls.find(([k]) => k === "spawn")[1].cols, 120);
  assert.equal(calls.find(([k]) => k === "spawn")[1].graceMs, 3000);
  s.write("x");
  s.kill();
  assert.deepEqual(calls.filter(([k]) => k !== "spawn"), [["write", "x"], ["terminate"]]);
});

test("createShellSession: ENOENT maps to shell-not-found", async () => {
  const deps = {
    platform: "linux", // M5-W：POSIX 分支显式声明平台
    shell: "/bin/nope",
    spawnTerminal: async () => {
      const err = new Error("spawn /bin/nope ENOENT");
      err.code = "ENOENT";
      throw err;
    },
  };
  await assert.rejects(createShellSession(deps, { cwd: "/tmp" }), (e) => e.code === "shell-not-found");
});

// ── M5-W：win32 直连 node-pty（绕开 dsh-subprocess 的 win32 限制）──
function makeFakePty(calls) {
  const listeners = {};
  const fake = {
    spawn: (file, args, opts) => {
      calls.push(["spawn", file, args, opts]);
      const pty = {
        pid: 4242,
        onData: (cb) => { listeners.data = cb; },
        onExit: (cb) => { listeners.exit = cb; },
        write: (d) => calls.push(["write", d]),
        resize: (cols, rows) => calls.push(["resize", cols, rows]),
        kill: () => calls.push(["kill"]),
        emitData: (s) => listeners.data?.(s),
        emitExit: (o) => listeners.exit?.(o),
      };
      fake.last = pty;
      return pty;
    },
  };
  return fake;
}

test("resolveWindowsShellPath: pwsh7 -> powershell -> cmd probe order (M5-W)", () => {
  const exists = (p) => p.endsWith("cmd.exe");
  assert.equal(resolveWindowsShellPath({ exists }), windowsShellCandidates().at(-1));
  assert.equal(resolveWindowsShellPath({ exists: () => false }), null);
});

test("winShellArgs: powershell family gets -NoLogo -NoExit, cmd none (M5-W)", () => {
  // 真机验证：powershell.exe 无 -i（会被解析成 -InputFormat 缩写报错）
  assert.deepEqual(winShellArgs("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoLogo", "-NoExit"]);
  assert.deepEqual(winShellArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), ["-NoLogo", "-NoExit"]);
  assert.deepEqual(winShellArgs("C:\\Windows\\System32\\cmd.exe"), []);
});

test("createShellSession: win32 spawns node-pty directly, handle delegates (M5-W)", async () => {
  const calls = [];
  const fakeNodePty = makeFakePty(calls);
  const s = await createShellSession(
    { platform: "win32", nodePty: fakeNodePty, shell: "C:\\Windows\\System32\\cmd.exe", sessionId: "s1" },
    { cwd: "C:\\ws", rows: 40, cols: 120 },
  );
  assert.equal(s.sessionId, "s1");
  assert.deepEqual(calls[0], ["spawn", "C:\\Windows\\System32\\cmd.exe", [], {
    name: "xterm-256color", cols: 120, rows: 40, cwd: "C:\\ws", env: { ...process.env, TERM: "xterm-256color" },
  }]);
  assert.equal(typeof s.handle.output.pipe, "function"); // Readable 流形状（WS 泵消费）
  s.write("x");
  s.handle.resize(100, 30);
  s.kill();
  assert.deepEqual(calls.slice(1), [["write", "x"], ["resize", 100, 30], ["kill"]]);
});

test("createShellSession: win32 pty output bridges to handle.output (M5-W)", async () => {
  const calls = [];
  const fakeNodePty = makeFakePty(calls);
  const s = await createShellSession(
    { platform: "win32", nodePty: fakeNodePty, shell: "cmd" },
    { cwd: "C:\\ws" },
  );
  // 取回 pty 实例以触发事件
  const chunks = [];
  let ended = false;
  s.handle.output.on("data", (c) => chunks.push(c.toString("utf8")));
  s.handle.output.on("end", () => { ended = true; });
  const pty = fakeNodePty.last;
  pty.emitData("hello");
  pty.emitExit({ exitCode: 0, signal: undefined });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(chunks, ["hello"]);
  assert.equal(ended, true);
  // exited 后 write 拒绝、kill 幂等（不再调用 pty.kill）
  const before = calls.length;
  assert.throws(() => s.write("y"), /exited/);
  s.kill();
  assert.equal(calls.length, before);
});

test("createShellSession: win32 without node-pty throws unsupported-platform (M5-W)", async () => {
  await assert.rejects(
    createShellSession({ platform: "win32", nodePty: null, loadNodePty: () => null }, { cwd: "C:\\ws" }),
    (e) => e.code === "unsupported-platform",
  );
});

test("createShellSession: win32 without shell throws shell-not-found (M5-W)", async () => {
  await assert.rejects(
    createShellSession(
      { platform: "win32", nodePty: makeFakePty([]), resolveShell: () => null },
      { cwd: "C:\\ws" },
    ),
    (e) => e.code === "shell-not-found",
  );
});
