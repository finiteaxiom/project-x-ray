# 2D-Q3 完整 Responses 正文与语义当前性准备

2026-10-05，开发-Sol，5170 checkout，仅原第二批 [Q3 派发](../plans/2026-10-05-ownership-semantic-fullbody-currentness-implementation.md)。计划 SHA256 `CB64F1640DB9207D73A274A6997B7E1609CAA9F850D0AF8F84303ADD355A3229` 核对一致。root 同步已验 L4 后的实际341文件及六允许文件字节副本为基线，开始时逐一hash无漂移。没有用 HEAD 或其他 checkout 的整份源码覆盖 WIP。

## 实现与边界

- application/index 仅更换固定 adapter import/接线为真实 prepareOwnershipSemanticResponsesRequest；原七个 GraphStore 构造和旧工作流不改。graph 仅描述窄结构返回类型，没有 runtime 导入 llm，也没有新增 caller adapter/成功 flag/IPC DTO。
- 完整 Q2 身份捕获后，将实际 SQL package、原提交答案及已捕获 provider model/outputTokens 送入固定 L4。原两次工作区检查、完整 preimages、原题截点/可信 generator、独立授权、实际 store/main generation、超时取消和锁序保持。
- 原 adapterRequestDigest 仍摘要内层 serializedRequest；原 requestBytes 仍是 prompt 字节数。新增 bodyDigest/bodyBytes 分别为完整 Responses body 的实际 SHA256 和 UTF-8 字节数，不混用两种口径。完整 body 的 model、输出预算、instructions、嵌套 input、store/stream/strict schema 元数据必须匹配实际构造；最终屏障重核原材料/设置及完整正文私有 canonical preimage、字节、摘要。
- 保留固定 L4 返回对象及其中 exact prepared 原引用，不再 structuredClone(adapter)。可信内部消费增量返回两正文摘要元数据和只读准备引用；原 validator WeakMap 身份有效。clone inner prepared 按旧 validator 拒绝，引用不是发送许可或停止证明。
- inner PROMPT_REQUEST_TOO_LARGE 和 outer REQUEST_TOO_LARGE 均映射固定 REQUEST_TOO_LARGE；不存在裁剪正文、路径、roles、答案或放宽预算。普通构造错误固定为材料错误，不改称未配置。
- 零 task/registry/lease/result 写入，零凭据/网络/UI。没有新增迁移或 semantic transport，S3-B 六文件及全部旧 WIP 冻结。

## 实现与验证反馈

本轮没有观察到产品失败或测试失败，不编造修正循环。

1. 固定接线及窄类型/私有引用实现后，原准备两文件扩展验证73项通过。旧 prompt 单独构造仍用于比较，明确证明原requestBytes/adapterRequestDigest口径保持。
2. 新增专项九项通过：实际完整构造完成后仅延迟真实返回，检查 caller 迟到修改、取消、超时、替换及关闭；另检查 provider model、输出预算/revision 和context变更再恢复拒旧准备。故障控制真实结果返回时点，不替换生成器、validator或正文成功结果。
3. outer预算用例真实索引、可信发题及保存大材料，先确认 SQL package 为ready，内层实际 prompt 构造合法且<=65,536字节，再确认固定 L4 外层构造超限。整条应用准备返回固定预算错误，完整答案和SQL行不变；没有用仅capsule降级的用例冒充outer预算证据。
4. 最终按下列15文件命令通过530项；graph/application/llm三包noEmit各退出0。实现随后未再改变，仅完善记录和冻结交付。

```powershell
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/ownership/src/index.test.ts packages/application/src/ownership-capsule.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/remote-explanation.test.ts packages/graph/src/index.test.ts packages/contracts/src/remote-explanation.test.ts packages/llm/src/ownership-semantic-prompt.test.ts packages/llm/src/ownership-semantic-responses.test.ts packages/llm/src/openai-responses.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/llm/tsconfig.json
```

四题型 × legacy/project × 空/非空ignore的16项真实索引矩阵，实际SQL和固定完整构造后一次消费成功。分别比较内层摘要、完整body摘要与实际UTF-8字节，检查body真实model/预算；exact inner validator实际通过而clone拒绝。全表行前后相同，原分/角色/材料/源码保持。构造等待中的caller用例另断言消费引用与实际固定构造器返回对象和inner对象分别严格相同。

原Q2默认未配置/未授权、feature-only grant拒绝、lazy晚出现数据库及实例保留、配置/独立政策/provider/context/source/query/原题cut/main A→B→A、充分重算摘要、取消替换、超时、close、跨实例/clone/重开、一次/逃逸receipt、Promise/thenable/getter/异常/未消费及真实三角色SQL锁挑战保持。原Q1/capsule/ownership、S2、S3-B及L4纯三文件回归也通过；没有无变化全仓重复验收。

## 冻结与未验证项

相对341字节基线，仅 application/index、application准备测试、graph准备源码与测试四个既有文件改变，其他337原文件逐一hash保持；新增本记录。graph/index和application准备薄转发无需变更。完整原→后patch、允许文件hash、全341前后清单独立交付；冻结 L4 三依赖、contracts/ownership、S3-B、cache/desktop/broker/UI/native、包锁、AGENTS及旧记录不变。

没有 Git、其他 checkout 访问、GUI、重型构建、真实 HTTP、OS凭据、环境秘密扫描或导入项目执行。不声称远程模型质量、实际transport发送、semantic持久任务/结果、durable注册、发布或统一停止恢复已完成；完整构造是本地准备，未来发送仍需要其独立全门。四批完成状态仍由root协调，本切片不启动第五批。

AGENTS新增/修订0，规则文件冻结。本轮exact WeakMap引用、完整正文预算与私有捕获要求已由当前派发/既有证据规则覆盖，未提出新的公共规则。过程记录与自测不替代root独立真实索引复验及接受/Git。
