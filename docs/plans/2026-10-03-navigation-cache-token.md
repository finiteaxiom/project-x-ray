# 3F-C1：导航缓存有效性取样端口

2026-10-03；17:18 协调方独立接受，精确集成 main 后原 application 整包 147 项通过。范围为 V1/Windows 的既有导航性能缺口，不增加产品能力。缓存、observer、工具和收益仍未实现或验收。

## 目标、依据与优先级

S5 本地答题集成已独立复验并进入主提交 `18b6cbb9ac6ba31afe96e54b53beb7bb94283b59`。导航仍走完整快照加载；已接受的快照导航方案记录 medium 合成样例两轮 4,708 次完整加载，不能推断真实项目收益。当前 GraphStore 没有同连接 token 或本地保存代数。先实现只读取样端口，避免未来缓存掩盖另一连接变更；此切片不安装缓存，不承诺降低加载次数。

代码依据为该提交的 `packages/graph/src/index.ts`：构造时完成 GraphStore、remote 与 ownership 迁移；`saveSnapshot` 在 immediate 事务中保存/复用不可变 payload 与源码并独立激活 current；`loadSnapshot` 完整解析持久 payload。既有只读双连接 WAL 实验及已接受 `2026-10-02-snapshot-navigation-performance.md` 支持同连接 `data_version` 配合本地代数。3F-O/T 失败计数协议正由 Luna 修订，但该端口不依赖其聚合字段，可独立冻结验收。

优先级：先安全失效基础，再 Application 单槽缓存/observer，最后新测量工具和同调用三配对实测。后两步尚未授权实施；必须等本端口及 O/T 修订独立接受。

## 精确文件与依赖边界

Sol 只修改自己的 worktree 中三文件：

- `packages/graph/src/index.ts`：窄取样方法、类型及本地 generation 生命周期；保持原保存与关闭行为。
- `packages/graph/src/index.test.ts`：真实 SQLite 生命周期及故障回归。
- `docs/development-runs/2026-10-03-navigation-cache-token.md`：真实反馈闭环与冻结 hash。

main 来源提交为 `18b6cbb`，worktree HEAD 仍为 `455d4ad`，不得 reset/整体合并或同步其他 barrel。开工核对两个目标源码与主对应文件差异；若目标不一致，先报告具体差异，勿覆盖。S5 九文件已精确集成，不重做。AGENTS 冻结，候选经验只写本轮记录，由 root 审核。不得修改 Application、ownership、contracts、observer/工具、数据库 schema/migration、依赖、native、desktop/UI 或原失败时限。

## 契约与行为

内部 GraphStore API 可命名 `sampleNavigationValidity()`，返回独立 plain-data 判别联合：有效时 `{ status: "valid", dataVersion, localSnapshotGeneration }`；否则仅 `{ status: "unavailable" | "invalid_type" | "in_transaction" | "closed" }`。原始 token 仅供同一 GraphStore 实例的内部导航逻辑比较，不暴露到 IPC、UI、日志或 benchmark 报告。

每次调用先检查连接关闭与活动事务；事务内不运行 PRAGMA。事务外只执行该连接的 `PRAGMA data_version`，严格验证有限非负安全整数，拒绝 undefined、NaN、Infinity、字符串、负值和不安全整数；异常固定归为 unavailable，不返回原 SQLite 错误。不得读取完整 snapshot、源码、配置、payload 或改写任何行。

所有构造迁移成功后才建立初始 generation。每次 `saveSnapshot` 成功事务提交后推进 generation，包括同内容复用/重新激活、makeCurrent=false；失败不得宣称已提交，可保守失效但不能复用已失效 generation。上界时永久停止提供可比较样本，不回绕/重置。关闭后不可比较，重开是新的实例，不能把相同数字解释为跨实例身份。返回对象无数据库或可变产品引用，调用者改写样本不能改变后续取样。

不改变快照冲突拒绝、源码/历史不可变、current 激活、配置修订锁、评分或胶囊事务。只读 token 不是线性化或多表原子屏障，不能替代下一层 fresh source/配置/工作区验证。

## 完成门与协调窗口

真实独立 SQLite 回归覆盖初次取样稳定、同连接成功保存/相同内容复用与重新激活、保存失败保留原数据；另一连接提交/回滚/删除的可观察变化；读事务中的零 PRAGMA 与事务结束后的新 token；关闭/取样故障/各种坏类型/安全整数边界；两个实例不能用数字相等跨比较；返回对象改写不影响私有代数。故障注入只在测试，无生产开关或新增 setter。核对读取端口零完整加载、零 source/config 读取和零数据库写入。

串行运行适用 graph 回归及 graph/application noEmit，记录原命令与结果、产品/测试/环境失败区别和未验收项，不通过改门槛或删断言消除失败。仅既有 Node/SQLite 测试，无 native/build/dist/Electron/benchmark/模型/GUI。root 当前 S5 验收窗口已结束，可按本边界测试；有冻结交付后 root 独立审查与复验，开发方不自行 Git 收尾。

本切片完成仅表示导航有效性端口可用；缓存、observer 聚合、新工具、性能收益、GUI 和远程质量仍未验收。
