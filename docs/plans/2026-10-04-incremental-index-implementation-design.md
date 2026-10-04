# 3G-S：普通增量索引的实施设计

2026-10-04；协调方；原四批第三批，P1，原Sol5170。先设计审查再实施，不改产品源码，不新增第五批。root已完成冻结source-loan定向复验，技术窗口释放；旧loan与core/UI接线保持冻结。

## 源码依据与目标

实际application/index.ts的indexProject每次安全发现/读取源码，随后TS analyzeProject创建完整Program、Python analyzeProject处理完整项目；导航缓存不会减少这些分析。现有冷库/无变化reindex基线及incremental-indexing-baseline.md只是测量准备。第一版目标是原普通索引路径内可观察的保守增量重用，保持完整源码/规范化图事实/证据、诊断与不可变快照等价；不为工具冒充产品优化。

root核main/Sol五份当前源码hash一致：analyzer-core/index 96FF1BBAECD7447C821765E55FCDEB036D8D0029AA526CF3DFB0E1445D152AD7；secure-read 85606DD9EEF1D93ABFF543C5779A835A44AD4D543476CDB218D190218F97398D；application/index 855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18；TS analyzer AE99B6100E77E7E0158E9877791A95FCDCE90B2FB782FD48E2C67EDEEE450FD5；Python analyzer E1D7F315D022C4AFB68737AAEC9BB60D6F97AE3B0C9A5B503E78CC11A6689E6B。基线旧HEAD不同不得reset/整体合并，以实际冻结文件为准。

## 本切片文件边界

仅原Sol新增docs/plans/2026-10-04-incremental-index-design.md和docs/development-runs/2026-10-04-incremental-index-design.md。只读application、analysis、graph、现有基线/工具/样例和当前配置身份源码；不得改AGENTS/共同队列、native/loan/desktop/UI/contracts/package/lock/实现，不运行重型构建、GUI、真实项目、API。main Luna只reader两文档，不冲突。

## 设计必须回答

- 明确第一可运行实现切片、具体文件清单及公开接口；优先在现有依赖内重用不可变文件/解析材料，证明不了局部失效则按语言或全量回退。
- 安全当前性仍通过实际root/HANDLE读取与hash捕获，不能凭mtime/长度跳过安全读取；配置/ignore修订、分析器版本、缺工具→恢复、文件清单、跨文件TS Program和Python导入/词法绑定进入失效判定。
- 中间产物内部保留、不跨包传原始编译器对象；若重用已有事实，完整ID/证据/snapshot重绑定须有可审查的证明，不能更改历史事实或把旧snapshotID复制成当前。
- 明确缓存私有身份/实例/项目/上限/淘汰、失败与partial结果、取消/并发/发布事务、新配置修订校验和A→B→A重启；单独列确实需要的持久schema变动，没有必要不引入数据库框架。
- 最小真实等价回归覆盖无变化/修改/新增/删改名、别名/循环/跨文件、TS配置/Python绑定、解析失败恢复、忽略、取消和并发配置变化。复用当前自有样例，不运行样例项目代码。
- 给实际工作量计数和有限测量方法，区分安全读取、解析、语义、持久化；不得仅以少数计数或旧wall值宣称全项目加速。先普通索引，Git双侧不自动纳入实现。

目标是一份能直接派出最小产品实现的方案；不要重复已有基线报告或扩写所有可能缓存。依据不支持收益时明确具体缺口及更小策略供root判断。反馈闭环按实际发生记录，经验允许0；完成冻结等待独立复审，不自行实现/Git。
