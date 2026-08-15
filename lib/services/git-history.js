// lib/services/git-history.js —— git 历史/提交/安全回退/分支（复用 git-diff.js 的 runGit）
import { stat } from "node:fs/promises";
import { runGit } from "./git-diff.js";

export const TARGET_RE = /^[0-9a-f]{4,40}$/;

async function ensureRepo(cwd) {
  await stat(cwd).catch(() => {
    throw { code: "dir-not-found", message: `目录不存在: ${cwd}` };
  });
}

export async function logCommits(cwd, { limit = 50 } = {}) {
  await ensureRepo(cwd);
  try {
    const out = await runGit(cwd, ["log", `-n ${limit}`, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"]);
    const commits = out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [hash, shortHash, subject, author, date] = line.split("\x1f");
        return { hash, shortHash, subject, author, date };
      });
    return { commits };
  } catch (err) {
    // 零提交仓库：git log fatal（unborn HEAD）→ 空历史（新仓库是常见场景，不能让整个变更页签挂掉）
    if (err && /does not have any commits/i.test(String(err.message))) return { commits: [] };
    throw err;
  }
}

export async function commitAll(cwd, message, files) {
  await ensureRepo(cwd);
  if (files && files.length > 0) {
    await runGit(cwd, ["add", "--", ...files]);
  } else {
    await runGit(cwd, ["add", "-A"]);
  }
  const names = await runGit(cwd, ["diff", "--cached", "--name-only"]);
  if (names.trim() === "") throw { code: "nothing-to-commit", message: "没有可提交的变更" };
  const out = await runGit(cwd, ["commit", "-m", message]);
  const m = /[0-9a-f]{40}/.exec(out);
  const hash = m ? m[0] : (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
  return { hash };
}

export async function resetTo(cwd, target) {
  await ensureRepo(cwd);
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw { code: "invalid-target", message: `非法回退目标: ${target}` };
  }
  await runGit(cwd, ["reset", "--mixed", target]);
  return { ok: true };
}

export async function currentBranch(cwd) {
  await ensureRepo(cwd);
  const out = await runGit(cwd, ["branch", "--show-current"]);
  return { branch: out.trim() };
}

// 提交详情（只读）：文件列表 + 单文件 diff
export async function showCommitFiles(cwd, target) {
  await ensureRepo(cwd);
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw { code: "invalid-target", message: `非法提交目标: ${target}` };
  }
  const out = await runGit(cwd, ["show", "--format=", "--name-status", target]);
  const files = out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const parts = line.split("\t");
      // `A\tpath` / `M\tpath` / `D\tpath` / `R100\told\tnew` / `C100\told\tnew`
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
  return { files };
}

export async function showCommitFile(cwd, target, file) {
  await ensureRepo(cwd);
  if (typeof file !== "string" || file === "" || file.startsWith("/") || file.includes("..")) {
    throw { code: "invalid-file", message: `非法文件路径: ${file}` };
  }
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw { code: "invalid-target", message: `非法提交目标: ${target}` };
  }
  const diff = await runGit(cwd, ["show", "--format=", target, "--", file]);
  return { diff };
}
