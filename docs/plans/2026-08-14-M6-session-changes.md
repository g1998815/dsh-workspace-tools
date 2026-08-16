# M6 会话变更（Session Changes）实现计划（dsh-workspace-tools）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **仓库**：`/Volumes/data/code/dsh-workspace-tools`，分支 `main`，HEAD = `766e39f`。
> **需求（用户 2026-08-16）**：在"变更"页签旁新增 **"会话变更"** tab——按"会话 → 步骤"维度记录 dsh 修改过的文件，支持逐条查看（before/after）与 **采用/撤回**；**与 git 完全解耦**（不阻塞 git 提交；撤回动作作为新修改反映到 git 变更；采用与否不影响 git）。

**Goal:** host 捕获每次 write/edit 工具的文件修改（before/after 快照 + 会话/步骤归属），client 新增"会话变更"tab 展示与采用/撤回，全量测试通过，推送 GitHub。

## 技术基础（已调研确认，2026-08-16）

- **捕获事件**（host 侧 `ctx.on`/`ctx.waterfall`，均为官方事件）：
  - `fs/write-intent`（waterfall）：write 工具写前；`(target, actor, next)`，actor 即 exec（含 `agent.session`）。
  - `fs/edit-intent`（waterfall）：edit 工具编辑前；同签名。
  - `tools/result`（emit）：工具执行后；`(exec, result)`，exec 含 `{callId, name, arguments, agent}`。
- **归属**：`actor.agent.session.id` = sessionId；`session.header.cwd` = 工作区；"步骤" = 每会话内自增序号（host 维护，不依赖内部 turn/step）。
- **before 捕获**：write/edit-intent 监听器内、`next()` 之前读 `ctx.fs.readText(target)`（不存在 → before=null 表示新增文件）。
- **after 捕获**：`tools/result` 里按 `exec.callId` 匹配 pending 记录，重读 `readText` 或从 `exec.arguments`（write 的 `content` / edit 的 `new_string` 应用结果）取新内容。
- **waterfall 透传**：监听器必须 `return next()`（官方 policy 同模式），不得吞掉决策。
- **ctx.fs 无 delete API**（官方"Twelve primitives only"）→ 撤回新增文件时用 `node:fs`（`fs.rm`）或 `ctx.fs.writeText` 置空不可行；采用 `fs.rm`（POSIX+win32 均支持），路径用 `ctx.fs.processPath(target)`。
- **与 git 解耦**：纯文件快照，不触发 git 命令。
- **已知边界**：仅追踪 write/edit 工具（触发 fs/*-intent）；bash/sed 等 shell 内联修改不在捕获范围（文档注明）。

## 数据结构（host 内存，`lib/services/session-changes.js`）

```js
// 记录（不可变）：一次 write/edit 工具调用 → 一条（仅保留 pending 状态）
{ callId, tool: "write"|"edit", file: displayPath, abs: processPath,
  before: string|null /* null=文件原本不存在（新增） */, after: string,
  sessionId, step: number, at: epochMs }

