// scripts/smoke.mjs —— M1 验收：命令行验证三服务可调用（不依赖 DSH 运行时）
import { listChanges, getDiff } from "../lib/services/git-diff.js";
import { listDir, resolvePath } from "../lib/services/workspace-fs.js";
import { detectShell } from "../lib/services/console.js";

const cwd = process.cwd();
console.log(`[smoke] cwd = ${cwd}`);

try {
  const { changes } = await listChanges(cwd);
  console.log(`[smoke] gitDiff.listChanges -> ${changes.length} change(s)`);
  for (const c of changes.slice(0, 5)) console.log(`  ${c.status}  ${c.path}`);
  if (changes.length) {
    const first = changes[0];
    const { diff } = await getDiff(cwd, first.path, { untracked: first.untracked });
    console.log(`[smoke] gitDiff.getDiff(${first.path}) -> ${diff.split("\n").length} lines`);
  }
} catch (e) {
  console.log(`[smoke] gitDiff: ${e.code ?? "error"} — ${e.message ?? e}`);
}

try {
  const { entries } = await listDir(cwd, "");
  console.log(`[smoke] workspaceFs.listDir -> ${entries.length} entries`);
  console.log(`[smoke] workspaceFs.resolvePath("") -> ${resolvePath(cwd, "").absolute}`);
} catch (e) {
  console.log(`[smoke] workspaceFs: ${e.code ?? "error"} — ${e.message ?? e}`);
}

console.log(`[smoke] console.detectShell -> ${detectShell()}`);
console.log("[smoke] done");
