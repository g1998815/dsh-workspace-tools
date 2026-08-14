import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/ -> 插件根
const profiles = join(homedir(), ".dsh", "profiles");
const modulesDir = join(profiles, "node_modules");
const patchPath = join(profiles, "web", "cordis.patch.yml");
const linkTarget = join(modulesDir, "dsh-workspace-tools");

const PLUGIN_ID = "dsh-workspace-tools";
const PATCH_LINE = `    - id: ${PLUGIN_ID}\n      name: '${PLUGIN_ID}'\n`;

function linkPlugin() {
  if (existsSync(linkTarget)) {
    console.log(`[install] already linked: ${linkTarget}`);
    return;
  }
  mkdirSync(modulesDir, { recursive: true });
  if (process.platform === "win32") {
    // junction：免管理员权限
    execFileSync("cmd", ["/c", "mklink", "/J", linkTarget, pluginRoot], { stdio: "inherit" });
  } else {
    symlinkSync(pluginRoot, linkTarget, "dir");
  }
  console.log(`[install] linked: ${linkTarget} -> ${pluginRoot}`);
}

function patchCordis() {
  if (!existsSync(patchPath)) {
    throw new Error(`cordis.patch.yml not found: ${patchPath}`);
  }
  const orig = readFileSync(patchPath, "utf8");
  if (orig.includes(`id: ${PLUGIN_ID}`)) {
    console.log(`[install] patch already contains ${PLUGIN_ID}, skip`);
    return;
  }
  // 备份一次（仅当备份不存在时），然后追加 insert 块
  const bak = `${patchPath}.bak-before-workspace-tools`;
  if (!existsSync(bak)) writeFileSync(bak, orig);
  writeFileSync(patchPath, orig + `\n# ── dsh-workspace-tools 插件 ────────────────────────────────────────\n- insert:\n${PATCH_LINE}`);
  console.log(`[install] patched: ${patchPath}`);
}

linkPlugin();
patchCordis();
console.log("[install] done. Restart DSH service to load the plugin.");
