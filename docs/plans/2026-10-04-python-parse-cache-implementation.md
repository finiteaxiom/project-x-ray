# 3G-S1：普通索引 Python 解析缓存实施

2026-10-04；root 审查后派发，属于原四批第三批。设计依据为 `2026-10-04-incremental-index-design.md`。本批完成产品普通索引入口中的跨应用解析复用，不只实现 benchmark 或纯协议。

## 接受的设计与追加条件

接受 Python 无快照原始解析材料的复用、每轮真实工具探测、完整跨文件语义重建和项目 SQLite 私有缓存表。TypeScript、Git 比较双侧仍完整冷分析；保留完整安全发现/捕获/再读取、配置事务核验和最终分析身份。不新增依赖、数据库文件、共享/IPC/Graph IR 字段或用户设置。已有每任务新 worker 的桌面生命周期不改。

root 已独立核 main/Sol 的 application、Python/TS/analyzer-core 五源码及 Python worker、GraphStore、remote/ownership store 内容对齐；忽略换行后的后三 store 内容相等。旧 worktree 未提交成果全部保留，只在明确文件内增加本批变化，交付需给出本批前后差异，不整体复制旧差异。

实施必须满足以下精确条件：

- 缓存格式/worker 协议/Python analyzer 版本分别明确更新；不能仅凭命令名或历史成功允许命中。当前实际 worker 脚本摘要须在工具探测与 miss 的执行边界核对，响应内 runtime 身份必须匹配。发生变化弃用 hits，最多一次有界全量冷回退，持续变化失败关闭；不宣称锁住外部解释器。
- 缓存 origin/source/hash/schema/digest/预算核验均独立；checksum 仅普通损坏检测，不代表签名或同用户恶意改库防御。当前 hash 只能来自安全读取材料。规范化生成全部当前事实，禁止 Graph IR 复用。
- 缓存 publish 的事务必须核提交后的精确 current activation、snapshot/repository/config/ignoreRevision 和该 producer 的源材料；仅核 snapshotId 不足以承诺迟到 batch 不覆盖后续同 ID 晋升。捕获本次 save 后 activation，后续任何晋升发生则放弃该 batch，不改写图终态。
- private 表只在 project 角色启用；当前已存在迁移 10（remote）和 11（ownership），查全实际迁移再确定下一版本。有限 SQL 读取与 2048 rows/32 MiB project/1 MiB row 双预算，坏库不能先无界读再截断；超预算仅放弃缓存，原冷分析事实不裁剪。
- saveSnapshot 成功是图发布边界。缓存故障、计数 observer 故障及迟到 abort 不得把已经提交的有效结果改报 failed/cancelled。取消和配置/源码漂移发生在图提交前则不得发布图或缓存。捕获 session 不共享调用者可变对象，close 后不得再写。

## 已独立复现的普通索引取消缺陷

root 在未改源码的 main 用真实 XRayApplication、Python AST 和项目 SQLite 建立自有一个 Python 文件的旧快照，改变该文件，在 `persisting` progress callback 中同步 abort。`pnpm exec tsx .index-cancel-review.mts` exit 0：indexProject 抛 `AbortError`，驻留 current 仍旧，关闭重开 current 已新；old snapshotId `e35f98a26fca58d62a3bbfa0`，reopened `9fa7bf220ef7111c8c7a392e`。没有执行 fixture 代码，临时复现脚本已精确移除，自有材料保留，未递归清理。

根因已确认：application persisting callback 后无 abort 检查直接 saveSnapshot，提交后再检查 abort。本批只修普通索引：回调后、同步 save 前检查；成功 save 后维护 resident/current 并返回已提交结果，迟到取消不逆转事实。添加真实 SQLite 回归覆盖提交前 abort 零新 current、提交后 abort 成功且重开一致；不扩展 Git/desktop broker。

## 文件边界

仅 Sol5170：

- `packages/analyzer-python/src/index.ts`、`python/analyze.py`、`src/index.test.ts`；可新增 `src/parse-cache.ts` 及对应测试。
- `packages/graph/src/index.ts`、新增 `src/analysis-parse-cache.ts` 和 `src/analysis-parse-cache.test.ts`；不改 remote/ownership/upgrade/native 端口。
- `packages/application/src/index.ts`、新增 `src/incremental-index.test.ts`；如已有测试文件必须改，只增本批明确取消/缓存回归，不触碰旧评分/导航逻辑。
- `benchmarks/python-parse-cache.ts`、其有限 child/test（如需要），只生成自有 20/80 Python 文件和 TS-only 对照，保留材料，不使用旧通用 benchmark/共享目录清理。
- `docs/development-runs/2026-10-04-python-parse-cache.md`；本 worktree 有证据时才去重更新自己的 AGENTS。

desktop/UI/contracts/analyzer-core/TS、loan/probe/native/build/package/lock 和旧设计冻结。任何需要超出边界的修改先向 root 报具体理由，不能以新任务替代当前产品切片。禁止开发 Git 收尾。

## 验证与稳定交付

先实现完整产品路径并做必要定向回归；按原设计矩阵核真实新应用重开命中、无变化/改增删改名、未变调用方对应目标变动、工具失败恢复、配置修订/源码漂移、双连接迟到 batch、取消、预算/坏材料/缓存 BUSY、历史内容不变。冷 oracle 与热路径必须同新协议/版本、同绝对根和独立 DB，规范事实/源码/分析身份/最终 snapshotId 相等。单文件无收益、TS 全量与 Git 冷路径须真实验证。

计数证明实际 Python 子进程减少，包含探测；观察关闭行为不变。20/80 自有样例成对有限重复测量，报告 wall/实际采样 RSS/已测 CPU 的来源与限制，不把 Node RSS 当整体 Python/Electron RSS。若不测 CPU 写未测，不制造数据。无变化 N>0 应一次解析、N-1 命中；环境/损坏回退额外调用单列。不外推总项目加速。

本轮授权普通单元/真实 SQLite/已有安全读取 addon 的定向验证，不运行重型 native/build/dist/Electron或真实 GUI；需要重编译先协调唯一窗口。冻结后 root 对具体源码/回归独立复验；真实 Electron 连续索引/取消/导航保持未验，不用后台结果代替界面完成。不接远程服务或执行导入项目代码。

交付列出具体 diff、实际命令/结果、失败根因与修正、计数与相等门、完整 source hashes、未验边界和规则判断。四批内继续；四批收尾停止派发，不启动第五批。
