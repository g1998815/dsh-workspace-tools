// test/diff-text.test.js —— before/after → git 同款 diff 行（与 parseDiff 同形状）
import test from "node:test";
import assert from "node:assert/strict";
import { diffText } from "../src/lib/diff-text.js";

test("diffText: 简单替换（ctx/del/add + 行号累计）", () => {
  const lines = diffText("a\nold\nc", "a\nnew\nc");
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
    [
      ["ctx", " a", 1, 1],
      ["del", "-old", 2, null],
      ["add", "+new", null, 2],
      ["ctx", " c", 3, 3],
    ],
  );
});

test("diffText: 前置插入（纯 add，oldLine 全 null）", () => {
  const lines = diffText("b", "a\nb");
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
    [
      ["add", "+a", null, 1],
      ["ctx", " b", 1, 2],
    ],
  );
});

test("diffText: 删除（纯 del，newLine 全 null）", () => {
  const lines = diffText("a\nb", "b");
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
    [
      ["del", "-a", 1, null],
      ["ctx", " b", 2, 1],
    ],
  );
});

test("diffText: 新增文件（before=null → 全 add，自 1 开始）", () => {
  const lines = diffText(null, "x\ny");
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
    [
      ["add", "+x", null, 1],
      ["add", "+y", null, 2],
    ],
  );
});

test("diffText: after=null → 全 del（自 1 开始）", () => {
  const lines = diffText("x\ny", null);
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
    [
      ["del", "-x", 1, null],
      ["del", "-y", 2, null],
    ],
  );
});

test("diffText: 空字符串视为无行（与空内容一致）", () => {
  assert.deepEqual(diffText("", ""), []);
  assert.deepEqual(diffText("", "a"), [{ kind: "add", text: "+a", oldLine: null, newLine: 1 }]);
});

test("diffText: 末尾换行不产生多余行", () => {
  const lines = diffText("a\n", "a\n");
  assert.deepEqual(lines, [{ kind: "ctx", text: " a", oldLine: 1, newLine: 1 }]);
});

test("diffText: 长文本 LCS 不溢出（10k 行）", () => {
  const before = Array.from({ length: 10000 }, (_, i) => `line-${i}`);
  const after = [...before.slice(0, 5000), "inserted", ...before.slice(5000)];
  const lines = diffText(before.join("\n"), after.join("\n"));
  assert.equal(lines.length, 10001); // ctx×5000 + add×1 + ctx×5000
  assert.ok(lines.every((l) => l.oldLine === null || l.oldLine >= 1 || l.newLine === null || l.newLine >= 1));
});