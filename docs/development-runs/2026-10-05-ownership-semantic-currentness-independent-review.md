# Q2 本地语义准备与当前性独立审查

2026-10-05，协调方。仅原第二批 Q2；无真实模型调用或 GUI。Q1 已验基线 main `9d9b3b238038cd675ee52054f84e48be05374e63`，Sol `455d4ad50830ee2495b70927e51caf830a4efbb8` 的既有 WIP 保留。

## 首冻结：常规检查通过，独立探针发现缺陷

原 Sol 回合 `01a10a42-c8b5-7dc1-a4fb-002352f84bc9` completed/idle 后读取实际源码、记录和原字节 patch。patch SHA256 `3CA29B8B8FBFD76D28573B637C14C3B65A73F83E6899C00F3B9097BF759F1B02`；manifest `4302EDF68F09FE2B96AF10B199D7138A73509937FE7C231AEC49232A3BCAA59A`。独立核对正式 331 文件基线：仅 application/index、graph/index、capsule store、question binding store 四个获准既有文件变化，327 原文件不变、零缺失；五个新增文件均匹配冻结 hash，反向 git apply --check 通过。此范围检查不等于产品验收。

root 实际运行开发记录所列 13 个文件的 vitest 命令，`--maxWorkers=1 --no-file-parallelism --no-cache`：443/443，退出 0，187.11 秒。graph/application/contracts/ownership/llm 各 `tsc.CMD --noEmit -p packages/<包>/tsconfig.json` 退出 0。完整原题/history/generator、真实 SQL 同视图、固定 compiled adapter、global→settings→source 锁序及私有 receipt 源码复审已执行。

额外 root 自有真实 TS 索引/可信答题探针在 legacy/project 两布局均退出 0：第一次真实工作区检查完成但延迟返回时改 caller request，实际准备仍绑定原捕获；准备成功后推进时间超过 30 秒，屏障 TIMEOUT 且 callback 零调用；合法消费后同步取消，屏障拒绝且逃逸 receipt 无效；随后新准备可合法消费。全部实际 explanation_tasks、remote_task_registry、remote_provider_lease 行数为 0。测试仅配置自有合成库的 provider 元数据及独立政策，不访问 OS 凭据、用户政策或网络。

随后另一个真实探针复现产品缺陷：先创建 watcher 应用，projectDatabaseRoot 初始为空；自有第二应用在同测试布局实际索引、可信发题和保存答题；watcher.getSnapshotState(ref) 惰性打开后来出现的项目数据库，再由 watcher.indexProject(root) 激活该项目。合法 global provider/独立 semantic grant/context 配置后，实际 prepare 仍返回 `NOT_CONFIGURED`。普通索引、原题与胶囊均合法，失败来自 application/index 中惰性 GraphStore 构造漏传固定 semanticPorts；navigationCandidate、enumerateStores、requireSnapshot、reportContext 的构造路径须一并核对。原始 lazy-probe.ts 保留于 root 本轮独立临时探针目录，实际 tsx 输出 `lazy=true,result=rejected,code=NOT_CONFIGURED`。根因有源码与复现支持；不是外部 API 密钥不足或 GUI 限制。

## 主目录试集成与反馈边界

root 从真实 main 副本逐块试集成首 Q2（四既有源与五新增文件），371 文件 main 基线已备份；没有复制整份 Sol index 或旧 WIP。保留 main activation 发布、导航缓存、迁移 1–11/15 等差异；主目录额外 navigation lazy 构造接线属于集成适配，其他遗漏入口尚待完整修正。main 两布局额外四门探针及五包 noEmit 已通过；同一 13 文件集成回归 443/443、退出 0、191.95 秒。首实现**未接受、未提交、未推送**，常规回归不能否定额外懒载失败。

已成功派回原开发-Sol GPT-6.1 Sol/medium，仅原 5170/Q2 文件边界修正所有实际 store 构造期接线、补真实晚出现数据库回归并更新自有记录。首冻结材料保留；修订从原 331 基线生成精确 patch/manifest。root 主目录试集成保持静止，待修订明确冻结后复验同一个原始失败探针及适用回归。开发不得 Git。

