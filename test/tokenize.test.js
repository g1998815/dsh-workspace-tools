import test from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lib/tokenize.js";

test("tokenize: js 字符串/注释/关键字/数字", () => {
  const toks = tokenize('const s = "hi"; // note\nreturn 42;', "js");
  const cls = toks.map((t) => t.cls);
  assert.ok(cls.includes("kw"));
  assert.ok(cls.includes("str"));
  assert.ok(cls.includes("com"));
  assert.ok(cls.includes("num"));
  assert.ok(toks.some((t) => t.text === "const" && t.cls === "kw"));
});

test("tokenize: 未知语言不抛错且无关键字", () => {
  const toks = tokenize("hello world", "xyz");
  assert.ok(toks.length >= 1);
  assert.ok(toks.every((t) => t.cls === null));
});
