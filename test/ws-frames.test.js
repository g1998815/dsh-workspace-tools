// test/ws-frames.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createFrameParser } from "../lib/services/ws-frames.js";

// client→server 帧必须 masked：构造一个 masked 文本帧
function maskedText(text, maskKey = [1, 2, 3, 4]) {
  const payload = Buffer.from(text, "utf8");
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4];
  const head = Buffer.from([0x81, 0x80 | payload.length, ...maskKey]);
  return Buffer.concat([head, masked]);
}

test("parse: 单帧 masked 文本（<126）", () => {
  const p = createFrameParser();
  const out = p.push(maskedText('{"sessionId":"tty-1"}'));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "text");
  assert.equal(out[0].fin, true);
  assert.equal(out[0].payload, '{"sessionId":"tty-1"}');
});

test("parse: 缓冲跨块（帧被拆成两段 push）", () => {
  const p = createFrameParser();
  const buf = maskedText("hello world");
  const a = p.push(buf.subarray(0, 5));
  assert.equal(a.length, 0);
  const b = p.push(buf.subarray(5));
  assert.equal(b.length, 1);
  assert.equal(b[0].payload, "hello world");
});

test("parse: 126 长度（≥126 字节）", () => {
  const p = createFrameParser();
  const text = "x".repeat(200);
  const payload = Buffer.from(text, "utf8");
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ (i % 4 + 1);
  const head = Buffer.alloc(8);
  head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2);
  for (let i = 0; i < 4; i++) head[4 + i] = i + 1;
  const out = p.push(Buffer.concat([head, masked]));
  assert.equal(out.length, 1);
  assert.equal(out[0].payload, text);
});

test("parse: 不 masked 的帧被丢弃", () => {
  const p = createFrameParser();
  const out = p.push(Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63])); // 未 masked 文本 "abc"
  assert.equal(out.length, 0);
});

test("parse: 多帧一次 push 全部产出", () => {
  const p = createFrameParser();
  const out = p.push(Buffer.concat([maskedText("a"), maskedText("b")]));
  assert.deepEqual(out.map((o) => o.payload), ["a", "b"]);
});

test("parse: close 帧", () => {
  const p = createFrameParser();
  const out = p.push(Buffer.from([0x88, 0x82, 1, 2, 3, 4, 0x03 ^ 1, 0xe8 ^ 2])); // masked close + 2 字节载荷
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "close");
});
