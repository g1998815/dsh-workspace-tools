// test/git-history.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { logCommits, commitAll, resetTo, currentBranch, showCommitFiles, showCommitFile } from "../lib/services/git-history.js";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-gh-"));
  const git = (args, cwd = dir) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, stdio: "pipe" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(["add", "."]);
  git(["commit", "-qm", "first commit"]);
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("logCommits: 新到旧排序，含完整字段", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "one\ntwo\n");
    repo.git(["add", "."]);
    repo.git(["commit", "-qm", "second commit"]);
    const { commits } = await logCommits(repo.dir, { limit: 10 });
    assert.equal(commits.length, 2);
    assert.equal(commits[0].subject, "second commit");
    assert.match(commits[0].hash, /^[0-9a-f]{40}$/);
    assert.equal(commits[0].shortHash, commits[0].hash.slice(0, 7));
    assert.equal(commits[0].author, "t");
    assert.ok(!Number.isNaN(Date.parse(commits[0].date)));
  } finally {
    repo.cleanup();
  }
});

test("commitAll: 全部提交", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "b.txt"), "hi\n");
    writeFileSync(join(repo.dir, "a.txt"), "one\nchanged\n");
    const { hash } = await commitAll(repo.dir, "commit all");
    assert.match(hash, /^[0-9a-f]{40}$/);
    const { commits } = await logCommits(repo.dir);
    assert.equal(commits[0].subject, "commit all");
  } finally {
    repo.cleanup();
  }
});

test("commitAll: 指定文件只提交选中", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "b.txt"), "hi\n");
    writeFileSync(join(repo.dir, "c.txt"), "c\n");
    await commitAll(repo.dir, "commit b", ["b.txt"]);
    const out = execFileSync("git", ["-c", "core.quotepath=false", "status", "--porcelain"], { cwd: repo.dir, encoding: "utf8" });
    assert.match(out, /\?\? c\.txt/);
  } finally {
    repo.cleanup();
  }
});

test("commitAll: 无可提交 → nothing-to-commit", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(commitAll(repo.dir, "noop"), (e) => e.code === "nothing-to-commit");
  } finally {
    repo.cleanup();
  }
});

test("resetTo: mixed 回退保留工作区改动", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "one\ntwo\n");
    repo.git(["add", "."]);
    repo.git(["commit", "-qm", "second"]);
    const before = await logCommits(repo.dir);
    await resetTo(repo.dir, before.commits[1].hash);
    const after = await logCommits(repo.dir);
    assert.equal(after.commits.length, 1);
    assert.equal(after.commits[0].subject, "first commit");
    const content = readFileSync(join(repo.dir, "a.txt"), "utf8");
    assert.match(content, /two/);
  } finally {
    repo.cleanup();
  }
});

test("resetTo: 非法 target 拒绝", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(resetTo(repo.dir, "abc;rm -rf"), (e) => e.code === "invalid-target");
    await assert.rejects(resetTo(repo.dir, "zzz"), (e) => e.code === "invalid-target");
  } finally {
    repo.cleanup();
  }
});

test("currentBranch: 提交后返回分支名，init 未提交时为空", async () => {
  const repo = makeRepo();
  try {
    const { branch } = await currentBranch(repo.dir);
    assert.ok(branch.length > 0);
  } finally {
    repo.cleanup();
  }
});

test("logCommits: 零提交仓库返回空历史（unborn HEAD）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-gh-"));
  try {
    execFileSync("git", ["-c", "core.quotepath=false", "init", "-q"], { cwd: dir });
    const { commits } = await logCommits(dir);
    assert.deepEqual(commits, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("showCommitFiles: 提交的文件列表（M/A，rename 取新路径）", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "b.txt"), "hi\n");
    repo.git(["add", "b.txt"]);
    repo.git(["commit", "-qm", "add b"]);
    writeFileSync(join(repo.dir, "a.txt"), "one\nchanged\n");
    repo.git(["add", "a.txt"]);
    repo.git(["commit", "-qm", "modify a"]);
    const { commits } = await logCommits(repo.dir);
    const { files } = await showCommitFiles(repo.dir, commits[0].hash); // modify a
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.status]));
    assert.equal(byPath["a.txt"], "M");
    const { files: files2 } = await showCommitFiles(repo.dir, commits[1].hash); // add b
    assert.deepEqual(files2.map((f) => [f.status, f.path]), [["A", "b.txt"]]);
  } finally {
    repo.cleanup();
  }
});

test("showCommitFiles: 非法 target 拒绝", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(showCommitFiles(repo.dir, "abc;rm"), (e) => e.code === "invalid-target");
  } finally {
    repo.cleanup();
  }
});

test("showCommitFile: 返回该文件 unified diff", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "a.txt"), "one\nchanged\n");
    repo.git(["add", "a.txt"]);
    repo.git(["commit", "-qm", "modify a"]);
    const { commits } = await logCommits(repo.dir);
    const { diff } = await showCommitFile(repo.dir, commits[0].hash, "a.txt");
    assert.match(diff, /^diff --git/);
    assert.match(diff, /\+changed/);
  } finally {
    repo.cleanup();
  }
});

test("showCommitFile: 非法 file 拒绝（绝对/越界/空）", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(showCommitFile(repo.dir, "HEAD", "/etc/passwd"), (e) => e.code === "invalid-file");
    await assert.rejects(showCommitFile(repo.dir, "HEAD", "../x"), (e) => e.code === "invalid-file");
    await assert.rejects(showCommitFile(repo.dir, "HEAD", ""), (e) => e.code === "invalid-file");
  } finally {
    repo.cleanup();
  }
});

test("showCommitFile: 非法 target 拒绝", async () => {
  const repo = makeRepo();
  try {
    await assert.rejects(showCommitFile(repo.dir, "zzz", "a.txt"), (e) => e.code === "invalid-target");
  } finally {
    repo.cleanup();
  }
});
