import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listChanges, getDiff } from "../lib/services/git-diff.js";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-git-"));
  const git = (args, cwd = dir) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, stdio: "pipe" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(dir, "a.txt"), "line1\nline2\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("listChanges: modified / untracked / deleted", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED\n");
    writeFileSync(join(repo.dir, "new.txt"), "hello\n");
    repo.git(["rm", "-q", "--cached", "a.txt"]); // 制造 staged 变更，验证合并进修改显示
    repo.git(["add", "a.txt"]);
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED2\n"); // staged + unstaged 同时存在
    const { changes } = await listChanges(repo.dir);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
    assert.equal(byPath["a.txt"].status, "M");
    assert.equal(byPath["a.txt"].untracked, false);
    assert.equal(byPath["new.txt"].status, "??");
    assert.equal(byPath["new.txt"].untracked, true);
  } finally {
    repo.cleanup();
  }
});

test("getDiff: tracked file shows unified diff including staged changes", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED\n");
    repo.git(["add", "a.txt"]);
    writeFileSync(join(repo.dir, "a.txt"), "line1\nCHANGED2\n");
    const { diff } = await getDiff(repo.dir, "a.txt", { untracked: false });
    assert.match(diff, /^diff --git/);
    assert.match(diff, /CHANGED2/); // 工作树 vs HEAD：含暂存差异
  } finally {
    repo.cleanup();
  }
});

test("getDiff: untracked file returns full-added view", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "new.txt"), "hello\nworld\n");
    const { diff } = await getDiff(repo.dir, "new.txt", { untracked: true });
    assert.match(diff, /--- \/dev\/null/);
    assert.match(diff, /\+\+\+ b\/new\.txt/);
    assert.match(diff, /\+hello/);
  } finally {
    repo.cleanup();
  }
});

test("listChanges: rename reports status R with oldPath", async () => {
  const repo = makeRepo();
  try {
    repo.git(["mv", "a.txt", "b.txt"]);
    const { changes } = await listChanges(repo.dir);
    assert.equal(changes.length, 1);
    const r = changes[0];
    assert.equal(r.status, "R");
    assert.equal(r.path, "b.txt");
    assert.equal(r.oldPath, "a.txt");
    assert.equal(r.untracked, false);
  } finally {
    repo.cleanup();
  }
});

test("listChanges: rename + edit normalizes composite status to R", async () => {
  const repo = makeRepo();
  try {
    repo.git(["mv", "a.txt", "b.txt"]);
    writeFileSync(join(repo.dir, "b.txt"), "line1\nline2\nEDITED\n");
    repo.git(["add", "b.txt"]);
    const { changes } = await listChanges(repo.dir);
    assert.equal(changes.length, 1); // 复合状态（RM/RD…）不得产生垃圾条目
    const r = changes[0];
    assert.equal(r.status, "R");
    assert.equal(r.path, "b.txt");
    assert.equal(r.oldPath, "a.txt");
    assert.equal(r.untracked, false);
  } finally {
    repo.cleanup();
  }
});

test("getDiff: untracked path escaping cwd rejects path-escape", async () => {
  const repo = makeRepo();
  const name = `outside-${Date.now()}.txt`;
  const outside = join(repo.dir, "..", name);
  try {
    writeFileSync(outside, "secret\n");
    await assert.rejects(getDiff(repo.dir, `../${name}`, { untracked: true }), (e) => e.code === "path-escape");
  } finally {
    rmSync(outside, { force: true });
    repo.cleanup();
  }
});

test("getDiff: non-repo dir rejects not-a-repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-norepo-"));
  try {
    await assert.rejects(getDiff(dir, "a.txt", { untracked: false }), (e) => e.code === "not-a-repo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
