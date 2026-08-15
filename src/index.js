// src/index.js —— client 插件入口（M2，2026-08-15 用户改版）
// 注册进 shell.overlay（list 孔 / scope:root，ui-layout 声明的浮层）：右侧独立工具侧边栏，
// 可点击收起/展开；不再注册 sidebar.workspaces（shipped 工作区浏览器恢复原样，互不重合）。
//   · root scope 拿不到 useInput/inputActions（session-scope 标准 prop）→ "发送到对话框"
//     经 conversation 服务直连 shell：ctx.get("conversation").input.shell(sessionId)
import { RightSidebar } from "./components/workspace-browser.js";
import { composeDraftInsert } from "./lib/insert.js";

export const name = "dsh-workspace-tools";
export const inject = ["slots", "sessions", "connection"];

export function apply(ctx) {
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-workspace-tools",
        inject: () => ({
          rpc: ctx.connection.rpc,
          openSession: (id) => ctx.sessions.open(id),
          insertIntoComposer: (sessionId, relPath) => {
            const conversation = ctx.get("conversation");
            if (!conversation) return false;
            try {
              const shell = conversation.input.shell(sessionId);
              const { draft } = shell.state.getSnapshot();
              shell.actions.setDraft(composeDraftInsert(draft, relPath));
              return true;
            } catch {
              return false;
            }
          },
        }),
      },
      RightSidebar,
    ),
  );
}

// 双保险：默认导出兼容按 default 解析的加载器（与 lib/index.js 同款）
export default { name, inject, apply };
