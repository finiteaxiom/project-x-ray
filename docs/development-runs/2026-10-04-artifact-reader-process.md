# Artifact reader process boundary 记录（4B-M3）

日期：2026-10-04
目标：在冻结 manifest v1 和 Windows HANDLE reader 尚未实现的前提下，提供有界、可取消、可观察 close 的 Node 子进程会话端口；交付仅限批准计划列出的四个文件。

## 范围与实现

- 阅读本轮 4B-M3 批准计划、实际 `AGENTS.md`、manifest v1 设计/协议、desktop TypeScript 与 Vitest 配置，以及现有 child-process 用例。没有使用 Git。
- 新增 `apps/desktop/scripts/windows-artifact-reader-process.cjs`：同步校验 plain-data 输入和固定 trusted launch；Windows shell 禁用、hide child window、固定 cwd、环境只保留 SystemRoot；输入只通过 JSON stdin 发送。模块顶层只加载内置模块、常量和类型，不启动 child、不读文件、不输出。帧有版本/runId/token 绑定，检查重复 JSON key、精确 top-level key、plain DTO、字节/节点/深度上限；消费 ready 时保持 child 活跃，之后才 release，并要求合法 terminal、exit 0 与 close 全部观察到。ready consumer 的首次微任务调用前会重新检查会话 state、failure、settled 和 consumer abort，避免同一 stdout chunk 后续非法帧已使会话失败后仍启动 consumer。
- reader session 使用 stdout 总计 64 KiB、stderr 4 KiB、ready 默认 30 秒、总时限最多 15 分钟、close 等待最多 5 秒；取消/失败只终止本次 `ChildProcess`，错误只携带固定码和安全状态，不回显 stderr。返回内部 `status="released"`，没有 manifest/scan 状态映射。
- 新增 `apps/desktop/scripts/test-fixtures/windows-artifact-reader-child.cjs`：只接受预定义模式和 runId/token，执行 ready/release/terminal、分块帧、字节边界、取消等待、有限错误场景，不 eval 输入、不读 artifact、不启动后代；`duplicate-ready` 使用单次合并 stdout 写入两帧。
- 新增 `apps/desktop/src/windows-artifact-reader-process.test.ts`：用实际 Node child 验证正常持活会话、stdin-only 控制值、帧解析、固定字节上限、取消、截止、协议错误、错误码、exit/close 和清理状态；新增真实 child 回归，要求同一 chunk 的重复 ready 使调用 consumer 次数为零；单独 child 验证模块加载期无 spawn/文件访问/输出。
- 没有生产 reader/caller、artifact CLI、sidecar reader、PowerShell/PInvoke、真实 manifest 或物理清理端口。该切片不表示 Windows artifact reader 或签名完成。

## 验证、失败与修正

当前目标环境为 Windows Node `v24.17.0`。最终实际验证：

- `node --check apps/desktop/scripts/windows-artifact-reader-process.cjs`：exit 0。
- `node --check apps/desktop/scripts/test-fixtures/windows-artifact-reader-child.cjs`：exit 0。
- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-reader-process.test.ts`：28 passed。
- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-manifest-protocol.test.ts`：22 passed。
- `pnpm --filter @project-xray/desktop typecheck`：exit 0。

初版首轮定向测试 26 项中 4 项失败，均为测试/fixture 缺陷；当时没有定位到产品模块缺陷：

1. import side-effect 检查在 CommonJS loader 加载受测模块前替换 `fs` 方法，把 Node 自身读取模块源码误判为被测模块文件访问。修正为先读取固定可信模块文本，再在被测模块 evaluation 期间安装监控并以内存 `_compile` 执行；随后 import 检查通过。
2. fragmented-ready fixture 发出 ready 字节后没有注册 release listener，导致正确的 release 被 fixture 当成错误。先注册 listener 再分段写入；真实会话通过。
3. spawn-failure 测试把不存在的文件填进 `helperPath`，实际成功启动 Node 后由 Node 报 helper 缺失。改为把不存在的本地绝对路径放入 `executable`；Node `error` 分支返回固定 `SPAWN_FAILED`，未启动进程且 `cleanupSafe=true`。
4. total-deadline 测试在无竞争保护下等待 ready deferred；若 session 在 ready 前失败，测试自身会超时。修正为 race ready 与 session rejection 后再断言 deadline；ready 与 total deadline 均真实触发并确认 child close。

