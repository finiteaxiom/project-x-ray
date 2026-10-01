# 安全诊断与快照校验不可用状态

日期：2026-10-01
任务：实现已授权的安全诊断收口与不可用状态表达；使用现有主 checkout，保留任务开始前的工作区内容；未提交、推送或合并。

## 目标与边界

- 后台任务、工作线程、分析器、Git 和持久化诊断不得把原始异常消息、绝对路径或源码片段带到用户界面。
- 当前工作区无法被完整校验时，明确报告 `unavailable`，不把校验失败伪装成源码差异；仍阻止依赖该快照的新解释、出题和评分。
- 旧诊断只在读取时归一化；不回写历史 SQLite 行，不改变保存的快照源码。
- 真实 Electron“原生模块不可用后恢复”交互留待用户在其独立验收中操作。

## 实现

- 固定诊断码与固定中文文案贯穿分析器、Git、任务事件、worker RPC、UI 和旧持久化记录读取；任务协议升级到 1.1.0。失效或无法识别的旧诊断在内存中降级并隐藏任意详情。
- 快照完整扫描或逐文件读取不能完成时返回 `unavailable` 和空差异列表。仅确认当前状态后才允许解释、出题与评分；历史源码仍可从已保存快照读取，并标为无法验证。
- 工作区扫描若确认源码删除，快照状态仍报告真实移除。安全读取器对打开失败仅提供固定 `ERR_SECURE_READ`；在此通道无法证明文件缺失，因此源码查看状态保留 `unavailable`，不从隐藏的底层错误推断 `missing`。
- 为诊断边界、worker 失败事件、不可用状态、恢复后重新验证、真实移除和历史记录只读归一化补充回归覆盖。

## 失败与诊断

- 首次类型检查发现 UI 失败事件和源码结果测试夹具仍使用旧契约，缺少安全诊断码或 `workspaceStatus`。根因为接口版本更新后测试数据未同步；已改为新契约形状。
- 第一轮受影响测试发现若干断言仍依赖原始异常文案或错误码。固定诊断码已按预期隐藏这些内容，测试改为断言安全类别与固定用户文案。
- 后续测试中，删除已索引文件后，安全读取器返回通用读取失败而不是平台 `ENOENT`。这不能证明文件确实缺失；把源码查看断言改为 `unavailable`，并单独验证工作区扫描仍能证明 `removedFiles`。根因确认，未放宽差异或安全断言。

## 验证

通过：

```text
pnpm typecheck
```

结果：10 个 workspace package 全部通过。

通过：

```text
pnpm exec vitest run packages/contracts/src/index.test.ts packages/analyzer-core/src/index.test.ts packages/analyzer-python/src/index.test.ts packages/analyzer-typescript/src/index.test.ts packages/git/src/index.test.ts packages/graph/src/index.test.ts packages/application/src/index.test.ts apps/ui/src/state/ownership-sessions.test.ts apps/ui/src/App.test.tsx apps/ui/src/components/EvidenceWorkspace.test.tsx
```

结果：10 个测试文件通过，125 项通过、1 项跳过。

`git diff --check` 以退出码 0 通过。Git 对工作区换行符给出提示，不是 whitespace 错误。

## 未验证项

- 未运行完整 Electron GUI、打包或安装验证；真实“原生模块不可用 → 恢复”交互由用户的后续计算机操作验收覆盖。
- 测试运行在当前 Windows checkout；没有在 macOS/Linux 上编译或实测原生模块。
- 本轮未触碰独立审查或计划记录。

## 工程经验评估

本轮没有新增或修订 `AGENTS.md` 规则。未知与缺失的区分已有证据置信度契约覆盖；本轮将它落实到具体状态和固定诊断路径，尚不足以证明需要扩大通用规则。详细实现和回归证据保留在本记录。
