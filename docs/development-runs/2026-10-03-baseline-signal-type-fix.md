# 基线帮助函数严格可选属性修正

2026-10-03 19:04（北京时间）；协调方独立修正/验收。目标仅解除T2只读复用旧帮助函数带入的严格类型错误，不变更任何测量门。实施前已在T2计划写入精确边界例外并通知原Luna；Luna四新文件仍未冻结，未运行其活动源码。

## 原始失败、根因与修正

协调方单独检查 `benchmarks/local-index-baseline.ts`：`runBaseline(options, signal?)` 显式向 `runControlledChild` 的 `signal?: AbortSignal` 传入 `AbortSignal | undefined`，第759行TS2379，exit1。`exactOptionalPropertyTypes` 不允许把缺省可选属性替换成显式undefined。Luna曾关闭该选项作诊断；本次保持严格门。

仅一行改为 `...(signal === undefined ? {} : { signal })`，无signal时省略，存在时原样传递。公开类型、子进程生命周期/取消、协议、fixture、原11门、容量和性能分母均不改；没有新增依赖。根因确认，属于既有工具类型缺陷，不是产品导航失败或环境故障。

## 实际独立验证

修正前下列类型命令exit1仅TS2379；修正后同一命令exit0：

```powershell
pnpm exec tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --forceConsistentCasingInFileNames --skipLibCheck --resolveJsonModule --allowImportingTsExtensions --types node benchmarks/local-index-baseline.ts
pnpm exec vitest run benchmarks/local-index-baseline.test.ts benchmarks/local-index-baseline-samples.test.ts benchmarks/local-index-navigation-diagnostic.test.ts
```

回归3文件24项全部通过，4.04s，exit0，覆盖既有受控进程/取消/超时/协议和固定样例、旧导航工具门；没有改变任何测试或断言。`git diff --check` exit0，源码差异仅上述一行。baseline新SHA256 `5F437278E5148EFFA662BC736B1704C8EB1BC1652D703F060C60F04B69BB9FE7`，已通知Luna严格复验时使用。

冻结材料重新读取保持：v1 parent `BBBF0DF0A13BE491F14415857CA8EFAFF60BDC33A735D3BDB1DC5363652BB62C`；child `E2DA20D6CF5637D09F72881F685CCAB8DD2DA0CF56D635710B329F51CAC09EFC`；test `EDBEB473016EDF5C55BD274F69640418349EAD3029A6AE21EAF0BFEE8046429D`；samples `51FB7E794D4C80AFF50A7307629C05ADA2FD8EBF8FC3524FA531F0CE70ADEEB0`。旧报告未修改。

## 接受与限制

此精准类型修正独立接受；不能由这24项推断T2工具或正式三配对通过。T2活动文件、真实medium/CLI/challenge、正式性能均尚未本轮验收；GUI继续按用户要求暂缓。没有运行导入项目代码、网络、native/build/dist/Electron或电脑操作。

本轮无新增AGENTS规则：严格TypeScript与不降低检查门已覆盖此问题，一次可选属性写法不需要新增专条。公共状态及Git由协调方精确维护，未提交开发中的T2四文件。
