# 2D-S2 独立语义授权存储：独立复验与主集成

时间：2026-10-05 02:54–03:07；原第二批，Windows，本轮不电脑操作。main起点d31dcba582170825a54c2c186ca3c6f426e2a4d4。原Sol回合01a10827-be42-7ce3-aad4-b0ab8b7c4662明确冻结并completed/idle，实际游标:39；Luna已验冻结idle，游标:24。

## 实际差异与源码审查

核AGENTS、实际队列/恢复停止门、最新审查/交接及两目录Git。Sol旧broker/cache/loan/UI等WIP全部保留。交付仅五文件；两个旧文件原字节副本及2d-s2.patch位于自有临时材料，patch SHA256为1D567155DA6700F5AD82FD916CC9F1A43D892520B1DCA71602E760BA02920F39，root实际reverse --check通过。原index副本2A2519F20653A140324707A86B3A78C077C7C73EF89366DD948A6474970AF512、test副本3CA2248832CA336EA4C138C6FC7020744CF3EFE5B20050822C64D65FC75F3F61；不用Sol HEAD整份差异作为交付。

main先另存index/test原字节副本，精确复制两个新源码及自己的开发记录，原目标不存在。index仅两个导入、私有store实例/迁移/关闭及load/grant/revoke三方法；按main实际无parseCache的基线适配迁移调用，不引入Sol缓存源/迁移12。index.test只追加global13隔离十行，原main11/Sol12断言不改；该新测试不要求main存在cache12。remote store、contracts、application、desktop/UI、包/锁、AGENTS均无本次源码修改。

global13仅新复合键政策表及其迁移记录，project不创建表/13。默认denied零写；旧feature授权不推导。load严格核完整当前键、payload/列一致和限额，损坏固定拒绝不冒充初始denied。grant私有同步捕获输入，拒绝Proxy/访问器/未知字段；同步IMMEDIATE内取实际同连接own/provider revision、检查六类披露、递增安全整数并以可信本地时间写入、完整读回。revoke核独立revision、清类别；never-granted双null，曾grant保留其时间，时钟回退失败关闭。失败/触发器/BUSY完整回滚，关闭/角色拒绝，错误无任意SQL文本。仅内部持久化能力，不证明用户点击或当前题目/源码，不创造dispatch许可。

## 本轮独立命令与结果

1. Sol实际四graph文件（policy-store、remote-explanation-store、index、capsule-store）146/146，5.00秒；graph noEmit exit0。
2. main精确集成后同四文件加application/ownership-capsule.test.ts：5文件182/182，14.72秒。命令为`node node_modules/vitest/vitest.mjs run packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/application/src/ownership-capsule.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`。
3. main graph及application各`node_modules/.bin/tsc.CMD -p packages/<包>/tsconfig.json --noEmit`均exit0；实际git diff --check通过。
4. root新增自有忽略目录探针ownership-policy-review-91a6e3350b9a4e8694d0d075b915468f/probe.ts，运行`node node_modules/tsx/dist/cli.mjs <该探针>`最终exit0。两真实application布局各索引自有TS源码、生成entry题、按真实证据答题保存attempt/capsule，再打开实际global/project库；16门通过。旧feature grant仍语义denied、query_only读取零写、独立grant/revoke及两连接陈旧own/provider revision拒绝、真实第二连接BUSY后重试、重开政策保持；原schema/旧表行/材料/成绩/不可变源码保持。project无13、内部政策方法拒绝。材料依旧prepare-only/not-checked。仅自有测试DB，无生产授权/网络或导入源码执行。

探针初次失败是root脚本缺陷：legacy布局关闭policy并重开后仍用旧materialStore实例读取，正确RECEIPT_INVALID；改为当前projectStore或新policy读取后两布局全部通过。未改产品、断言或金标。开发首轮provider夹具多带revision的严格输入失败另见自己的记录；本轮没有确认产品缺陷。

主冻结SHA256：新store48EC3FFB3D747475A3FBBE7DCB0DC4E6CF096D15770F035B008498D26B0763A2；新testAB5D4CE0443369C76597B89862EB84CF0D8626F2BE88CB3A7A8ABBED3CA66F83；main适配index45D35B2A4F503E1E1D22FAD6F45A518FFC6CDF095EE7370294DB7874343747E3；index.test C636BB216C01063C0E4796A96B2864494154C0B17B533CBA5D9538E3D8DD41D8；开发记录2DA9075C1FD3487A794BACAE93F906C893B97F7F521773BD63101948A49F508F。新源码/记录与Sol冻结逐字节匹配；index的差异只来自main基线适配。

## 接受与边界

接受五文件内部SQL切片及准确协调记录，由root精确Git收尾。已实现/独立代码和回归已验证如上；真实GUI本轮0。用户授权交互、撤销对任务的反应、共享两purpose占用、provider变更跨用途失效、任务/当前性/原题核验、跨库结果发布、IPC/UI及真实远程质量未验，不称第二批完成。旧未验生产WIP和其他三批门不变，无重型窗口或二进制发布。

AGENTS新增/修订0：现有事务、严契约/捕获、证据授权分离及历史保留规则已覆盖；两次夹具/探针错误没有未覆盖的通用工程经验。四批仍有可推进本地链路，继续原流程，不第五批；本地收尾或剩余全依赖外部时暂停automation/派发并保留逐批未验清单。
