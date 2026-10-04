# 3G-S1 Python解析缓存独立复验

2026-10-04；root；原四批第三批，Sol5170冻结实现。实现与普通索引端到端后台验证通过，不代替真实Electron连续索引、取消、导航或安装资源验收；不提交或整体复制Sol既有未验改动。

## 冻结与源码范围

原Sol回合01a106b0-4609-7271-a217-be5aaaf99601完成冻结，旧实际cursor16。root核实际application/graph/Python主源码、parse-cache/SQL新模块、Python脚本、三新测试与两个必要测试一致性改动，对main作逐文件no-index忽略换行差异，application/graph只有本批接入与activation receipt。ownership旧测试仅精确迁移length11→12，Python脚本只增加工具指纹/协议；没有用Sol旧HEAD至工作区总差异替代本批范围。

关键hash前后保持：application `0C7A92181810ABAACA3A6CBB0E7C63D8FD28F0B334DC5DFEA48F8D305C8118C0`；graph `0786ACAB39A2028E7189692768065510442FF531378A979A445475E1E92A06AF`；Python analyzer `B73CE9C697BDDD8C3D91A93318670B767180D9AF0462962E5DECC2C2D982FEAC`；parse-session `78F48D344CCC91268A1DB2EFBA169B9876672B277EE37293DDEC80988E2FEFC0`；cache-store `C03A0A1177A0D5136941FF883BE9E1FFAAD5CA54A5BB9A1C7D787BA45642FD56`。完整交付清单/hash见Sol自己2026-10-04-python-parse-cache.md；23:17中断恢复后三主源码复核不变。

审查核每轮当前真实worker探测、runtime/script指纹、snapshot-free raw DTO重新normalize/完整跨文件语义重建、坏材料冷回退、项目角色migration12及global不迁移、有限SQL/2048行/32MiB/1MiB预算、精确同事务activation收据与配置/源hash门。缓存checksum是普通损坏检测，不是权威签名或同用户恶意改库防御；没有锁定外部解释器的承诺。TypeScript和Git两侧继续冷分析。

## 实际独立检查

- `pnpm exec vitest run packages/analyzer-python/src packages/application/src packages/graph/src packages/analyzer-typescript/src/index.test.ts --exclude '**/upgrade-preservation.test.ts' --exclude '**/windows-upgrade-*.test.ts' --reporter=dot --maxWorkers=1`：17文件330项全部通过，91.22秒、exit0。排除当前冻结的升级/native/loan，不删除失败断言。
- application、graph、analyzer-python三包 `pnpm exec tsc --noEmit -p packages/<包>/tsconfig.json` 各exit0。
- 对本批具体差异及真实SQLite/安全读回归读查，覆盖新应用重开、同ID双连接再晋升拒绝迟到bank、配置修订、事务BUSY、历史源码、partial恢复、暖缓存junction零外部读取、取消提交前零写/提交后成功一致、跨项目及Git两侧冷分析。已复现旧persisting同步abort缺陷对应回归通过；缓存/observer失败不能逆转已提交图终态。
- `pnpm exec tsx benchmarks/python-parse-cache.ts`：root独立最终命令exit0，20/80各三对新Node/新application冷/热及三对TS对照，所有计数/事实/最终ID门通过。自有材料保留，无导入项目代码执行、网络或GUI。

root测量报告自有目录名xray-python-cache-measure-qopK4b，report SHA256 `D34B3AA19E603612A23A54EC0D0BC4DF906E4408552431BA6DFAE8A9D99782D5`；不把开发方报告当root本轮测量。

| 自有样例 | cold请求/hits | warm请求/hits | wall中位数cold/warm ms |
| --- | --- | --- | --- |
| 20 Python | 每轮20/0 | 每轮1/19 | 626.0815 / 235.375 |
| 80 Python | 每轮80/0 | 每轮1/79 | 2237.1222 / 633.4568 |
| TS-only | 每轮0/0 | 每轮0/0 | 318.6289 / 307.1310 |

20文件冷/热同snapshot `772fffd8b5dc35ce3f140765`、canonical content摘要 `571e7164f4acf693bebf2b32f69492ef35383de3f9d2ca5861eeb2a2f944cf78`；80文件同snapshot `40edbeeb5f5da4d1accc65ba`、content `a6126afc2dce1d5d406a160eaf014e6c106ca2131088216fca6582dd611e3830`。与开发方ID不同源于自有绝对根不同，不要求跨根相同。每轮完整安全捕获和验证分别20/20或80/80；不把减少Python子进程称为省略安全读取或局部语义解析。

wall差包含预热已有图行等其他成本，不能全部归因缓存；未测旧版本基线。CPU及10ms采样RSS仅Node，不含Python/Electron，不据此声称整体CPU或内存改善，不外推真实项目加速。规模超过缓存预算仍冷分析全部事实，可能不能达N→1。

## 状态与规则判断

已实现/独立源码回归验证：仅上述Sol后台切片；真实GUI已验证0。真实Electron普通连续索引、取消、导航、打包worker身份及实际集成回归未验。需要GUI的实现不因暂缓而完整接受/提交；本批生产源码和AGENTS候选保持Sol冻结，未复制main。旧source-loan/S1a和远程接线未重新验收。

Sol提出精确activation的规则有同ID再晋升回归支持，root认可候选证据及适用动作，但公共AGENTS暂不集成，待相应切片完整集成门；本轮公共规则新增0。只推进原四批剩余，下一Sol回到已复现第一批stop-failure窄修，不开启第五批。
