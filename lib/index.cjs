// CJS 入口：为按 require()/main 解析的加载器提供 module.exports 兜底。
// 内部复用 ESM 实现（Node >= 22.12 支持 require(ESM)），透传命名导出 + default。
// 这样无论加载器走 import()、require() 还是旧式 main 解析，拿到的对象都带 apply。
"use strict";
module.exports = require("./index.js");
