// test/file-preview.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { previewKind, TEXT_MAX_BYTES, IMAGE_MAX_BYTES } from "../lib/services/file-preview.js";

test("previewKind: 常见文本后缀", () => {
  for (const n of ["a.txt", "index.js", "app.ts", "page.jsx", "c.tsx", "README.md", "pkg.json", "Main.java", "main.py", "a.c", "a.h", "a.cpp", "a.go", "a.rs", "ci.yml", "a.yaml", "a.xml", "index.html", "style.css", "run.sh", "a.sql", "a.toml", "a.ini", "a.log", "a.csv", "A.TXT"]) {
    assert.equal(previewKind(n), "text", n);
  }
});

test("previewKind: 常见图片后缀", () => {
  for (const n of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.svg", "a.bmp", "a.ico", "A.PNG"]) {
    assert.equal(previewKind(n), "image", n);
  }
});

test("previewKind: 无后缀/未知后缀/目录 → null", () => {
  assert.equal(previewKind("README"), null);
  assert.equal(previewKind("a.xyz"), null);
  assert.equal(previewKind("noext."), null);
  assert.equal(previewKind(""), null);
  assert.equal(previewKind("dir/sub"), null);
});

test("常量: 大小上限合理", () => {
  assert.equal(TEXT_MAX_BYTES, 256 * 1024);
  assert.equal(IMAGE_MAX_BYTES, 5 * 1024 * 1024);
});
