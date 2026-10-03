# T2 导航工具独立验收

2026-10-03 19:17（北京时间）；协调方，主checkout。GUI按用户暂缓要求未执行。

## 首版稳定边界与实际检查

Luna首版回合completed/idle，实际cursor `a764dd3e-58c3-42dc-9d10-445092296241:13`。实际Git HEAD `ce1b9b547ebd29a5eab8c98110a2412aea12eb58`；T2四新文件未跟踪，另有root两记录补记。三个源码hash与开发交付完全相等：parent `77ED0EDD44BEFEF01FF12A3CD84E725DD6D3C15C5E5F95559BB0611169E3E87A`，child `F7E95CD2E1BB073561C7561EA74A114D66FF3ADA5CA45DDBDA1F4EAB8A44937F`，test `EEEE625911C91D3371E0E9498586CA4DD24DC534A9408265ECB2D6F5B4B80784`。核对本批记录与当前公开C2端口、原v1实现，独立阅读协议/计数关系、生命周期、目录/资源和导航实现。

root独立实际命令：

```powershell
pnpm exec vitest run benchmarks/local-index-navigation-optimized.test.ts benchmarks/local-index-navigation-diagnostic.test.ts
pnpm exec tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --forceConsistentCasingInFileNames --skipLibCheck --resolveJsonModule --allowImportingTsExtensions --types node benchmarks/local-index-navigation-optimized.ts benchmarks/local-index-navigation-optimized-child.ts benchmarks/local-index-navigation-optimized.test.ts
pnpm exec tsx benchmarks/local-index-navigation-optimized.ts --help
pnpm exec tsx benchmarks/local-index-navigation-optimized.ts --pairs 1 --timeout-ms 180000
```

22项/2文件通过（675ms），完整严格类型exit0；原CLI help与单对exit0。该自有临时run `2efe8dad-c114-4e79-a14e-14743a0affd9`，报告70102字节，Node v24.17.0/Windows x64/better-sqlite3 13.0.3。childClosed=true，无forcedTermination；每阶段getEvidence/readSource各1177，总4708，实际导航full-load各1合计2；工具自身11门true。冷/暖wall 1264.0018/1258.5094ms为一次首版诊断值，不是正式三对或可信性能结论。

## 确认的语义门缺陷

root新增ignored自有验收探针，不修改产品/工具源码：

- `t2-navigation-response-adversarial.ts` SHA256 `A77B8B64DF047BB085804E04B6D1BA63F84A3B79A8295F88A3D58396CAF7EC76`
- `t2-navigation-response-adversarial-child.ts` SHA256 `288FDCF797847E136F715DDEC7F1F649DBEE1BEE0281C20748BDAA45CAE70281`

文件位于ignored `.benchmarks/remote-desktop-review-20261002/`。实际命令 `pnpm exec tsx .benchmarks/remote-desktop-review-20261002/t2-navigation-response-adversarial.ts` exit0。每型建立唯一受管run并通过原runControlledOptimizedChild运行真实medium child；索引、SQLite、C2 observer与全部导航均真实。仅在公共readSource正常返回后分别改变content、targetSpan行号或source.evidence范围，不伪造终态帧、不调用远程、不执行样例代码。三型child均closed/exit0，无protocolError，误报completed/OK、全部11门true、optimization passed。

| 受控错误响应 | 保持项 | 应有结果 | 实际首版 |
| --- | --- | --- | --- |
| content替换成错误控制文本 | 声明contentHash及其余字段 | 内容重算或期望比对失败 | 全门通过 |
| targetSpan起止行999999 | filePath及其余字段 | 精确范围核验失败 | 全门通过 |
| source.evidence.span起止行999999 | evidence ID及其余字段 | 完整源码证据核验失败 | 全门通过 |

根因确认：resolveNavigation只比较声明hash和部分ID/filePath；resolved manifest没有核验或包含实际content与完整source target/evidence。冷/暖一致错误仍可相等，不能证明响应正确。旧v1存在相同部分核验写法，但本批不改冻结v1；T2明确完整结果门必须满足，不能以继承旧写法豁免。

## 反馈与状态

19:17已附实际三型复现、预期、根因和四文件边界派回原Luna，修正回合 `01a1017c-052c-73c3-9975-1d78514aebef` 已active，cursor后缀14。允许在既有新文件提取共用纯核验函数；要求当前snapshot/固定样例的完整归属、文件语言、精确证据/目标范围和实际content/hash核验，错响应semantic failure/不可比较。保持原11门、1177/4708/≤2、顺序/计量/容量/隐私门，重新冻结后root复验。Sol保持原冻结idle，无同批竞争。

