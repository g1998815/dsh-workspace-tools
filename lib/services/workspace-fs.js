// lib/services/workspace-fs.js
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const HIDDEN = new Set([".git", ".DS_Store"]);

function assertInside(cwd, relPath) {
  if (relPath === "" || relPath === ".") return cwd;
  const target = resolve(cwd, relPath);
  const rel = relative(cwd, target);
  if (rel.startsWith("..") || (rel !== "" && rel.startsWith(`..${sep}`))) {
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
    if (HIDDEN.has(name)) continue;
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
