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
