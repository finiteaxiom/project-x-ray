# 4B-Sol 升级保护设计读查记录

2026-10-04。初始只读设计阶段，仅新增本记录及 [设计](../plans/2026-10-04-windows-upgrade-preservation.md)。不运行迁移探针、不改核心代码，不接触用户真实应用库。

## 基线与授权

实际 cwd 为既有 5170 worktree，HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`，保留之前全部修改和未跟踪文件。读过实际 AGENTS 及协调方精准复制的 windows-release-preparation 计划。没有 reset、同步 main、重做 C2、Git 提交/推送/合并或其他目录写入。T2 已被协调方接受的消息作为派发背景，不将它或历史测试提升为本轮运行证据。

当前基线 SHA256（只读读取）：

| 文件 | 本 worktree |
|---|---|
| packages/graph/src/index.ts | `853DA33765953DC5803EFDB692583C37CDED7F13E7266545F1724395DCE4B4AB` |
| packages/graph/src/ownership-capsule-store.ts | `D5DFCC7A17A4A1A50A5C5EDDACAD6A790B4EFAF6340931132C8689C9F29836FE` |
| packages/graph/src/remote-explanation-store.ts | `7923E08945ECE2B38F070F1000916E755CB42B07EC36DDAF8B3622A8BD04EE1A` |
| packages/application/src/index.ts（保留 C2） | `855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18` |

只读核对 main 的 GraphStore/capsule 两 hash 与上表相同；main remote store 为 `763E700F6375ECAF2856BC87CF2139F7F195753FD452D04707C220D7D7CBFEA8`。实际 `git diff --no-index -- packages/graph/src/remote-explanation-store.ts <main对应文件>` exit 0，无内容差异；有 LF/CRLF 提示，不能写成字节 hash 一致。未借此同步文件。

## 实际操作与结果

- Get-Location、git status --short、git rev-parse HEAD：确认目录、旧 HEAD 和大量保留成果；没有推导整份 workspace 为本轮差异。
- rg/Get-Content：读取 GraphStore constructor/migrate/ensureEvidenceColumns/ensureSnapshotOverviewColumns/getLatestOverview/getCurrentActivation/ownership 写读/close；读取 remote/capsule migrate、角色与恢复；application global/project 扫描、懒打开、close；desktop main、policy、worker 与 startup 所有权入口。仅文本检查，没有实例化模块。
- 读取现有 graph legacy、ignore、remote migration10、capsule migration11 测试的相关源码；它们是选择夹具的依据，没有运行，也不引用其旧结果为本轮通过。
- 读取历史 windows-release-acceptance 和当前4B计划，区分历史 schema9/native未接线描述与当前迁移11源码；没有修改历史文档。
- 读取已安装 better-sqlite3 database.js/backup.js，确认 readonly/fileMustExist 选项与异步 backup 收尾的现有能力。没有 require addon、执行 backup 或打开数据库。
- Get-FileHash 与 no-index diff：核对上列输入；文档完成后再核对输入 hash、HEAD 和状态，冻结新增文件。没有依赖安装、测试、typecheck、build/native/dist、GUI、网络、模型或性能工具运行。

一次可选类型声明路径查询未找到根 node_modules/@types/better-sqlite3/index.d.ts，命令 exit 1；所需 API 直接从实际已安装 lib 源码读取。属于本次读查路径不匹配，不是迁移、产品或测试失败，没有为此更改依赖或环境。

## 发现与设计收敛

已确认：GraphStore 在构造内设置 WAL 并写基础/10/11，基础部分不在完整事务；9 在8前写；Application 最新 overview 查询可能补写；global→project 顺序与 swallowed project error 可能留下已打开/已迁移的其他库；没有 backup、future-schema 拒绝和持久化角色校验入口。主 checkout 当前 main 是 whenReady→AnalysisBroker→analysis-worker→Application；本 worktree 保留的 startOwnedApplication/ExplanationPolicy/explanation-worker 整体启动接线尚未集成。只有 worktree 路径中的 policy 已先于 workers 开 global，不能将其写成 main 事实。

这些是源码可见保护缺口，不是“数据已丢失”的复现结论。异常关闭单连接不回滚其他已提交迁移；具体失败现场、WAL 恢复、busy、future 库误开、角色误开和资源释放尚未实验。没有把 max(version)=11 当兼容通过。

方案将下批收敛为两个自有 fixture 测试文件及其过程记录，先验证原始包→操作副本→真实迁移/失败→独立还原。生产门另审：当前 main 须早于 AnalysisBroker；将来远程接线接受并集成后还须早于 policy/broker/额外 worker，包含整组保护和后来新库的打开门。main 的启动所有权前置能力需另审，旧 worktree 技术验收不证明它已集成。测试辅助复制不是生产保护实现；不在此文档阶段新增 GraphStore 公开端口。

## root 复审后的两点修订（仍仅文档）

初稿将 worktree desktop 入口与主 checkout core 基线混写，可能让复制后的相对链接暗示待集成模块已存在。root 指出后，实际 rg/Get-Content 对照两个 main 及主 checkout analysis-worker，确认上述入口差别；表格改为链接主 checkout 已存在文件，待集成模块仅用文字标识。B 分为当前 whenReady/AnalysisBroker 门及待集成远程依赖，没有将 startOwnedApplication 的旧验收转成 main 事实。这是本轮文档表述纠正，不是产品行为改变。

WAL child 方案补充为 graph 新测试文件内的固定内联 child，application 测试不启动 child，不新增 helper 文件。明确 ready 5 秒、child 总阶段15秒、树终止及 close 等待额外5秒、新测试总25秒；committed 后固定 taskkill /T /F 切点；超时/取消也只终止本轮 child 树并等待 close，未确认退出不复制/打开或删除根。完整副本实际重开核对提交记录，并有 main-only 负对照；启动/提交/退出/复制/恢复失败零保护完成标记。新时限仅是待实施新测试的资源契约，没有修改或降低旧门。

本次只读核对和两文档编辑后再核对原四 core 哈希、HEAD 与文档状态并重新冻结。没有启动 child、taskkill、SQLite、迁移探针或回归；上述命令均为设计，未执行。

本轮没有产品/测试失败，也没有“实现→红测→修复”的闭环，不能虚构。实际反馈为只读源码调查后发现构造后备份不足，补入 overview 写入、远程恢复与全库组边界，再复核对应函数并完成设计。

## 交付与未执行项

仅两份新增文档。设计包含实际迁移表/列、允许兼容差异、代表旧结构/partial/current/ownership 夹具、WAL/SHM 集合、busy/事务/失败关闭/还原、future/角色策略和具体下批文件与命令。

root 需独立复审设计再授权实施；没有运行任何列出的回归命令，没有证明备份或升级成功。GUI、生产保护接线、真实安装升级/卸载、签名、干净 Windows 与发布仍未验。

AGENTS 本轮冻结、无新增规则：只有源码和现有规则支持的一次设计调查，新保护行为尚未复现验证。符合经验门槛的后续结果应由对应实施记录和协调审查判断。