// store：Map<sessionId, Array<Record>>；按 step 升序
```

> **用户裁定（2026-08-16）**：**已采用/已撤回的记录直接删除**，不保留历史——`adopt`/`revert` 成功后从 store 移除该记录（幂等：对不存在记录操作返回 ok）。store 内只存在"未处理"（pending）记录。撤回动作本身是 host 直接写文件（不走工具），不会形成新记录循环。

## RPC 端点（`lib/index.js` 追加，沿用 `(endpoint,payload)` 信封 + guardCwd）

| 端点 | payload | 返回 |
|---|---|---|
| `sessionChanges.list` | `{sessionId, cwd}` | `{items: Record[]}`（当前会话**全部 pending** 记录） |
| `sessionChanges.adopt` | `{sessionId, cwd, callId}` | `{ok:true}`；记录删除（幂等） |
| `sessionChanges.revert` | `{sessionId, cwd, callId}` | `{ok:true}`；写回 before（新增文件→`fs.rm`）后删除记录（幂等）；失败结构化错误 |

> `revert` 后记录 status → "reverted"；再次操作幂等。撤回动作本身是文件修改（下次 write/edit 会再捕获为新记录，符合"撤回反映到 git 变更"）。

---

### Task 1: host 捕获层 + RPC（TDD）

**Files:**
- Create: `lib/services/session-changes.js`（纯函数：记录模型、store 操作、before/after 组装）
- Create: `test/session-changes.test.js`（纯逻辑：新增/覆盖/同文件多次/步骤自增/状态机）
- Modify: `lib/index.js`（监听 3 事件 + 3 端点 + dispose 清理）

**Interfaces:**
- Produces:
  - `createSessionChangesStore()` → `{ list(sessionId), push(sessionId, rec), find(sessionId, callId), remove(sessionId, callId) }`
  - `captureIntents(ctx, store)`：注册 write/edit-intent 监听（读 before，记 pending by callId）
  - `captureResults(ctx, store)`：注册 tools/result 监听（匹配 pending → 组装 Record → push）
  - `revertRecord(store, sessionId, callId, { fs, path })`：写回/删除；成功后 `remove`
- Consumes: `ctx.waterfall` / `ctx.on` / `ctx.fs`（readText/processPath）、`node:fs/promises`（rm）。

- [ ] **Step 1: 写失败测试（纯逻辑）**

```js
// test/session-changes.test.js —— 记录模型/组装/删除语义（无 Node 依赖的纯函数优先）
// 用例：push+list 顺序；同文件多次 → 多条；step 自增；remove 幂等；
//      revertRecord 语义（before null → 删除；before 文本 → 写回）用 fake fs 验证。
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在 → FAIL）

- [ ] **Step 3: 实现 `lib/services/session-changes.js`**

```js
// 关键点：
// 1) store = new Map(); step 计数 = Map<sessionId, number>
// 2) assemble({callId, tool, file, abs, before, after, sessionId}) → Record
// 3) revertRecord：before===null → fs.rm(abs)；否则 fs.writeFile(abs, before)
// 4) 纯函数尽量无 Node 依赖（status 转移、step 计算可抽纯函数）
```

- [ ] **Step 4: 接线 `lib/index.js`**

```js
// apply() 内：
const store = createSessionChangesStore();
captureIntents(ctx, store);   // ctx.waterfall("fs/write-intent", ...) + fs/edit-intent
captureResults(ctx, store);   // ctx.on("tools/result", ...)
// RPC case 追加 sessionChanges.list / adopt / revert（guardCwd 后操作）
// ctx.effect(() => () => { store.clear(); }, "session-changes teardown")
```

- [ ] **Step 5: 语法 + 全量测试**

Run: `node --check lib/index.js && node --check lib/services/session-changes.js && node --test`
Expected: check 通过；93 + N 全绿。

- [ ] **Step 6: Commit**

```bash
git add lib/services/session-changes.js test/session-changes.test.js lib/index.js
git commit -m "feat: session-changes capture layer (write/edit intents + tools/result) + RPC (M6)"
```

---

### Task 2: client"会话变更"tab（UI + 采用/撤回）

**Files:**
- Create: `src/components/session-changes.js`（SessionChanges 组件）
- Modify: `src/components/workspace-browser.js`（TABS 插入"会话变更"，排在"变更"之后）
- Modify: `client.js`（重建）

**Interfaces:**
- Produces:
  - `SessionChanges({ cwd, sessionId, rpc, onCountChange })`：
    - 加载 `sessionChanges.list` → 当前会话 pending 记录（步骤升序）
    - 每条：文件名 + 时间 + 工具；展开 → before/after diff 视图（复用 DiffLines 或简单双栏；无 diff 时显示文件内容变化摘要）
    - 按钮：**采用**、**撤回**（操作成功 → 本地移除该条 + `onCountChange` 更新计数）
    - `onCountChange(n)`：把当前 pending 条数回传父组件 → tab 标题显示
  - 空态：无 pending 时显示"没有待处理的会话变更"（此时标题不带数字）
- Consumes: `callRpc`、`DiffLines`、时间格式化（git-history-client 的 relativeTime 或本地）。

- [ ] **Step 1: 写 SessionChanges 组件**（结构契约）

```js
// 加载 → 列表 → 展开/收起 → 操作按钮（采用/撤回）
// 标记：data-wt-sesschg（根）、data-wt-sesschg-item、data-wt-sesschg-adopt、
//       data-wt-sesschg-revert、data-wt-sesschg-status、data-wt-sesschg-diff
```

