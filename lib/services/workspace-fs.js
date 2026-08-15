// lib/services/workspace-fs.js
import { readdir, stat } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

// 统一 dotfile 策略：隐藏所有以 "." 开头的条目（与 host RPC 路径 ctx.fs 的过滤一致；
// spec §5.2 的 .git/.DS_Store 是最低要求，全 dotfile 隐藏为标准浏览器行为）
export function isHidden(name) {
  return name.startsWith(".");
}

export function assertInside(cwd, relPath) {
  if (relPath === "" || relPath === ".") return cwd;
  const target = resolve(cwd, relPath);
  if (parse(target).root !== parse(cwd).root) {
    throw { code: "path-escape", message: "路径越出工作区" };
  }
  const rel = relative(cwd, target);
  if (rel !== "" && (rel === ".." || rel.startsWith(`..${sep}`))) {
    throw { code: "path-escape", message: "路径越出工作区" };
  }
  return target;
}

export async function listDir(cwd, relPath = "") {
  const target = assertInside(cwd, relPath);
  const st = await stat(target).catch((e) => {
    if (e.code === "ENOENT") throw { code: "dir-not-found", message: `目录不存在: ${target}` };
    if (e.code === "EACCES") throw { code: "fs-permission", message: `无法访问: ${target}` };
    throw e;
  });
  if (!st.isDirectory()) throw { code: "dir-not-found", message: `不是目录: ${target}` };
  const names = await readdir(target).catch((e) => {
    if (e.code === "EACCES") throw { code: "fs-permission", message: `无法读取: ${target}` };
    throw e;
  });
  const entries = [];
  for (const name of names) {
    if (isHidden(name)) continue;
    const full = join(target, name);
    let e;
    try {
      e = await stat(full);
    } catch {
      continue; // 竞态删除等，跳过
    }
    entries.push({ name, isDir: e.isDirectory(), size: e.size, mtime: e.mtimeMs });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { entries };
}

export function resolvePath(cwd, relPath = "") {
  return { absolute: resolve(cwd, relPath) };
}
