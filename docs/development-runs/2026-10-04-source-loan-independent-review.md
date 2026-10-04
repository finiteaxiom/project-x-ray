# S1b-L 源借用独立审查

2026-10-04；协调方；仅原Sol5170冻结切片。原四批恢复，结束后暂停开发及定时任务。本记录不代表整个S1a或升级产品接受。

## 实际范围与源码审查

六个交付文件的SHA256与开发冻结记录逐项一致，复验后native、adapter、consumer、smoke再次取样不变。main与Sol的analyzer-core/index、secure-read、application/index、TS/Python analyzer五份源码逐项字节相同；无重置或整体同步worktree。

检查native Borrow/Queue/Execute/Complete/ReleaseLoan、TS私有WeakMap与FinalizationRegistry及两遍consumer：预算来自实际HANDLE成员长度，2B不提高20GiB；public预读/借用冲突拒绝，顺序由native核对；loan与pending同时强持source，失败不提前关闭借用源；取消/原截止继续生效；pending结束后释放借用，不返还读预算。元数据不是权威，私有模块未导出graph index/IPC/UI。consumer finally保留原错误，无target/SQLite/manifest/生产receipt。

原source CloseHandle仍未checked，排队资源耗尽/未知release失败仅代码检查；不声称所有生命周期分支均实测。

## 本轮实际独立验证

开发聊天确认全部冻结且技术进程已结束后，由协调方独占技术窗口执行，未操作GUI。

| 命令（Sol工作目录） | 实际结果 |
| --- | --- |
| node packages/graph/scripts/build-windows-upgrade.cjs | exit0，UPGRADE_NATIVE_BUILD_OK |
| pnpm exec vitest run packages/graph/src/windows-upgrade-source-loan.test.ts packages/graph/src/windows-upgrade-files.test.ts | 48通过/1失败，49总数，0 skip；新增loan七项通过 |
| pnpm --filter @project-xray/graph typecheck | exit0 |
| node packages/graph/scripts/windows-upgrade-capability-smoke.cjs --loan | Node24.17.0 exit0，two-pass/writer/retained标记 |
| node --expose-gc packages/graph/scripts/windows-upgrade-capability-smoke.cjs --loan-gc | exit0，真实pending/GC生命周期入口完成 |
| 真实Electron44.4.3原smoke的--run、--adapter、--loan | 三个受控spawn均exit0/signal null/stderr空，对应运行时及模式标记；windowsHide，无BrowserWindow |

Electron用开发记录中原spawnSync入口，以固定脚本及固定三个模式调用；移除ELECTRON_RUN_AS_NODE，每进程60秒上限，不读取/输出凭据或用户库。不是通过普通导入或空退出代替原CLI。

## 失败、接受与限制

唯一完整回归失败是正确file symlink用例在创建时EPERM；与原报告一致，属于本机无法建立所需反例的环境限制，不是被证明安全。原断言保留，未改Windows安全设置、未跳过、未用junction替代。没有新增产品缺陷被本轮复现。

接受本地内部source-loan的上述源码/回归及技术入口结果；不接受S1a整体，不复制或提交原生源/loan实现到main。材料writer、checked-close、重开/恢复、生产及GUI仍未验。GC不是正常释放保证替代；测试consumer只使用自有固定字节，未执行导入项目。保留fixture，无新递归清理。

AGENTS已存在pending强ref及身份清理规则；本轮无新增已验证工程经验。四批停止条款是用户协作要求，不冒充经验。
