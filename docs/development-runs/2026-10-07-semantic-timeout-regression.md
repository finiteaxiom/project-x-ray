# B2 超时回归：deadline就绪与目标时钟范围

2026-10-07。原四批S3-C/R所需回归闭环，仅B2 test和本记录；不启动第五批，不改产品源或完整恢复契约。

## 基线与授权边界

先读取协调方具体任务、独立复验记录、当前AGENTS，核实际HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`及179条既有Git状态。以上一完整性修复manifest（SHA256 `1D01420022F76A8EABD89CA905BD24F997EBFEEEBAE268F32EDE2AC6969589FC`）逐文件重算，373/373匹配；全部原字节另存本轮before。保留旧WIP与三文件完整性修复，不reset或Git写入。

仅获准修改`packages/application/src/ownership-semantic-application.test.ts`及新增本记录。application/B2生产source、graph/core source/test、共享迁移、broker/desktop/UI、公开契约、AGENTS、依赖与全局配置冻结。主目录只读已明确授权的协调方材料，没有运行会写主目录的root drivers。

## 实现 → 验证 → 失败诊断 → 修正 → 再验证

1. 本轮首先运行原正式三个timeout：3失败/78跳过，exit1，16.99秒，均原默认5000ms超时。旧失败记录保持，没有将其归为已消失的restricted reader/声明问题。
2. 读取root插桩源码与记录，核生产`start`在异步`beginOwnershipSemanticExecution`之后才设置committed并调用watch；watch同步安装25ms政策轮询和60000ms deadline。测试工厂通知早于此门，不能将worker创建当作watch就绪。
3. 先在正式test只加入call-through的实际watch观察门，保留原完整模拟时钟范围，再运行相同三个timeout：仍3失败/78跳过，exit1，17.01秒。这与root观察一致：仅安装就绪门不足以修复。root曾观察模拟60001ms驱动2400次真实SQL轮询，未替换SQL结果；其5833/5937/5555ms在另一个进程并行期间取得，只作为时钟推进开销证据，不作为独立性能基线。本轮没有把同一读数冒称自己的新测量。
4. 正式修正只模拟deadline需要的setTimeout/clearTimeout；第一用例继续模拟Date，两个重试用例保持原本不模拟Date的语义。setInterval/clearInterval使用真实时钟，生产25ms轮询仍执行，不会在模拟一分钟时同步强跑2400次SQL。
5. 实际就绪门对flow.watch和source.ownershipSemanticExecutionState仅作call-through观察，不替换任一生产函数返回。watch安装最多100次、每次原生10ms等待；随后同样有界等待一次真实政策SQL轮询。核实际slot已committed、deadline/poll都安装及模拟目标timer存在。没有用普通callback或事件冒充native停止。缺失安装/轮询会明确失败；门通过后才推进60001ms，真实TIMEOUT仍由原60000ms deadline产生。
6. 原三个正式timeout修后3通过/78跳过，exit0，5.10秒；所有原断言保留，另外给两个timeout重试分支明确TIMEOUT码断言，避免取消代超时。检查仍覆盖实际worker最终-1、精确lease0、原T1、旧task/答题/源码保持、同实例新preview不隐式执行及第二worker完成。未缩短60000ms、提高5000ms或删除正确断言。
7. 自有ignored只读AST核验脚本提取原/新expect表达式语句：原152个全部按文本及重复数量保留，新159个（新增就绪/真实轮询及TIMEOUT检查）。AST核验不替代运行测试；源文件修改只为观察门与目标时钟范围。

8. 启动完整组合时误带不存在的`packages/application/src/shared-none.test.ts`过滤项，立即中止，exit1且没有测试结果；这是命令缺陷，不是产品或环境失败，不计验收。随后删除该路径，以原19文件清单重新运行。

## 本轮实际验证

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/ownership-semantic-application.test.ts -t 'timeout' --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\vitest.CMD run packages/application/src/ownership-semantic-application.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-task-lifecycle.test.ts packages/application/src/remote-recovery-capability.test.ts packages/graph/src/remote-task-recovery-store.test.ts packages/application/src/ownership-semantic-application.test.ts packages/graph/src/ownership-semantic-invalidation-store.test.ts packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\tsc.CMD --noEmit -p packages/graph/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/application/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/contracts/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/llm/tsconfig.json
```

- 定向3/3通过，如上；B2完整81/81通过，exit0，87.18秒。
- 原19文件834项组合沿用上一core记录的完整命令与参数：19文件通过、834/834通过，exit0，440.36秒（tests424.18秒）。没有测试过滤或扩大超时。
- 四包原noEmit全部exit0；不加any、修改配置或安装声明依赖。
- root真实未缩短60000ms的split收据本轮只读核对：60078ms/TIMEOUT，两个native threadId=-1、原T1与原答题/源码保持、人工重试完成。这是协调方既有实际计时证据，不称本轮重新运行，也不替代正式两布局回归或真实HTTP/GUI验收。

## 冻结、限制与规则判断

本轮交付以当前373为before，仅B2 test改变、新增本记录；最终before373→after374：旧B2 test改变1、新增记录1、其余372原字节保持。完整before/after/保持hash和patch逐hunk精确重构核验通过；新增记录包含new file mode 100644及/dev/null旧路径。旧完整性修复三文件原hash保持，不覆盖旧交付。

本轮AGENTS新增/修订0。先按当前规则评估去重：真实提交/资源终态与回归证据规则已有覆盖；此为明确测试时钟协调缺陷，适用范围及纠正动作已在本记录说明，且AGENTS明确冻结。没有据此改产品时限或安全门。

没有产品源修改、Git收尾、build/native/dist/Electron、GUI、HTTP、凭据操作或主目录写入。正式文件回归通过后仍由协调方独立验收；本轮不宣称生产接线、所有重开执行域停止证明或四批整体完成。
