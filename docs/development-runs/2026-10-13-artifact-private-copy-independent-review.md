# M10 私有副本首次独立复验与夹具窄修

2026-10-13，协调方在 work tree 2 冻结交付后核对真实 Git、完整 raw/hash 和来源：437 原文件保持，新增恰好五文件，总计442；M4/M8/M9 主目录依赖一致。未集成 M10，未执行 Git 收尾。

唯一 Windows 技术窗口串行执行原两文件：`pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-private-copy.test.ts src/windows-artifact-private-copy-handle.test.ts --maxWorkers=1 --no-file-parallelism`，25 项中24通过、1失败，22.81秒。desktop noEmit通过。日志与完整来源收据保留在忽略的 `.benchmarks/desktop-main-integration/m10-initial-independent.json` 和 `m10-root-initial-tests.log`。

失败已确认为测试夹具缺陷。原 collision-link 探针在 prepare-collision 阶段返回固定失败，attempted=false，没有到达副本创建。夹具 Get-XRayPrivateCopyFixtureIdentity 对 FILE_STANDARD_INFO 字节20（DeletePending）使用了反向判断，普通未待删除 junction 被拒绝。协调方只在临时脚本中反转该比较进行诊断：到达真实碰撞拒绝，created=false，前后完整身份证明及内容摘要一致，借用的 M4/M8 会话保持。此诊断不替代修正后原套件独立验收。诊断收据 `m10-link-diagnostic.json`；原442文件全部保持，技术窗口已关闭，自有材料保留未递归删除。

仅派 work tree 2 修正该夹具、对应 HANDLE 测试及自有开发记录三文件；其余439文件冻结，含生产副本模块、纯测试、M4/M8/M9、共同记录与规则。保留正确的 no-follow/reparse、目录类型、非待删除、完整身份和碰撞保护检查。测试须明确实际到达 copy、拒绝创建、原身份/内容保持以及借用/释放结果。开发仅纯定向回归、类型和 PowerShell 5.1 AST，不运行真实 HANDLE；冻结后协调方复跑原套件。

本轮不接受 M10，不集成、不提交、不推送；没有新增 AGENTS 规则，此次测试比较错误已有身份与安全失败规则覆盖。完整 reader、ASAR 解析/全树/manifest、签名、安装运行、GUI/API 门仍未验，四批停止门不变。


## 2026-10-13 M10 修复独立接受与精确主目录集成

root核442完整raw/hash，恰三旧夹具/测试/记录变动、其他439保持；原两文件26/26通过（22.69秒）及desktop noEmit通过。junction真正到达副本碰撞拒绝，原完整身份与内容保持，借用与释放门通过。主目录543→548仅五新，旧543完整raw/hash保持；原两文件在主目录26/26通过（23.24秒）及desktop noEmit通过，两目录源像稳定。仅接受本地Windows有界私有copy，同source HANDLE单次消费/最多1MiB固定块、目标独立读回hash/EOF及安全失败；实际2GiB边界仍未测。无GUI/API/Git/新增规则，单技术窗口关闭，员工冻结保留。详情 [M10独立审查](../development-runs/2026-10-13-artifact-private-copy-independent-review.md)。

下一实际代码缺口：M2控制副本条款3/4要求 ASAR元数据解析及副本parse前后从原owned HANDLE重新核身份/length/hash；目前structure模块只消费外部传入path/file/unpacked清单，M10没有parser或重开路径消费者。完整reader/sidecar父进程重开/manifest/签名运行以及GUI/API等仍未验。不凭有限copy标完整，也不因此暂停仍可本地推进的四批工作；下一切片尚未派，须先核实际parser依赖、受限私有路径与协议边界，不第五批。
