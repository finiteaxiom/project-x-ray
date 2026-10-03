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
