# 2D-Q3：完整Responses正文接入语义当前性准备

2026-10-05，协调方明确实施授权，限原第二批本地准备。S3-B已独立接受并推送bc608aaa291c1bd0a8747646791ef740bd97c53d；四批收尾暂停，不第五批。复杂跨模块由原Sol/medium仅5170实施，开发不Git、不读改main。

## 代码依据与目标

实际graph/ownership-semantic-preparation-store.ts的trusted adapter仅接semanticPackage/submittedAnswer；prepare用serializedRequest摘要，在保存时structuredClone(adapter)，consume仅返回adapterRequestDigest/requestBytes。实际application/index.ts固定adapter仍prepareOwnershipSemanticRequest。L4已验的prepareOwnershipSemanticResponsesRequest在最终正文中含model、输出预算、严格schema投影、说明及双层JSON，返回完整body/bodyDigest/requestBytes和原prompt validator私有WeakMap中的exact prepared。Q2当前内部摘要不能当HTTP bodyDigest，clone也丢失exact validator引用。共享任务设计B1-body要求实际正文参与绑定。

本切片把实际固定L4构造器接入真实XRayApplication的当前性准备与一次同步消费：完整正文必须针对捕获的实际provider model/outputTokens生成、计预算和独立摘要，在最终锁段仍绑定同材料/设置/私有准备；保留原prompt exact引用用于原严格validator。仍零task/registry/lease/result写、零凭据/网络、零UI，不称发送许可、模型质量或transport完成。

root已在Sol冻结期间精确复制已验L4 source/test，llm/index仅添加其原export，旧prompt两个文件两目录hash全等；Sol该三文件60回归/llm noEmit通过。Sol不得改这三依赖文件，本轮以root同步后的实际字节为基线，S3-B六文件和旧WIP全部冻结。

## 文件边界

允许既有文件：packages/graph/src/ownership-semantic-preparation-store.ts及.test.ts；packages/application/src/index.ts（仅固定semanticPorts adapter接线/相关类型import，七个GraphStore构造和其他旧WIP保持）；packages/application/src/ownership-semantic-preparation.ts及.test.ts（仅需要的内部返回类型/精确引用接线）；packages/graph/src/index.ts（只有确实必要的该内部类型export/薄转发，不动迁移/缓存/其他端口）。自有新docs/development-runs/2026-10-05-ownership-semantic-fullbody-currentness.md。允许新建紧邻准备模块的纯内部类型小文件时先说明必要性，不扩大生产能力。

禁止contracts/llm/ownership/analyzer/remote/shared-task存储、desktop/broker/UI/native/package/lock/AGENTS或公共队列修改。无新增迁移；原main11/Sol12、global14/16/source15及旧断言保持。不得通过graph runtime import llm外层实现倒置依赖；构造由application固定注入，graph使用窄结构类型描述可信内部返回，不提供caller adapter参数/成功flag或新IPC DTO。

## 行为与保证

1. 实际准备捕获provider/model/outputTokens及原材料、语义独立授权、main generation等完整Q2身份后，将真实本地package和提交答案送入固定L4构造器；模型/预算来自该捕获，不接受caller设置。构造期间所有既有两次工作区、取消/超时、close、后一次替换前一次、lazy store实例门保持。超完整正文64KiB失败关闭，固定REQUEST_TOO_LARGE，零新SQL/网络；内层合法但外层超限仍拒绝，不能裁剪材料或放宽validator。
2. 保留原adapterRequestDigest及原prompt requestBytes口径，不静默重新解释旧字段。增量绑定完整bodyDigest/body字节数及模型/输出预算；明确二者不同。完整body和exact prompt prepared只在私有内部准备链中保留，无SQL/日志/renderer/IPC暴露。可以在可信内部consume返回有限完整正文摘要元数据及实际固定构造器的只读准备引用供后续传输接缝；该引用本身不授予许可/停止证明。
3. 不structuredClone/重造需要WeakMap身份的原prepared。原内部prompt捕获可另保留私有有限canonical preimage，不把exact引用混同材料摘要。锁内重核body实际UTF8字节/hash/canonical私有preimage、真实provider完整revision/model/输出预算、原package/原题/attempt/capsule/source/settings/main身份；必须仍匹配实际固定构造器建立的绑定。不能用caller hash/schema或callback自报成功开门。
4. withRevisions与consume原一次/作用域/实例规则保持；clone token、跨store/重开/close、Promise/thenable/异常/未消费、过期均拒绝。不得改成跨await持锁、给同一token两次consume或将外层构造成功当最终当前性。原exact inner prepared可实际通过既有validatePreparedOwnershipSemanticResponse；克隆inner prepared必须按原validator拒绝，不因为新类型或序列化回填WeakMap。
5. 真实材料仍由可信生成器/持久原题先于提交cut及当前snapshot认证，原确定性分、引用roles、胶囊/原题绑定/源码/掌握记录全保持。默认未配置/独立授权denied仍拒绝；feature grant不授予semantic许可。真实远程provider/credential/body发送、semantic持久任务/结果、二次durable reserve/注册、发布/统一停止恢复另门，当前不实现也不做替身生产调用。

## 最小充分独立交付

真实TS索引→可信出题/提交→SQL材料→固定完整Responses构造→Q2两布局同步consume，覆盖四题型/空非空ignore，报告两摘要实际不同、最终完整UTF8/hash匹配、body实际model/output设置及原exact inner validator通过，inner clone拒绝。原确定性分/材料/源码保持，task/registry/lease/result行零。

覆盖inner合法outer超限、构造等待时caller/close/替换/取消/超时、provider model/输出预算/revision变化及改回、独立政策/配置/上下文/source/query表/原题cut/main A→B→A等原Q2回归；充分重算错误材料摘要也不能认证。一次消费/escaped/跨实例、真实SQL锁挑战、所有lazy七构造仍固定端口。严格错误诊断不含正文/答案/凭据；构造错误准确映射，不吞取消或把预算异常称配置缺失。

冻结后交root原→后patch、允许文件hash、全原文件不变manifest、实际命令/反馈闭环。至少运行graph/application准备两文件、原question-binding/capsule/ownership/S2、S3-B六文件必要兼容、L4纯三文件及graph/application/llm noEmit；单worker/no-file-parallelism/no-cache，不与其他目录回归并发。按适用风险而非无变化全库重测。AGENTS候选只写自己记录，可0；root再独立真实索引复验及main精确集成。无重型/native/Electron/GUI/secret/env扫描/真实HTTP/导入代码执行。完成不代表四批全部完成。