本轮 AGENTS 新增/修订 0：失败尚未完成闭环，不提前沉淀；构造接线发现也不自动增加通用规则。无 build/native/dist/Electron/GUI、凭据读取、外发或导入项目代码执行。SQL 屏障不能冻结文件系统，adapterRequestDigest 不是未来 HTTP bodyDigest；semantic task/transport/发布/恢复/模型质量与 GUI 未验边界保持。原四批还有本地工作，继续原工作流，四批收尾或全剩外部门后暂停定时任务和派发，不第五批。

## 修订冻结：懒加载缺陷闭环，后台独立接受

原 Sol 修正回合 01a10a7b-2b14-7402-ac7e-319ff66f84ba completed/idle 后，root 核最终 patch SHA256 EEA98B5218EA586454254EB7EE0E579B9C1B8D60E6D7B927A959E25CDD2A004B、manifest 34824C405C298498F4EF310A5E47B969243DB34FBFA4CAD63C13FB95B293C74F；九文件实际 hash 全部一致。正式 331 基线仍只四授权既有源变化、327 不变、零缺失。四条遗漏入口均传固定 semanticPorts，实际七个 GraphStore 构造统一接线，不替换已打开实例；新增七项真实懒载/默认拒绝/close/主上下文回转回归。root 对照首冻结仅三文件修订，并从主目录首试副本精确补三条仍遗漏接线、复制最终新测试和开发记录，未复制整份 Sol index。

同一个原始 lazy-probe.ts 在两个目录现在均输出 lazy=true,result=prepared,accepted=gpt-4.1-mini。原 self-created legacy/project 数据库和真实索引/可信答卷路径保持，没有将密钥不足改写成成功，也没有真正访问 OS 凭据或远端。

root 在两个目录运行以下最终适用回归（与首冻结相比补导航兼容专项）：

```powershell
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/ownership/src/index.test.ts packages/application/src/ownership-capsule.test.ts packages/application/src/index.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/remote-explanation.test.ts packages/llm/src/ownership-semantic-prompt.test.ts packages/application/src/navigation-cache.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

main 14 文件 493/493、退出 0、235.14 秒。Sol 同一完整命令 492 通过/1 失败、退出 1、241.15 秒：旧 application/index.test.ts 的“单侧语法错误、左右配置差异和无法映射变化贯穿完整性报告”超过原 5000ms（5084ms），伴随 afterEach legacy.sqlite-shm unlink EBUSY。两目录轻量回归曾并行，是否为资源争用未确认，不把猜测写成已确认根因，也不丢弃此失败记录。

main 完整命令结束后，root 未修改任何源码/断言/超时，在 Sol 单独运行下列原文件：24/24，退出 0，49.13 秒，无 EBUSY。因此 Sol 最终实际证据是完整命令中其余 469 项通过，加同一文件 24 项独立复跑通过；不是一次完整 493 全过的声明。main 完整集成 493 全过提供另一个独立门。未重复无关全套回归。

```powershell
./node_modules/.bin/vitest.CMD run packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

graph/application/contracts/ownership/llm 五包相同 noEmit 命令在两目录各退出 0。main 371 文件原清单最终仅四源和三协调文档变化、364 不变、零缺失；新增测试/模块及开发记录与冻结一致，保留 main activation/getCurrentActivation、导航 cache/observer、旧 barrel 和迁移断言差异。main application/index SHA256 A6CADAD1EB9814DB029B52F383FF02361D03980C1D6CDEAAFB0A1E93483A90A5、graph/index CE1099104C8F3B7228F5568C80277A6D92A20F8703984F1468794E6351DA626D，Git diff --check 通过。

本次仅接受 Q2 内部本地准备/真实材料当前性/一次同步屏障与生命周期后台切片。SQL 中完整旧原题、history cut、generator、胶囊及 material/query/source、独立 policy/provider/context/revision 均重核；旧历史不升级授权。私有 token/receipt 不可重放、跨实例或异步逃逸，不注册 semantic task、占用 provider slot、读凭据或发网络。adapterRequestDigest 仍不是 HTTP bodyDigest，SQL 锁不冻结文件系统，真实发送/发布/统一参与者恢复/语义模型质量及 GUI 仍未验。根因和修正已有原始探针及七项回归支撑，AGENTS 新增/修订 0：现有生命周期/反馈规则足够，不为凑数扩展规则。

源码冻结后仅准确记录和接受范围待协调方 Git 收尾；实际 SHA/远端核对见最新公共审查回执。四批仍有本地工作；收尾后暂停定时任务及派发讨论，不启动第五批。