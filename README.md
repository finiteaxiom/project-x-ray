# Project X-Ray

Project X-Ray 是一个本地优先的 AI 代码所有权系统：它从真实源码建立证据图，解释架构、调用流、数据流和 Git 变更，并通过所有权模式检验用户是否真正理解项目。

## 当前状态

V1 开发中。当前首发语言为 JavaScript、TypeScript 和 Python，首发平台为 Windows 桌面端。

Windows x64 便携包的构建、外部 Python/Git 要求和数据位置见[便携包说明](docs/windows-portable.md)。当前验收范围与限制见[开发状态](docs/DEVELOPMENT.md)。

## 本地开发

```powershell
pnpm install
pnpm rebuild:native
pnpm dev
```

质量检查：

```powershell
pnpm verify
```

后台索引 Worker 的真实进程冒烟测试需要先构建：

```powershell
pnpm build
pnpm --filter @project-xray/desktop smoke:worker
```

当前证据会绑定到不可变源码快照。工作区文件变化后，历史证据仍可查看，但会标记为过期；解释、差异和答题需要先更新索引。

产品与架构边界见 [架构设计](docs/ARCHITECTURE.md)，仓库协作规则见 [AGENTS.md](AGENTS.md)。

如果所在网络无法从 Electron 官方分发地址下载二进制文件，可以仅在当前终端临时设置 `ELECTRON_MIRROR` 后重新安装；仓库不会强制所有用户使用第三方镜像。

本地隐私与验收产物：`.env`、凭据文件、本地数据库、个人工具配置、`docs/screenshots/` 和 `docs/benchmarks/latest.json` 不纳入 Git。原始截图可能包含被分析项目的源码，原始报告可能包含本机路径；需要分享时应先脱敏。忽略规则不会检查源码或文档内容，提交前仍需检查暂存差异。

运行 `apps/desktop/scripts/ui-workspace-e2e.cjs` 前，必须通过当前终端的 `XRAY_UI_PROJECT` 环境变量指定本机 ByteAtlas 验收项目路径。该脚本依赖 ByteAtlas 的目录与源码约定，不能随意替换为任意项目；仓库不保存个人绝对路径。
