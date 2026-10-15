# 待提交改动审查与有限发布

## 目标与边界

用户要求审查、验证本地改动后提交并推送。起点 main 为
`455dfd3db551ed97d0ce441b1da05f3ccf3eb5d5`，实时远程 main 相同；
工作区有 162 项修改或未跟踪条目，暂存区原为空。
保留现有 GUI 暂缓、真实 file-symlink 安全门及远程 API 授权要求。
本轮没有向其他开发聊天派发，没有改系统安全设置。

## 实际审查与验证

- `pnpm typecheck`：11 个任务成功，其中 8 个为 Turbo 缓存命中，3 个实际执行。
- `pnpm test`：失败。graph 包 4 个文件失败、15 个通过；已执行的测试为
  421 通过、5 失败，另外 3 个套件在加载阶段失败。Turbo 随后中止全仓运行，
  不能声称其他包全部通过。
- 三个加载失败套件为 ownership-semantic-desktop-read、ownership-semantic-result-store、
  remote-task-recovery-store；动态导入 application/src/index.js 被解析为错误位置。
  本轮未确认其加载器根因，不将其写成已修复或单纯环境问题。
- upgrade-preservation 的 5 个失败分别是三例预期 11 条迁移、实际 14 条，
  global 夹具的 POLICY_INVALID，以及 future-version 夹具迁移版本号唯一约束冲突。
  不通过直接修改版本数量或削弱断言来消除失败；尚未完成产品/测试根因归类。
- 完整阅读 upgrade-material-protocol、upgrade-recovery-format 及对应测试和计划、记录。
  两模块仅相互依赖及 Node 内建模块，不导入待提交的桌面/应用/图入口；
  不修改公共导出、数据库结构、生产调用链或权限。
- `node node_modules/vitest/vitest.mjs run packages/graph/src/upgrade-material-protocol.test.ts packages/graph/src/upgrade-recovery-format.test.ts --exclude **/.benchmarks/** --maxWorkers=1 --no-file-parallelism`：
  2 文件、97/97 通过。包含自有 SQLite main/WAL/PERSIST/journal 材料验证、独立副本恢复、
  篡改、预算、别名、完整集合、Proxy/accessor 与显式不授权结果检查。
- `node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node packages/graph/src/upgrade-material-protocol.ts packages/graph/src/upgrade-recovery-format.ts`：
  实际执行通过，不依赖 Turbo 缓存。

## 本轮可发布范围

只纳入两个内部纯字节模块、各自测试、各自已有计划/开发记录及本文，共 9 个文件。
模块验证调用者提供的 manifest/marker、payload 绑定和有限 SQLite 恢复格式；
来源仍为 caller-bytes-unverified，producerAuthentication 未建立，SQLite open、restore、
production 均不授权。此切片审查通过不代表整条备份或恢复链完成。

其他待提交代码、AGENTS.md 和混合进度文档均保留，不暂存。
UI、IPC、远程调用、启动集成及发布/安装材料仍需要各自回归与适用真实验收。
本轮未运行 Electron GUI、真实 API、安装或原生 HANDLE/file-symlink 验收。
没有修改实现或测试，没有掩盖全仓失败。

## 规则沉淀

本轮无新增规则：已有按验收范围提交、保留不相关工作区、严格证据与失败关闭规则足够覆盖。
Git 最终版本及推送结果以本轮交付报告和远程分支核验为准。