随后 root 独立复核发现 consumer 调度竞态，并提供一次 child stdout 写入 `ready + ready` 的复现。旧 fixture 的重复 ready 由两次 write 发出，且测试只断言 `PROTOCOL_INVALID`，未检查 consumer 是否已被调用。将 fixture 改为单次 Buffer write 并新增真实 child 断言后，修复前定向红测实际失败：错误码和 close 门禁正确，但 `consumerCalls=1`，预期为 0。确认根因是 `processReady` 排入 Promise 微任务后，同一 stdout chunk 的第二帧同步调用 `fail`/abort，但排队的微任务仍无条件启动 consumer。

修正是在首次调用 consumer 的微任务内部，先核对 state 仍为 `consuming`，并确认没有 failure、settled 或 consumer signal abort；失败的会话不启动 consumer。修正后新增红测通过，完整 reader suite 28/28、manifest protocol suite 22/22、desktop typecheck 与两个 CJS 语法检查全部通过。该改动只阻止尚未开始的 consumer；已开始 consumer 的合作取消行为和关闭保证未扩大。

另验证 Windows Node 对 fixture 自身 `SIGTERM` 的实际呈现。`process.kill(process.pid, "SIGTERM")` 后，parent 收到 `exitCode=1`、`signal=null`，故 wrapper 返回 `CHILD_EXIT`，随后确认 `close`。没有把这个结果声称为收到 `SIGTERM` signal event；`CHILD_SIGNAL` 事件分支在本次 Windows 运行时没有被触发。

`CLOSE_UNCONFIRMED` 分支通过明确的 `testOnlyDeferCloseConfirmation` seam 建模：fixture 的 OS child 实际 exit 0，但测试 seam 屏蔽 parent 对 close 的观察，wrapper 保守返回 `cleanupSafe=false`。这不是 OS 拒绝退出或无法关闭的实测。

## 交付文件与 SHA-256

- `apps/desktop/scripts/windows-artifact-reader-process.cjs` — `56E8E7FF5EEBF4E398234233DB79AE9C8E6283AB6283445B85B9F36E5F2BC5E3`
- `apps/desktop/src/windows-artifact-reader-process.test.ts` — `39CBCACD31D6B7267A01DCD24C9F0D01993977181373B3F312CA6E930811EC58`
- `apps/desktop/scripts/test-fixtures/windows-artifact-reader-child.cjs` — `4578160E4926D66F36B0CEC9C1E1A26EB0ACF3E5843F7A22D2E6734FD27BE802`
- 本记录：`docs/development-runs/2026-10-04-artifact-reader-process.md`

## 未验证边界与规则沉淀

- 没有运行 Electron、build/native、PowerShell、真实 artifact、Authenticode、ASAR、sidecar、GUI 或凭据流程；没有新增依赖、package/lock 更新、CLI 注册、生产调用方或 Git 动作。
- `CHILD_SIGNAL` 事件分支和真实 child close 无法确认的 OS 情况未实测；只有 Windows Node 当前可观察的非零 exit 和明确标记的 close-not-observed 模型。
- 不修改 `AGENTS.md`。本轮确认的 consumer 调度竞态已由 reader 微任务调用前门禁及真实 child 回归直接覆盖；当前修复仍限于这个 reader 会话端口。按本批严格四文件边界，公共规则是否沉淀交由 root 集成审查评估。Windows Node 的 SIGTERM 映射只在 v24.17.0 验证，单版本证据不足以写成跨环境规则；close 不确定仍按既有要求返回 `cleanupSafe=false`。
- 独立接受仍需 root 核查实际四文件差异与适用回归；本记录不代替 HANDLE reader、安全 reader、manifest 或发布验收。
