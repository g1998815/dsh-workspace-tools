// lib/services/git-diff.js
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { assertInside } from "./workspace-fs.js";

const execFileP = promisify(execFile);

function gitBase(cwd) {
  return ["-c", "core.quotepath=false"];
}

async function runGit(cwd, args) {
  try {
    const { stdout } = await execFileP("git", [...gitBase(cwd), ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    if (err.code === "ENOENT") throw { code: "git-not-found", message: "git 不在 PATH 中" };
    const stderr = String(err.stderr ?? "");
    // git >= 2.4x (含本机 Apple Git-155 / 2.50.1) 在非仓库目录执行 `git diff <rev> -- <file>`
    // 报 `error: Could not access 'HEAD'` 而非 `fatal: not a git repository`（后者仅出现在
    // `git status` 等命令）；两者都归类为 not-a-repo。
    if (/not a git repository/i.test(stderr) || /could not access 'HEAD'/i.test(stderr)) {
      throw { code: "not-a-repo", message: "目录不是 git 仓库" };
    }
    if (err.code === "EACCES" || /permission denied/i.test(stderr)) throw { code: "fs-permission", message: "权限不足" };
    throw { code: "git-error", message: stderr.trim() || err.message };
  }
}

function parsePorcelainZ(buf) {
  // -z 格式：普通项 `XY <path>\0`；重命名/复制为 `XY <new>\0<old>\0`（双路径）。
  // 复合状态（MM/AM…）归一化为首个状态码（index 优先，空格则取工作树码）。
  const items = [];
  const parts = buf.split("\0");
  for (let i = 0; i < parts.length; ) {
    const head = parts[i];
    if (!head) {
      i += 1;
      continue;
    }
    const xy = head.slice(0, 2).replace(/ /g, "");
    const path = head.slice(3); // "XY " 之后为路径（-z 模式原始字节、不引用）
    const untracked = xy === "??";
    if (xy.startsWith("R") || xy.startsWith("C")) {
      items.push({ status: xy[0], path, oldPath: parts[i + 1] ?? "", untracked: false });
      i += 2;
    } else {
      const status = untracked ? "??" : xy[0] || xy;
      items.push({ status, path, untracked });
      i += 1;
    }
  }
  return items;
}

export async function listChanges(cwd) {
  await stat(cwd).catch(() => {
    throw { code: "dir-not-found", message: `目录不存在: ${cwd}` };
  });
  const out = await runGit(cwd, ["status", "--porcelain", "-z"]);
  return { changes: parsePorcelainZ(out) };
}

export async function getDiff(cwd, file, { untracked = false } = {}) {
  if (untracked) {
    const target = assertInside(cwd, file);
    const content = await readFile(target, "utf8").catch((e) => {
      if (e.code === "ENOENT") throw { code: "file-not-found", message: `文件不存在: ${file}` };
      if (e.code === "EACCES") throw { code: "fs-permission", message: `无法读取: ${file}` };
      throw e;
    });
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const body = lines.map((l) => `+${l}`).join("\n");
    return { diff: `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}${lines.length ? "\n" : ""}` };
  }
  const out = await runGit(cwd, ["diff", "HEAD", "--", file]);
  if (out === "") {
    // HEAD 与工作树一致且文件存在 → 可能是"已删除但从未提交"之外的空 diff，保持原样
    return { diff: out };
  }
  return { diff: out };
}
