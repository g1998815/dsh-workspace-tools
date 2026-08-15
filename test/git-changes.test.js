// test/git-changes.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChanges, statusLabel, groupByDir, visibleRows, parseDiff } from "../src/lib/git-changes.js";

test("normalizeChanges: 拆分 dir/base 并保留状态", () => {
  const out = normalizeChanges([
    { status: "M", path: "src/a.js", untracked: false },
    { status: "??", path: "new.txt", untracked: true },
    { status: "D", path: "deep/nested/b.ts", untracked: false },
  ]);
  assert.deepEqual(out, [
    { status: "M", untracked: false, path: "src/a.js", dir: "src", base: "a.js" },
    { status: "??", untracked: true, path: "new.txt", dir: "", base: "new.txt" },
    { status: "D", untracked: false, path: "deep/nested/b.ts", dir: "deep/nested", base: "b.ts" },
  ]);
  assert.deepEqual(normalizeChanges(undefined), []);
});

test("statusLabel: 常用状态中文", () => {
  assert.equal(statusLabel("??"), "未跟踪");
  assert.equal(statusLabel("M"), "修改");
  assert.equal(statusLabel("D"), "删除");
  assert.equal(statusLabel("A"), "新增");
  assert.equal(statusLabel("R"), "重命名");
  assert.equal(statusLabel("X"), "X");
});

test("groupByDir: 按目录分组且保持顺序", () => {
  const changes = normalizeChanges([
    { status: "M", path: "a.js" },
    { status: "??", path: "src/b.js" },
    { status: "M", path: "src/c.js" },
    { status: "D", path: "root.txt" },
  ]);
  const groups = groupByDir(changes);
  assert.deepEqual(groups.map((g) => g.dir), ["", "src"]);
  assert.deepEqual(groups[1].items.map((i) => i.base), ["b.js", "c.js"]);
});

test("visibleRows: 折叠组只出 dir 行", () => {
  const groups = groupByDir(normalizeChanges([
    { status: "M", path: "a.js" },
    { status: "??", path: "src/b.js" },
  ]));
  const open = visibleRows(groups, new Set());
  assert.deepEqual(open.map((r) => [r.kind, r.dir ?? r.base]), [["dir", ""], ["file", "a.js"], ["dir", "src"], ["file", "b.js"]]);
  const closed = visibleRows(groups, new Set(["src"]));
  assert.deepEqual(closed.map((r) => [r.kind, r.dir ?? r.base]), [["dir", ""], ["file", "a.js"], ["dir", "src"]]);
});

test("parseDiff: 标准 unified diff（hunk 行号累计 + 分类）", () => {
  const lines = parseDiff(
    "diff --git a/src/a.js b/src/a.js\n" +
      "index 111..222 100644\n" +
      "--- a/src/a.js\n" +
      "+++ b/src/a.js\n" +
      "@@ -10,3 +10,4 @@\n" +
      " context\n" +
      "-old line\n" +
      "+new line\n" +
      " tail\n",
  );
  assert.deepEqual(lines.map((l) => l.kind), ["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add", "ctx"]);
  assert.deepEqual(lines[5], { kind: "ctx", text: " context", oldLine: 10, newLine: 10 });
  assert.deepEqual(lines[6], { kind: "del", text: "-old line", oldLine: 11, newLine: null });
  assert.deepEqual(lines[7], { kind: "add", text: "+new line", oldLine: null, newLine: 11 });
  assert.deepEqual(lines[8], { kind: "ctx", text: " tail", oldLine: 12, newLine: 12 });
});

test("parseDiff: 未跟踪全新增视图（/dev/null 头）", () => {
  const lines = parseDiff("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n");
  assert.deepEqual(lines.map((l) => l.kind), ["meta", "meta", "hunk", "add", "add"]);
  assert.deepEqual(lines[3], { kind: "add", text: "+hello", oldLine: null, newLine: 1 });
  assert.deepEqual(lines[4], { kind: "add", text: "+world", oldLine: null, newLine: 2 });
});

test("parseDiff: 空文本", () => {
  assert.deepEqual(parseDiff(""), []);
});
