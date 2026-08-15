// src/index.js —— client 插件入口（M2）
// 注册进 sidebar.workspaces（kind:single / scope:root）：
//   · priority: -1 遮蔽 shipped ui-workspace browser（单孔同 priority 重复注册会 throw，
//     数字越小越先渲染 —— dsh-client-ui-slots register 实测）
//   · root scope 拿不到 useInput/inputActions（session-scope 标准 prop）→ "发送到对话框"
//     经 conversation 服务直连 shell：ctx.get("conversation").input.shell(sessionId)
import { WorkspaceBrowser } from "./components/workspace-browser.js";
import { composeDraftInsert } from "./lib/insert.js";

export const name = "dsh-workspace-tools";
export const inject = ["slots", "sessions", "connection"];

export function apply(ctx) {
  ctx.slots.inject("sidebar.workspaces", () =>
    ctx.slots.register(
      {
        name: "sidebar.workspaces",
        priority: -1,
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
      WorkspaceBrowser,
    ),
  );
}

// 双保险：默认导出兼容按 default 解析的加载器（与 lib/index.js 同款）
export default { name, inject, apply };
