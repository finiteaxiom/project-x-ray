# 3G-S 普通增量索引设计记录

2026-10-04；原 Sol5170，原四批第三批。目标：只读源码，交付最小可派发的普通索引实施设计；不实现、不做 Git 收尾、不新增第五批。

## 基线与边界

HEAD：`455d4ad50830ee2495b70927e51caf830a4efbb8`；分支 `codex/llm-explanations`。保留此前所有 modified/untracked 文件。本轮允许新增的仅为本记录及 `docs/plans/2026-10-04-incremental-index-design.md`。计划输入为 `docs/plans/2026-10-04-incremental-index-implementation-design.md`。旧 loan/core/UI、写入探针和冻结设计不修改。

按任务计划本轮读取并核对 SHA256，五份指定源码与协调方给出的 main/Sol 值完全一致：

| 文件（packages 下） | SHA256 |
| --- | --- |
| analyzer-core/src/index.ts | 96FF1BBAECD7447C821765E55FCDEB036D8D0029AA526CF3DFB0E1445D152AD7 |
| analyzer-core/src/secure-read.ts | 85606DD9EEF1D93ABFF543C5779A835A44AD4D543476CDB218D190218F97398D |
| application/src/index.ts | 855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18 |
| analyzer-typescript/src/index.ts | AE99B6100E77E7E0158E9877791A95FCDCE90B2FB782FD48E2C67EDEEE450FD5 |
| analyzer-python/src/index.ts | E1D7F315D022C4AFB68737AAEC9BB60D6F97AE3B0C9A5B503E78CC11A6689E6B |

此一致性不涵盖 desktop，也不是 main 完整工作区验收。历史基线 HEAD 不同，没有 reset、同步或整体合并。

## 实际设计反馈

1. 静态读取 application、secure-read、TS/Python 分析器、Python worker、snapshot finalizer/canonical、GraphStore 与配置身份代码。确认安全捕获/再验证仍是权威当前性边界；TS 当前每轮创建完整 Program，Python 当前每文件子进程后完整跨文件解析。可复用的最小材料是 Python 无快照 JSON DTO，不能复用已解析 Graph IR 或旧快照 ID。
2. 初步实例内缓存方案经实际桌面生命周期源码核对被排除：本 checkout 每次索引新 worker，终态销毁。设计修正为已有项目 SQLite 的单个可丢弃缓存表，保留桌面生命周期，并要求协调方核集成入口。该反馈是设计约束发现，非运行失败。
3. 缓存不能绕过 Python 工具不可用状态；提出每轮一个真实当前文件的解析探测，优先 miss，其他 miss 核 runtime fingerprint。失败本轮冷回退，partial 不写 bank，全部事实重新规范化/解析。当前 2TS+1Python 基线没有减少 Python 解析次数的空间；设计明确该样例只可验正确性，多文件自有样例另行测量。
4. 静态观察 application 的 persisting 回调与 post-commit abort 检查顺序，提出普通索引入口的窄取消边界回归和修正。尚未运行复现，不标为已确认缺陷，不扩大到桌面或 Git 比较重构。
5. 历史资料提到的 semantic-reliability 目录在当前 checkout 不存在；定位实际 e2e-project 及 analyzer 测试自有语义模式，设计不引用不存在的 fixture 作为当前验收证据。

没有测试/构建失败或产品运行失败；未编造“实现→失败→修复”闭环。这轮实际闭环是“源码约束→候选方案→生命周期核对→缩小并修正设计→文档与冻结文件核对”。

## 实际检查及未执行项

执行的是 PowerShell 只读 `Get-Content`、`rg`/`rg --files`、`Get-FileHash`、Git 状态/HEAD 核对，以及 apply_patch 新增两份文档。读取计划、指定五份源码、安全 scope、配置、finalizer/canonical、GraphStore、现有基线工具/记录与自有 fixtures；仅为核生命周期只读了本 checkout 桌面入口。

交付前重新核对五份指定源码 hash 与 HEAD，均保持上述值；检查两份新增文档存在。未把旧工作区修改纳入本轮交付。没有运行测试、构建、native、GUI、真实项目索引、网络、API、远程发送、提交、推送或合并。没有新依赖、产品源代码或 AGENTS 修改。

## 输出与门槛

设计给出了未来具体文件/API、私有表与迁移边界、缓存身份/限额/淘汰、失败/取消/并发/配置发布门禁、冷热最终快照等价测试和有限计数/性能方法。持久表和取消调整均是待审提案，不是现有行为。Python 减少解析量、内存成本、实际总时间和 Electron 连续索引尚未验证；TypeScript 全量及 Git 双侧冷路径保留。

本轮无新增规则：设计尚未有实现或实验支持，已有证据/路径/配置发布/不可变历史规则覆盖原则。冻结两文档等待协调方独立复审；不自行实施，原四批结束后暂停讨论规划。
