import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDir, resolvePath } from "../lib/services/workspace-fs.js";

test("listDir: returns entries with metadata and filters hidden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "a.txt"), "x");
    writeFileSync(join(dir, ".DS_Store"), "y");
    const { entries } = await listDir(dir, "");
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["a.txt", "sub"]);
    const a = entries.find((e) => e.name === "a.txt");
    assert.equal(a.isDir, false);
    assert.equal(a.size, 1);
    assert.equal(typeof a.mtime, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listDir: nested relative path works", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "z");
    const { entries } = await listDir(dir, "sub");
    assert.deepEqual(entries.map((e) => e.name), ["b.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listDir: missing dir rejects dir-not-found", async () => {
  await assert.rejects(listDir("/nonexistent-dshwt", ""), (e) => e.code === "dir-not-found");
});

test("listDir: path escape rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dshwt-fs-"));
  try {
    await assert.rejects(listDir(dir, "../.."), (e) => e.code === "path-escape");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePath: returns normalized absolute path", () => {
  const dir = "/tmp/dshwt/root";
  assert.equal(resolvePath(dir, "sub/a.txt").absolute, "/tmp/dshwt/root/sub/a.txt");
});
