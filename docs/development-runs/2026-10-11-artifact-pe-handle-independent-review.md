# 第四批4B-M5独立验收与精确集成

2026-10-11，协调方；仅同HANDLE有限PE捕获本地/Windows技术门接受，不是完整发布完成。

## 实际来源与差异

Sol HEAD455d4ad50830ee2495b70927e51caf830a4efbb8、main HEAD79417e0974af9ad5da637aa19361a91cb152b486保持，无Git写。冻结410→415仅一旧bridge/五新、409逐字节保持；410 raw基线、developer manifest/patch核hash与全部六路径逐hunk重建。main505→510同六路径、504原文件保持，回归后完整源像稳定。

manifest SHA256 DE77DDAAB3B8C3202041E0EE42F6CCC224CBBA98D153B8A8283454813BAE3472；patch SHA256 9A85ED4819ECA5DC4E779A67E34D22CE9F3D247F325691316BF87BF700798201。完整ignored收据.benchmarks/desktop-main-integration/m5-initial-independent.json，命令与日志如下。

## root实际验证

- pure：exit 0；cwd D:\Projects\CodexWorktrees\5170\Project X-Ray；命令 `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-pe-capture.test.ts apps/desktop/src/windows-artifact-pe-observation.test.ts apps/desktop/src/windows-artifact-manifest-protocol.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**`；日志 m5-root-pure.log SHA256 E0E6A0818FF4B58CFF9D8F4F4BDBC3639F7486A0CC89338E7ED17406C47B097D。
- types：exit 0；cwd D:\Projects\CodexWorktrees\5170\Project X-Ray；命令 `node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json`；日志 m5-root-types.log SHA256 E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855。
- syntax：exit 0；cwd D:\Projects\CodexWorktrees\5170\Project X-Ray；命令 `node --check apps/desktop/scripts/windows-artifact-pe-capture.cjs`；日志 m5-root-syntax.log SHA256 E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855。
- windows-new：exit 0；cwd D:\Projects\CodexWorktrees\5170\Project X-Ray；命令 `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-pe-handle-capture.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**`；日志 m5-root-windows-new.log SHA256 96616A0E63AD288B77E3B28F086CC6086A89B6CC61118DE7C2F8EDF2E044AD4E。
- old-m4：exit 0；cwd D:\Projects\CodexWorktrees\5170\Project X-Ray；命令 `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-handle-bridge.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**`；日志 m5-root-old-m4.log SHA256 8717C8A82F3BC4EA8EDD372DB96FE3544A58524AD0B1EAA1358AD2E56849D30B。
- old-m3：exit 0；cwd D:\Projects\Project X-Ray；命令 `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-reader-process.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**`；日志 m5-root-old-m3.log SHA256 1180CC1ACCE985A8BE77C6E9AAA023EF67EBA8AE4D05D7A18370A2F074C2C7D3。
- default-probe：exit 0；cwd D:\Projects\CodexWorktrees\5170\Project X-Ray；命令 `node "D:\Projects\Project X-Ray\.benchmarks\desktop-main-integration\m5-root-default-probe.cjs" "D:\Projects\CodexWorktrees\5170\Project X-Ray"`；日志 m5-root-default-probe.log SHA256 F2BA8C5EECB28A71A3760A9830548C77C3D09B9EF9F36F64E8D7CD6720F7C115。
- main-six-file：exit 0；cwd D:\Projects\Project X-Ray；命令 `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-pe-capture.test.ts apps/desktop/src/windows-artifact-pe-handle-capture.test.ts apps/desktop/src/windows-artifact-handle-bridge.test.ts apps/desktop/src/windows-artifact-reader-process.test.ts apps/desktop/src/windows-artifact-pe-observation.test.ts apps/desktop/src/windows-artifact-manifest-protocol.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**`；日志 m5-root-main-six-file.log SHA256 0120968387FBD5DB9CC246D121B6B6FB8D37DE35D096101F45B30F7ACC8C6A2D。
- main-types：exit 0；cwd D:\Projects\Project X-Ray；命令 `node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json`；日志 m5-root-main-types.log SHA256 E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855。
- main-default-probe：exit 0；cwd D:\Projects\Project X-Ray；命令 `node "D:\Projects\Project X-Ray\.benchmarks\desktop-main-integration\m5-root-default-probe.cjs" "D:\Projects\Project X-Ray"`；日志 m5-root-main-default-probe.log SHA256 F2BA8C5EECB28A71A3760A9830548C77C3D09B9EF9F36F64E8D7CD6720F7C115。

纯72、新Windows33/46.54秒、原M4 26/55.28秒、main原M3 28/3.59秒、main六文件159/104.39秒；desktop noEmit/JS语法及两目录独立default probe通过。Sol缺M3 test/fixture，root在main执行原测试且生产M3模块hash匹配，不把缺测试当通过。全部必要命令exit0，无本轮产品失败。

## 源码与独立探针

源码确认同顺序ReadFile/hash、固定1MiB缓冲/常数64与24字节、实际DOS/长度构造范围，不另开路径/seek/放宽sharing。消费者严格同步捕获DTO、真实PE请求构造器复算、输出剥离header。root自有跨1MiB边界默认九键/opt-in十键探针核完整独立SHA/128bit身份、release、重开与内容未变。实际Windows覆盖短读/EOF/错身份/取消/deadline/重复/junction/关闭，不以fault模拟替代原实际来源。

## 分列状态

- 已实现：M5一旧五新单文件有限捕获与消费并精确main集成。
- 独立代码/回归已验证：raw/patch/源码/纯回归/类型/原回归/实际Windows技术测试与rootprobe。
- 真实GUI已验证：本轮0；用户暂缓computer-use保持。
- 未验：完整目录树、ASAR安全副本、sidecar、完整manifest、签名/候选运行/安装/干净Windows、literal零OS后代、GUI/API和Git收尾。

root读取manifest数组形状、探针模板工具错误在源改动前纠正，非产品缺陷。旧断言、AGENTS及B2记录hash保持。本轮无新增工程经验，现有HANDLE/来源/限制规则覆盖；记录不替代实现/验收。

实际下一缺口来自file-only walker与M2目录成员设计；[4B-M6](../plans/2026-10-11-artifact-directory-observation.md)一旧五新交原Sol，尚无实现/验收。其他员工冻结保留，不第五批。
