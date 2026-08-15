// lib/services/ws-frames.js —— RFC6455 client→server 帧解析（masked、16/64 位长、text/ping/pong/close、分片文本累积）
export function createFrameParser() {
  let buffer = Buffer.alloc(0);
  let pending = null; // {fin, payloads: []} 分片文本累积
  return { push };

  function push(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    const out = [];
    while (true) {
      if (buffer.length < 2) break;
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) break;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) break;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      // 协议要求 client→server 帧必须 masked；未 masked 整帧丢弃
      if (!masked) {
        buffer = buffer.subarray(offset + len);
        continue;
      }
      if (buffer.length < offset + 4 + len) break;
      const maskKey = buffer.subarray(offset, offset + 4);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = buffer[offset + 4 + i] ^ maskKey[i % 4];
      buffer = buffer.subarray(offset + 4 + len);
      if (opcode === 0x1 || opcode === 0x0) {
        // 文本帧或 continuation
        if (pending) pending.payloads.push(payload);
        else if (opcode === 0x1) pending = { fin, payloads: [payload] };
        else continue; // 孤立 continuation 忽略
        if (pending && fin) {
          out.push({ type: "text", fin: true, payload: Buffer.concat(pending.payloads).toString("utf8") });
          pending = null;
        }
      } else if (opcode === 0x8) {
        out.push({ type: "close", fin: true });
      } else if (opcode === 0x9) {
        out.push({ type: "ping", fin: true, payload });
      } else if (opcode === 0xa) {
        out.push({ type: "pong", fin: true, payload });
      }
      // 其他 opcode（binary/0x2 等）忽略
    }
    return out;
  }
}
