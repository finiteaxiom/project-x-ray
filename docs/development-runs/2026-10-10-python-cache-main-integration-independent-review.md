# 3G-S1 Python解析缓存主目录精确集成独立验收

2026-10-10；root；仅原四批第三批。Sol已冻结后台实现的历史330项/20–80测量不是本轮main成绩。原批准设计和主目录的两条测试一致性授权补充保持原字节；未覆盖Sol整份index/AGENTS或复制旧native/loan/升级差异。

## 实际范围与反馈

root核实际main-vs-Sol普通索引、GraphStore、Python协议及版本差异，仅缓存/精确activation收据/取消提交边界与必要版本、project迁移列表变化。保存469文件原字节前像后精确patch六旧文件，复制七新文件；463原文件逐字节保持，1D七路径、全部desktop接线、旧B2六行WIP/AGENTS均保持。三个公共index仅接本批实际差异，共同核心其余逻辑一致；未把旧HEAD到Sol的总diff作为本批范围。代码从主目录正常入口实际运行，不是只复制benchmark。没有新依赖、公共IPC或用户控件。

最初集成工具误把已存在的main实施计划当新增/与Sol完全相同，两个断言在任何备份或产品写入前拒绝；独立diff确认main仅多两条root明确授权的测试补充，保留它不复制。patch文件Windows换行产生警告，随后仅本批插入/替换行恢复原主要换行，所有未改变行仍取前像原字节，归一化源码与冻结Sol相等；非产品语义变化。

首次原历史目录selector命令为33真实文件1268项断言通过，但还选中六个ignored旧验收副本；它们缺remote-task-recovery-store等模块，零测试加载失败，命令exit1/409.95秒。这是测试选择工具问题，未记整命令通过，保留原日志。追加明确 `--exclude '**/.benchmarks/**'` 后同生产范围串行/no-cache重跑，33文件1268/1268、405.97秒exit0。没有删除产品断言或扩大超时；旧upgrade/native/loan排除边界保持。

## 当前独立验证

- `pnpm.CMD exec vitest run packages/analyzer-python/src packages/application/src packages/graph/src packages/analyzer-typescript/src/index.test.ts --exclude '**/upgrade-preservation.test.ts' --exclude '**/windows-upgrade-*.test.ts' --exclude '**/.benchmarks/**' --reporter=default --maxWorkers=1 --no-file-parallelism --no-cache`：33文件1268/1268，exit0。覆盖缓存坏材料/工具/预算/BUSY/同ID晋升、取消提交前后、warm junction安全、TS/Git冷路，及当前共享SQL/语义原题、当前性、发布/停止/历史/恢复全部原适用门。
- analyzer-python、graph、application与desktop/ui五包tsc noEmit分别exit0；无新TypeScript/public契约豁免。
- 正常 `pnpm.CMD --filter @project-xray/desktop build` exit0；五原入口和原copy命令。构建期间main源稳定，Sol仅设计文档且388旧文件hash保持；单一root技术窗口，无native重编译/GUI/生产凭据操作。
- 实际新编译analysis-worker的自有两Python文件probe exit0：中性cwd使用实际打包python-analyze.py，两个独立Worker/同自有库索引与源码读取current，project-only迁移12/两行bank真实存在；每条identity/payload workerDigest与实际打包脚本一致、analyzerVersion2.2.0，脚本源/打包文件完整hash一致。重开同snapshot、SQL快照材料/源码材料hash相同。原始自有材料保留，零递归删除。worker协议未暴露hit计数，不能由它声称N→1命中；这是Node产物技术验证，不是Electron/GUI。
- 原有限测量 `pnpm.CMD exec tsx benchmarks/python-parse-cache.ts` exit0：20/80与TS-only各三对新Node/新application。全部源安全捕获/再验证次数与冷/热事实、source/analysis/final snapshot/content相等门通过；实际计数及中位数如下。

| 自有样例 | cold worker请求 | warm请求/hits | wall cold/warm中位数ms |
| --- | --- | --- | --- |
| 20 | 20 | 1/19 | 671.429 / 278.766 |
| 80 | 80 | 1/79 | 2495.744 / 657.282 |
| TS-only | 0 | 0/0 | 320.227 / 307.232 |

wall为当前版本成对样例，包含已有图行等其他成本，未测旧版本，不全归因缓存，不外推真实项目加速。CPU/RSS仅Node、10ms采样，不含Python/Electron；两遍安全读取与全量跨文件语义重建没有被缓存省略。报告hash 685F9A572FFD3FE006ED4D73A80EF259D444C1A3B4350FF1B163D09AA7FB910B；完整logs/真实exit receipts、主目录13路径/产物hash与原失败材料在ignored `desktop-main-integration`，最终receipt SHA256 1B8089632090DB9344801AEF9F10E00545AE79C4C7C82C1D125F28856DEC28E6。

## 状态、Git与下一步

已实现并精确main集成；当前独立源码/回归/类型/有限测量/正常构建与实际Node产物门通过。真实GUI已验证0，Electron连续索引/取消/导航、安装资源环境与整批用户路径仍未验。main HEAD 79417e0974af9ad5da637aa19361a91cb152b486，本轮生产和协调记录均无提交/合并/推送，不因GUI暂缓豁免验收。AGENTS新增/修订0，Sol的activation候选规则仍待完整对应集成门，不整份覆盖公共规则。

第二批实际公开semantic入口/非消费preview/固定executor仍缺，已派原Sol 2E-S两文档设计；当前交付两新增/388旧文件不变，root尚未完成独立设计复审，未接受/实施/复制main。Luna1D本地门通过且冻结。project-x-ray实际仍ACTIVE/15分钟，有四批内可推进工作；未启动第五批，收尾或仅剩外部条件后暂停。