首版T2未接受，未提交；正式三配对暂不执行，第二连接challenge、整工具cancel/timeout仍待修正稳定后实际检查。正常单对和22测试不能掩盖反例漏检。GUI/真实远程/Windows发布外部门保持未验。本轮AGENTS新增0；该确认缺陷暂记本验收记录，修正与复验后再判断是否有未覆盖的通用经验。

## 2026-10-04 00:43：修正后的独立复验与接受

按用户暂缓电脑操作的要求，本轮只做源码、回归、严格类型与真实 Node/SQLite/CLI 技术验证，GUI 为0。main 基线5264f39b1d195c84c8510f2d4ed0dcc664d023c1。Luna修正回合01a1017c-052c-73c3-9975-1d78514aebef completed/idle；实际wait返回cursorReset后，新cursor为5f905603-9e05-4a70-bae4-5e6a5162a670:1，冻结确认回复后为:2。Sol旧已接受C2回合idle，重置cursor为cfe7da2a-d1e4-4a1f-9168-182cb9c80d36:1；重置返回旧交付不作重复验收。

实际四文件hash与交付逐字匹配：parent27F91337E3AE9A65356CFE00F04B3240D16F9A7D9B501A70D78879C97710BB0F，childD997304140AB0A784EC538B803997470E0F8463D4E1BD43338CE113779E62FE7，testFEF9923F1B5A97E4E91AEB33F92819AB8B2E0CC79446A5358290DE2FBD04227A，开发记录8601FA4E3A17CD9C44BC06278BBEDA99D118F2300AF44DF1C00502FA6CFDFB5F。复验后再次核对三源码及C2/v1/helper/样例冻结hash，全部不变。Luna继续冻结，root独占真实运行窗口。

修正源码复审：cold/warm均调用共用navigationEvidenceResponseFailures；完整IdentifiedEvidence、当前snapshot、固定样例/sourceFile、实际UTF-8字节及重算SHA256、content/currentHash/language、完整targetSpan/source.evidence逐项核验。错误仍进入原navigationResolved门，原schema、11门、1177/4708及≤2不变。完整核验计入wall/evidenceLoop，在应用API/store计时外；不能直接比较旧v1 wall声称百分比提速。

root实际23项/2文件回归通过（775ms），上述同一完整严格TypeScript命令exit0。原三型实际对抗探针重新运行exit0：三个真实child均closed/exit1、协议有效、terminal failed/EQUIVALENCE_GATE_FAILED、navigationResolved=false、optimization failed。失败码包含SAMPLE_SOURCE_NAVIGATION_MISMATCH；原其他10门不被盲目改写。三反例漏检已独立复验修正。

### 第二连接真实提交挑战

实际命令：`pnpm exec tsx .benchmarks/remote-desktop-review-20261002/t2-external-commit.ts`，exit0。准备阶段两探针hash保持97ECC267E7D6954405DFC054A635000A6E38170EDC24FDE6AC98D53B6D0C29F3/B0431F5B6B23AB1A8CEE9382A42D79CAF5BE6CB11C4B08F46E9CFB3C75FC2166。每型为唯一自有临时项目库，第二SQLite连接仅对snapshots.root_path做实际变更；payload、事实、来源、createdAt、排除配置及current记录保持，不以同值UPDATE假造变化。warm索引的合法current晋升不作为材料破坏。全程不执行样例代码、远程调用或凭据操作。

| 切点 | 实际提交 | cold full-load | 两阶段full-load | 实际观察与后续 |
| --- | --- | --- | --- | --- |
| 首个候选构造读取后 | 1 | 2 | 3 | build_after external_only=1，candidate丢弃，下一lookup reload=1 |
| 外部重建读取后 | 2 | 3 | 4 | build_after external_only=1，candidate丢弃，后续reload=2 |
| cold末次readSource正常返回前 | 1 | 1 | 2 | after_last_lookup external_only=1，不能漏掉终点变化 |

三型均完整每阶段1177次两API、原11门true、protectedMaterialsUnchanged/appClosed=true、无challengeFailure，优化结果严格为inconclusive_external_write。即使第三型full-load=2仍不能算可比较通过。三个挑战不进入正式性能分母或汇总。

### 正式单次三配对

