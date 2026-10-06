# 2D-B1 可信语义持久预占用独立验收

本轮接受原第二批的封闭零发送后台切片。实际 Q3 私有材料生成完整身份，global 外层提交 reserved 后才签发 opaque 票据；取消只能消费本实例尚未 dispatch 的票据。未实现发送、结果公开发布或统一停止恢复，真实 GUI 与 API 均未验收。

## 冻结来源与源码核验

Sol HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8；before 353 文件，after 358。root逐项重算358文件hash，零不符；仅四授权旧文件改变、五新文件，其余349不变。before baseline摘要2B1887359D2DC7A5C376BA87AF88E4C09CEDFF2BDA7B4AA6297489E95DE7896C；最终manifest 29578E3F9948A97C8C028704835D6B3D808DEBA9A733469B9EA9A5BA28F428EE，patch 0B0B729B28229856E291C3B9D6E85B24303B6357E4778A16C3C1167D7F91D413。反向patch检查exit0，旧WIP未重置。

root核实际Q3捕获、私有issuer、GraphStore委派、ledger和应用源码：caller不能提供identity/正文/成功校验器；保存胶囊ignoreRevision与当前配置严格闭合；身份和正文摘要取实际材料。global→settings→source锁去重，附属只读锁保持到权威外层COMMIT/ROLLBACK之后才释放，已有外层事务拒绝。仅权威提交与附属释放都成功才签发票据；提交后附属释放失败保留持久占用，固定失败不冒称零写。取消terminal/release同事务，失败保留ticket及占用；close仅撤销内存能力，重开不自动清理。没有dispatch/provider/credential/result端口。

开发早期嵌套事务提前释放附属锁的实现缺陷已在冻结前修正；实际两连接锁断言与释放故障回归随最终源码交付。具体类型及夹具失败、确认根因、修正见2026-10-05-ownership-semantic-reservation.md，早期89/579自测不作为本轮证据。

## root独立运行

Sol原14文件完整组合582/582，149.69秒，exit0；main精确集成后同组合582/582，149.97秒，exit0。两目录graph/application/contracts/llm各noEmit均exit0。完整Vitest命令与四包命令见开发记录“实际最终验证”，root执行原命令，无删断言或替换套件。

root另用实际索引→原题发行→确定性答题→持久胶囊→实际Q3/Responses构造器→实际SQL的独立probe，四题型×双布局×空/非空规则共16门，两目录各16/16通过。Sol收据`.benchmarks/b1-independent/runs/3a1b12fb-28d2-499b-b8e4-d5cc43d52888/receipt.json`；main收据`.benchmarks/b1-independent/runs/4b3811a4-125b-405e-bcb0-9c1a588e23b7/receipt.json`。脚本`.benchmarks/b1-independent/probe.ts`与fixture保留，不是生产入口。

probe独立重算实际UTF-8正文SHA与完整33字段身份，第二连接读取真实首次reserved/T1；prepare零SQL，reserved零semantic task/结果/发送。普通/跨实例/重复票据拒绝；真实RAISE(IGNORE)取消释放故障确认整事务回滚及原ticket可手动重试；真实deferred FK global COMMIT失败零票据且SQL不变，之后新prepare正常。close/reopen保留committed reserved占用，旧成绩/材料/源码不变。所有自建材料保留，无HTTP、用户授权操作、密钥扫描、导入代码执行或删除。技术夹具中的合成许可不证明真实用户GUI选择。

## 精确main集成与未验边界

main原404文件baseline C02900B759043781DF66E332B87F42A7ABE843538EE1E20BE66A25105F7C6AFE；只四授权旧源/测试改变，另400旧文件hash不变。Q3两文件和四新源/测试及开发记录复制精确冻结字节；index仅集成B1类型/私有生命周期/委派，index.test只加本批生命周期断言。Sol index完整patch在main旧缓存上下文read-only check失败，root保持main既有11与Sol12差异，未整覆盖。该集成上下文差异非产品缺陷；实际集成组合与类型全过后接受。

已实现并独立代码/回归验证：可信本地prepare→持久reserved→有限票据→未发送取消，真实SQL失败与保留边界。真实GUI0；生产发送/当次dispatch门、结果公开发布、统一参与者停止及崩溃恢复、真实API兼容/质量均未验，不标整批完成。本轮AGENTS无新增，现有配置锁、真实COMMIT及精确SQL写后核验规则已覆盖；反馈证据留开发记录，避免重复规则。

仅本批已验后台与准确协调记录由root核实际Git范围后收尾，真实SHA另记；开发未执行Git。原四批仍有可推进本地接线，定时保持，收尾或仅剩外部门后暂停，不启动第五批。

Git暂存diff检查发现新应用测试末尾多一空行；root仅去末尾空行，不改测试内容/行为。该main格式差异单独记录，冻结Sol原件保留。

## 2026-10-06 00:41：B1实际Git回执及B2实施依据

root普通提交B1 66965f4308dfe8a254fb718a5ec2ba2e0b7362b6，共15文件已验后台/测试/记录及原R1准确回执，cached diff --check通过。首次push远端拒绝ref锁，报告远端已同66965f4；独立ls-remote核实际main完整SHA相同，再次普通push exit0 Everything up-to-date。没有force、合并或开发Git；不能把首次拒绝写为成功。提交后main清洁；新计划与本回执属后续记录未纳入该SHA。

按实际Q3 continuation缺失、B1无执行/结果端口和A2/R1均内部的源码依据，形成2D-B2当次执行与可信发布实施计划2026-10-06-ownership-semantic-publication-implementation.md，精确同步原5170，不覆盖WIP。仅内部执行替身验证，保持生产semantic/HTTP/desktop/UI关闭、统一参与者停止恢复未验；source提交与global完成非原子，迟到/失败占用/补偿门不得降低。不是第五批或填槽任务，原Luna仍冻结。Git回执与后续派发随下一已验切片收尾。