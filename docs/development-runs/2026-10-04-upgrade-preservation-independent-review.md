# 4B-A 升级保留夹具独立复验

2026-10-04，协调方。仅接受自有隔离验证切片，不表示产品backup/生产升级保护或GUI通过。

## 冻结与实际复查

原Sol回合01a102d1-24c0-7c13-b520-db29f57b25a9完成idle，实际cursor cfe7da2a-d1e4-4a1f-9168-182cb9c80d36:13。root实际回读两个完整测试及记录，核对raw兼容结构、PK排序/raw值/源码身份/时间、capsule状态、真实trigger/busy、多库现状、文件包与WAL child生命周期。三个文件hash分别6B92986E9E2D9E27606117CF5B8639984401C27CA8D55AE1472C05A37AACF658、A2B9E9368B34B6254C8356068EC9608E5D48F35C1FF3B08CB638D62ECAB6A70C、5689D8D7347161964E3DFE460DCF7AA96A28E4BEFAD45AC19CC2A70C42614634，与交付一致。GraphStore/application基线保持；旧worktree核心/桌面/规则修改保留，不整体集成。

## root 实际执行

- Sol目录直接Vitest两个新文件23项通过，exit0，5.61s；8/10文件graph+application共359项通过，exit0，109.53s。命令均node node_modules/vitest/vitest.mjs run，--fileParallelism=false，未触发pretest/native重建。
- Sol目录graph、application各 tsc -p对应tsconfig --noEmit均exit0。
- main独立ignored .benchmarks/upgrade-review-20261004/probe.ts，以pnpm exec tsx执行exit0，未导入开发测试helper。三个自有数据库原始包与原集hash不变；Application项目B version10故障后global/A完成11，B没有10，精确自有BLOB仍保留；全局11失败使项目物理集不变并释放锁；独立还原组重新构造成功。
- 同一独立探针的固定Node child事务提交后，仅本轮PID taskkill /T /F并确认close，实际WAL12392字节；完整集合恢复精确committed行，main-only无该表，完整副本第二重开一致，源main/WAL/SHM hash不变。探针仅mkdtemp固定自有文件、有限时限、确认关闭后范围检查清理，无真实库/样例执行/网络/GUI。

Probe返回passed、ownedDatabases3、projectFailureObserved/globalFailureBeforeProjectOpen/immutablePackage/independentRestore/walCrashClose/mainOnlyRejected/secondReopen均true，productionBackupVerified/guiVerified均false。这些是本轮实际结果，不引用开发报告替代独立检查。极端taskkill失败/close永不确认未人为触发，保留未验；测试路径能力不是生产根句柄竞态证明。

三个文件逐一确认main目标不存在后精确复制并核hash相同。main实际20文件366项通过，exit0，121.02s；graph/application两包noEmit均exit0，diff-check通过。主目录保留原先额外已接受测试，因此数目不同于Sol，未覆盖任何旧测试。仅接受并集成这三份隔离夹具/记录，没有产品源码修改、依赖/旧测试改动或未验UI集成。

独立ignored探针SHA256 18E3DF273272A7FA75EF8476CB87D3C84EC27DC5C597DA4C02D1F373CBAAC647，实际check-ignore确认。它不提交仓库，也不供生产调用。两目录新测试及核心冻结hash在集成时保持。

一次只读查找根tsconfig.json不存在，根实际使用各包tsconfig，属于查询路径错误，不是产品/测试失败。实施记录中的意外失败均是夹具/类型错误，root未复现新产品缺陷；future/角色错配/多库失败是本轮已实测的现状缺口。AGENTS新增0：当前验证和保全要求已有设计/数据完整性规则，本轮不把自有helper升级成生产经验或虚构新增规则。

后续B0依据上述实测缺口研究Windows实际文件保护端口与前置能力，先独立设计再实现；安装/生产数据/GUI、签名/干净机器与发布均未验。
