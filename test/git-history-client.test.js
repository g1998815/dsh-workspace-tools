// test/git-history-client.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "../src/lib/git-history-client.js";
test("relativeTime: 时间档位", () => {
  const now = Date.parse("2026-08-15T12:00:00Z");
  assert.equal(relativeTime("2026-08-15T11:59:30Z", now), "刚刚");
  assert.equal(relativeTime("2026-08-15T11:55:00Z", now), "5 分钟前");
  assert.equal(relativeTime("2026-08-15T09:00:00Z", now), "3 小时前");
  assert.equal(relativeTime("2026-08-01T00:00:00Z", now), "14 天前");
  assert.equal(relativeTime("not-a-date", now), "");
});
