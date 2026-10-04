# 2D-Q1 新提交可信原题绑定

2026-10-05，原第二批、原 Sol/medium 仅5170。root 已独立接受修订 S4-D（设计SHA 7AD175097FD8BD31B4B56CA602B6CE843C69AA0A86A076E689ACFE7EDDF34216）及 L3纯record；四批收尾暂停，不第五批。本任务交付新提交本地端到端绑定，不接远程任务/授权/提供商/IPC/UI或Q2当前性barrier。5170 HEAD仍455d4ad，全部旧WIP/已验A1/S2保存，不整体同步main。

依据当前真实生成器、私有发题map、capsule私有receipt与SQL历史缺完整原题；实施已接受设计Q1，不能由历史自洽摘要生成认证。root 正式分配新增迁移 **15，仅 ownership_question_bindings 本地材料表**，global legacy source及project source均适用。已有10/11/main项目11/Sol项目12/13/14记录不改、不重排；项目不得获得global13/14政策或占用表。15不代表semantic task/result迁移。

## 精确文件边界

新增 packages/contracts/src/ownership-question-binding.ts及.test.ts，contracts/src/index.ts仅单export；packages/ownership/src/index.ts抽取同一候选生成/排序、固定版本及纯认证helper，ownership/src/index.test.ts；新增packages/graph/src/ownership-question-binding-store.ts及.test.ts；graph/src/ownership-capsule-store.ts及.test.ts；graph/src/index.ts及index.test.ts只同连接端口/固定generator构造注入/15材料迁移及必要适配；packages/application/src/index.ts仅私有题目entry发行capability/提交参数和可信compiled generator组装，application/src/ownership-capsule.test.ts；自身新docs/development-runs/2026-10-05-ownership-question-binding.md。

其余全部冻结，包括AGENTS、A1共享store、S2政策store、remote application、旧broker/cache/desktop/UI、LLM、包锁与别的记录。发现必要范围差异先给root具体依据，不自行扩改。编辑前保存上述旧文件实际字节到自己的临时目录、hash及全部现存Git清单；不能用HEAD旧状态代替含WIP的真正原副本。交付精确原→后patch、冻结hash/新增文件、实际命令/失败分类。developer不得Git。主index与Sol有旧cache差异，root后续只按patch适配，不复制整份index/app/AGENTS。

## 行为与契约

严格沿修订设计：完整canonical question≤128KiB；明确字段投影basis≤8KiB（版本、真实request/candidateIndex、generatorInputHash、historyCut、有序匹配历史hash/witness、publication source身份、locale/完整collator options及orderingEngine、createdAt）；不展开任意完整分析对象或复制全部源码/答案/快照。verified/unavailable严格有限DTO、列/payload闭合，unavailable≤2KiB基本身份/hash+有限reason。旧history缺binding只返回legacy-unbound，不回填、不改原attempt/capsule/mastery/source。来源损坏固定失败，不自动降级/修复坏行。

Graph不导入ownership实现；应用构造时硬接已编译纯generator端口，graph使用真实SQL材料。request解析后私有捕获，settings→source同步锁核revision/activation，发行WeakMap capability并私有map持有；公开接口只返回clone。发题本身无SQL写。首次await前捕获question/issuance/submission，原并发/替换/close检查保持。未通过题原capability可重复本地答题，passed/替换/配置失效/close注销；每个prepared write仍一次消费。不由DTO/renderer/callback声称可信，不从历史恢复已删题。

prepare核实际SQL/同generator完整preimage与私有发行来源；save在原settings.withIgnoreRevision→source IMMEDIATE内重核材料/历史截点、同步generator输出及prepared完整身份，原attempt+capsule+binding同事务写并精确读回，故障三者零写。沿原胶囊及引用projection核验，不第二套grader。旧无capability内部API可离线兼容，但新行仅unavailable/untrusted-issuance。

**原生成/评分行为保持**：call-path实际对象join及默认sort原样不修；Map前concept过滤后的同id异preimage观察只影响新认证ambiguous-generator，保留Map最后值/首次插入位置/count及全部原题/grade行为。成对全legalNodePaths/legalEdgePaths及变量完整角色顺序不裁；重复citation原roles与规范索引沿既有projection。正常append发行historyCut排除后来提交，不按completedAt代cut；retry只影响retryOf，不新增避重策略。locale/Node-V8-ICU等ordering不兼容只拒认证，旧本地阅读/发题/grade照常，版本相同仍完整重建；不声称rowid防整体人为重写。预算超限仅小型unavailable，不删路径或缩小旧question值域。

新15迁移须版本化、事务、关闭重开、角色隔离、半结构/坏行失败关闭；不悄悄补表或重写旧历史。若原max-migration断言因明确新增15不再适用，保留旧11/12等marker和原语义检查，说明变化并增加真实旧库→15断言；禁止盲目改数字、删安全或symlink EPERM正确断言。

## 完成门槛

按设计第8节最小真实四型×legacy/project×空/非空配置：真实索引→发题→原评分提交→三行原子→关重开→完整generator认证，历史仍not-checked非发送许可；不改原分/source/mastery。真实对象variant碰撞验证本地行为等原generator而认证unavailable；任一完整路径/混拼、变量重复roles精确回归。假prompt/objective/choices/checks/范围和request/candidateIndex/排序，重算全部摘要仍拒；发行后回退时间attempt不改旧cut，修改匹配历史/witness拒；旧binding缺失/无capability/预算/unsupported engine保持本地兼容。

首次await后caller变动、同map重答/替换、app/store close、配置第二连接改变；新binding INSERT与合法读回篡改故障三行回滚，移故障重试/旧数据不变。实际来源不同库/项目与同snapshot A→B→A不借旧capability。纯结构测试不替代真实生成/SQL。全部只自有夹具，不执行导入项目代码或网络。

串行单worker/no-file-parallelism/no-cache跑必要新contract/generator/binding/capsule/S1/index/application答题及旧remote兼容回归；contracts/ownership/graph/application noEmit。不用无变化反复全包测试；重型build/native/dist/Electron须root单窗口另协调，本任务不运行。冻结后root独立审查/适用回归/精确main集成才接受；Q2/barrier/任务/durable传输/全参与者停止/GUI/模型全未验。AGENTS0允许，本次只自己记录，root后续逐条核经验。