实际原CLI命令：`pnpm exec tsx benchmarks/local-index-navigation-optimized.ts --pairs 3 --timeout-ms 180000`，exit0。runId0d053717-b015-4b4a-a96a-6dc5e391a7a1，唯一受管临时根report.json为206848字节，小于256KiB。Windows x64、Nodev24.17.0、better-sqlite3 13.0.3。三child均exited/exit0/closed，无forcedTermination、协议错误或外部变化。七个根计数依次为3/3/3/3/0/0/0：有终态摘要、语义有效、性能可比、优化通过、外部写不可比、外部观测不足、未启动。

每配对完整4708 API调用，三个配对共14124；每配对全部11门通过，总33项。cold/warm各full-load=1，总2；相对冻结v1的同调用4708完整load基准满足计数目标。另用不导入工具/产品的独立校验器实际检查报告：`node .benchmarks/remote-desktop-review-20261002/navigation-optimized-report-independent.cjs <该自有报告>` exit0，确认真实storage分项、API数、候选终态、O/R/Delta、准入上限、完整可比较观察及七根计数。校验器hash5AE567036CED32CCAB51ACFBB5E80F1F4F4CBABCDC074271282B0E8FF33DC8A9保持。

单位ms，API值为各1177调用的inclusive总时长，不能与嵌套store相加：

| 配对 | cold wall | warm wall | cold getEvidence | warm getEvidence | cold readSource | warm readSource | 两轮full-load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1344.0204 | 1340.0910 | 113.1085 | 112.0535 | 1033.3434 | 1029.9078 | 2 |
| 2 | 1444.3088 | 1353.1850 | 120.0239 | 112.2601 | 1121.8538 | 1030.5407 | 2 |
| 3 | 1354.5231 | 1332.9891 | 115.9295 | 117.4250 | 1036.9674 | 1025.7888 | 2 |
| median | 1354.5231 | 1340.0910 | 115.9295 | 112.2601 | 1036.9674 | 1029.9078 | 2 |
| min | 1344.0204 | 1332.9891 | 113.1085 | 112.0535 | 1033.3434 | 1025.7888 | 2 |
| max | 1444.3088 | 1353.1850 | 120.0239 | 117.4250 | 1121.8538 | 1030.5407 | 2 |

原始heapUsed before→after字节cold依次98276104→83742144、96953240→83949160、97824864→83865056；warm149376256→133349456、153768176→110408912、149329936→133513824。这是阶段内进程heap快照，受GC及索引影响，不代表缓存净内存或已证明内存收益。固定synthetic medium三次值不能外推真实用户项目；当前未形成同计量协议的旧wall对照，不报告wall提升倍数。

### 实际取消与超时

新增ignored独立driver t2-cancel-independent.ts，hash21168FF966E4D3DA6B58E5E5B37D6D66C30DFD51D6EB63246AFBC991BA0093E1，实际命令`pnpm exec tsx .benchmarks/remote-desktop-review-20261002/t2-cancel-independent.ts` exit0。调用原runNavigationOptimized，使用真实child/medium且验证落盘报告与返回相等：

- before-start run7868518c-bed8-4f39-8d96-9ac30b85c76d：三pair均not_started/CANCELLED_BEFORE_START，零child。
- in-flight run5c3e859c-e2e1-44a0-bf7d-24941fa0688c：首pair实际reading/analyzing各128后cancelled/CANCELLED，childClosed=true、无强杀；余两pair不启动，无性能可比/通过计数。
- 原CLI `--pairs 3 --timeout-ms 5000` exit1（预期）：run0f53d97f-6430-426e-be22-fb4cd247b929，root timed_out，首child真实进度后timeout/TOTAL_TIMEOUT、closed=true、无强杀，1378.1582ms后完成关闭；余两pairnot_started/TOTAL_TIMEOUT，全部性能通过计数0。既有受控child不合作时升级终止回归通过，但本次真实medium协作退出，不声称本轮触发了强杀。

### 接受范围与规则判断

T2四新文件独立接受，可按原Git授权精确提交；本记录与队列记录接受依据，Git实际SHA/推送另补。首版失败历史保留，不以正常值覆盖反例。未验收的旧desktop/UI接线不纳入。工具结构/CLI/语义/固定样例性能门通过，不代表真实GUI导航、模型质量、安装升级卸载、签名或干净Windows完成。

本轮AGENTS新增0：核验真实完整返回及不得用重复错误一致性证明正确，已由仓库证据契约、完成门和专项T2计划覆盖；保留本轮具体失败→修正→真实复验记录，不为条目数量另加宽泛口号。后续第四批必须先依据当前源码形成具体计划，不能把旧设计最高schema9或无凭据模块的历史描述当现状。
