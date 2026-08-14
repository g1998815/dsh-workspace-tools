import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { detectShell, createShellSession } from "../lib/services/console.js";

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
    shell: "/bin/nope",
    spawnTerminal: async () => {
      const err = new Error("spawn /bin/nope ENOENT");
      err.code = "ENOENT";
      throw err;
    },
  };
  await assert.rejects(createShellSession(deps, { cwd: "/tmp" }), (e) => e.code === "shell-not-found");
});