- [ ] **Step 2: 接线 workspace-browser.js**

- TABS 数组插入 `{ id: "sessionChanges", label: "会话变更" }`（变更之后、会话之前）
- 新 state `sessionChangeCount`（默认 0）
- tabpanel 分支：`tab === "sessionChanges" ? jsx(SessionChanges, {cwd, sessionId: current, rpc, onCountChange: setSessionChangeCount}) : ...`
- 页签标题：`t.id === "sessionChanges" && sessionChangeCount > 0 ? \`会话变更 ${sessionChangeCount}\` : t.label`（与"变更 N"同款）
- 进入/展开 tab 时刷新计数（SessionChanges 挂载即 list 一次回调 onCountChange）

- [ ] **Step 3: 语法 + 构建 + 全量测试**

Run: `node --check src/components/session-changes.js && node --check src/components/workspace-browser.js && node build.mjs && node --test`
Expected: check 通过；构建成功；93 + N 全绿。

- [ ] **Step 4: 静态验证**

Run: `grep -c "sessionChanges" client.js && grep -c "data-wt-sesschg" client.js && head -1 client.js`
Expected: 均 ≥1；首行 `window.__ModuleLoader__.load({`。

- [ ] **Step 5: Commit**

```bash
git add src/components/session-changes.js src/components/workspace-browser.js client.js
git commit -m "feat: session-changes tab (per-session step list, adopt/revert) (M6)"
```

---

### Task 3: 集成验证与交付

- [ ] **Step 1: 全量测试 + 构建**

Run: `node --test && node build.mjs`
Expected: 全绿；构建成功。

- [ ] **Step 2: 重启 harness + RPC 探测**

- 重启 harness（host 新监听生效）；确认插件注册未丢（必要时 `node scripts/install.mjs`）
- 用 write/edit 工具真实修改一个测试文件（可先在 /tmp 或仓库内临时文件）→ 探测 `sessionChanges.list` 返回该记录（含 before/after/status=pending）
- 探测 `sessionChanges.adopt` → status=adopted；再 `revert` → 文件内容恢复 before（新增文件被删除）
- 确认不触发任何 git 命令（git log 无新提交）

- [ ] **Step 3: GUI 手动验收**

- [ ] "会话变更" tab 出现（变更之后），标题带未处理计数（如"会话变更 3"）；无待处理时不带数字
- [ ] 每条显示文件名/时间/工具；展开可见 before/after
- [ ] 采用 → 该条消失 + 计数减一；撤回 → 文件恢复 + 该条消失 + 计数减一
- [ ] 已操作记录不再出现在列表（直接删除语义）
- [ ] 与"变更"tab 并存：撤回后 git 变更列表出现新修改（解耦验证）
- [ ] 无记录时显示空态提示

- [ ] **Step 4: 计划勾选 + 台账 + 推送**

```bash
git add docs/plans/2026-08-14-M6-session-changes.md .superpowers/sdd/progress.md
git commit -m "docs: M6 session-changes plan accepted"
TOKEN=$(grep -oE 'github_pat_[A-Za-z0-9_]+' ~/.dsh/profiles/web/cordis.patch.yml | head -1)
git push "https://x-access-token:${TOKEN}@github.com/g1998815/dsh-workspace-tools.git" main:main
```

---

## 里程碑验收清单（M6）

- [ ] `node --test` 全绿（93 + 新增用例）。
- [ ] write/edit 工具修改文件 → 会话变更记录生成（before/after/步骤归属）。
- [ ] 采用 / 撤回可用；撤回恢复 before（新增文件删除）；**操作后记录删除（仅存 pending）**；幂等。
- [ ] tab 标题显示未处理计数（"会话变更 N"），随操作实时更新。
- [ ] 与 git 解耦：不产生 git 提交；撤回作为新修改反映到"变更"tab。
- [ ] GUI："会话变更"tab 展示、展开 diff、操作反馈、空态。
- [ ] 推送 GitHub main。

## 后续（非 M6 范围）

- bash/sed 等 shell 内联修改的捕获（需目录快照 diff 或 hook，成本高，暂不做）。
- 记录持久化（当前 host 内存，harness 重启即失；如需跨重启，落盘 `.dsh` 或工作区 JSON）。
- 批量撤回（按会话整体撤回，当前逐条）。
