# 已有源码打开时的导航请求被页面恢复抢占

## 目标

修复真实 Electron 验收发现的 Flow 源码导航问题：在已有源码打开时，显式选中另一文件的关系或节点必须切换源码；同文件新范围也必须更新高亮。同时保留页面返回时恢复保存位置，以及项目、快照、页面代次和迟到响应保护。

## 原始失败与复现

- 独立验收在真实 Electron 中先打开 Python `context.py:12:4`，再搜索 TS `outerA`、查询并点击 CALLS。关系选中状态变化，源码仍停在 Python；节点列表选择 `helper` 也无导航。关闭源码后点击同一 CALLS，界面显示 `src/nested.ts:3:9` 并高亮。操作证据见[独立验收记录](2026-09-30-independent-review.md)。
- 新增 App 控制器集成回归，按相同状态序列操作实际 UI。修复前源码维持在 `src/context.py`；读取记录只有初次 Python 读取和旧位置恢复读取，均为 `src/context.py:12:4`，TS `readSource` 未发出。

## 根因与修改

- 根因已由调用记录确认：`beginSourceRequest` 在每次主动导航时调用 `setSource(null)`。`restorePageSource` 把 `source` 放在回调依赖中，因此清空状态会重建回调并触发恢复 effect。它依据旧页面记录启动 Python 读取，推进共享请求序号；随后抵达的 TS 证据回调不再满足当前请求检查，所以不会开始 TS 源码读取。
- 使用 `sourceRef` 让恢复回调可读到最新 viewer 内容，但恢复 effect 不随 `source` 更新重跑。恢复时用同仓库、同快照、文件路径、完整源码范围和 evidence ID 判断当前源码是否已匹配；这样同路径不同范围不会误判为已经恢复。
- 没有放宽 `isSourceRequestCurrent` 的项目身份、项目代次、活动页面、页面代次、工作区页面代次或 request ID 条件。
- App 回归覆盖已有 Python 源码时的 TS CALLS 跨文件导航、节点列表中 helper 定义导航、同一 `nested.ts` 的另一 CALLS 范围更新。测试 Cytoscape stub 增加空 `select()` 方法，以便节点列表测试实际执行其后续 `onNode` 导航。

## 实现反馈与验证

- 修复前目标回归失败，DOM 仍显示 Python；读取 mock 调用跟踪确认 TS 请求被恢复读取抢占。这是产品缺陷。
- 第一次加入节点列表操作时，测试 Cytoscape stub 缺少 `select()`，导致 mock 抛错。这是测试夹具缺陷；补齐 mock 方法后，节点导航路径真实运行。
- 首次类型检查发现 `readSource` 测试夹具的 `workspaceStatus` 字面量扩宽成 `string`。这是测试夹具类型错误；添加 `as const` 后检查通过。
- `pnpm --filter @project-xray/ui exec vitest run src/App.test.tsx -t "已有源码打开时"`：修复前失败；修复后 1 项通过。
- `pnpm --filter @project-xray/ui test`：11 个测试文件、82 项通过。
- `pnpm typecheck`：10/10 包通过。
- `pnpm build`：10/10 包通过，生成 `apps/desktop/dist/main.js` 和 UI 生产资源。Vite 保留现有 UI 与 Monaco chunk 超过 500 kB 的提示。
- `git diff --check`：无差异格式错误；Git 提示工作区文件下次写入时会从 LF 转为 CRLF。

## 未验证项与状态

- Python → TS 跨文件 CALLS、`outerA.helper` / `outerB.helper` 节点、同文件范围更新和离开后返回跨页恢复，已在真实 Electron 中按本批范围独立验收通过（见[独立验收记录](2026-09-30-independent-review.md)）。App 回归只作为配套证据，未替代 GUI 操作。
- 尚未运行 Windows 安装包或发布验收。项目工作区版本仍为 `0.1.0`；根目录 `pnpm dev` 是真实 GUI 的开发启动入口，本轮只验证了生产构建，没有启动 GUI。
- 没有提交或推送。保留本轮开始时已有的其他工作区修改。

## 工程经验评估

源码恢复请求竞争满足规则沉淀门槛：真实 Electron 复现、App 回归与修复前读取调用记录共同确认产品缺陷；修订了 `AGENTS.md` 已有的源码导航经验，补充恢复触发边界及应覆盖的边、节点、同文件范围、跨页和迟到响应场景，没有增加重复条目。
