import test from "node:test";
import assert from "node:assert/strict";
import { filterRows } from "../src/lib/tree-filter.js";

test("filterRows: 按 name/path 过滤，空 q 原样", () => {
  const rows = [
    { name: "a.js", path: "src/a.js" },
    { name: "b.md", path: "docs/b.md" },
    { name: "lib", path: "lib" },
  ];
  assert.equal(filterRows(rows, "A.JS").length, 1);
  assert.equal(filterRows(rows, "md").length, 1);
  assert.equal(filterRows(rows, "src").length, 1);
  assert.equal(filterRows(rows, "").length, 3);
  assert.equal(filterRows(rows, "zzz").length, 0);
});

test("filterRows: 匹配 rel（真实行形状 rel/name/isDir）", () => {
  const rows = [
    { name: "src", rel: "src", isDir: true },
    { name: "a.js", rel: "src/a.js", isDir: false },
    { name: "lib", rel: "lib", isDir: true },
  ];
  assert.equal(filterRows(rows, "src").length, 2); // dir + 其子文件（rel 含 src/）
  assert.equal(filterRows(rows, "a.js").length, 1);
  assert.equal(filterRows(rows, "").length, 3);
});
