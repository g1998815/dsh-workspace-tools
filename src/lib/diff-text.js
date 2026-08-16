// src/lib/diff-text.js —— before/after 两段文本的行级 diff，输出与 git parseDiff 完全同形状的 diff 行
// （{kind, text, oldLine, newLine}，text 带 +/-/␣ 前缀），交给 DiffLines 渲染，
// 达到「与会话变更 git 弹窗里 diff 呈现完全一致」的效果。
// 不引入外部 diff 库：用行级 LCS 表回溯出删/增/上下文三态。
//
// 行号语义与 git 相同：
//   · ctx 行：oldLine=newLines 各自在当前归档的 1 基行号
//   · del 行：oldLine=旧文件行号，newLine=null
//   · add 行：oldLine=null，newLine=新文件行号
// before===null（新增文件）→ 全 add；after===null（写后读失败）→ 全 del。

function lcsTable(before, after) {
  const n = before.length;
  const m = after.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Array(m + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (before[i] === after[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function splitLines(text) {
  if (text === null) return [];
  const lines = String(text).split("\n");
  // 末尾换行产生的最后一个空串去掉，避免多出一行「行尾空行」
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffText(before, after) {
  const oldL = splitLines(before);
  const newL = splitLines(after);
  const dp = lcsTable(oldL, newL);
  const n = oldL.length;
  const m = newL.length;
  const out = [];
  let oldNum = 1;
  let newNum = 1;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldL[i] === newL[j]) {
      out.push({ kind: "ctx", text: " " + oldL[i], oldLine: oldNum++, newLine: newNum++ });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] > dp[i + 1][j])) {
      out.push({ kind: "add", text: "+" + newL[j], oldLine: null, newLine: newNum++ });
      j++;
    } else {
      out.push({ kind: "del", text: "-" + oldL[i], oldLine: oldNum++, newLine: null });
      i++;
    }
  }
  return out;
}
