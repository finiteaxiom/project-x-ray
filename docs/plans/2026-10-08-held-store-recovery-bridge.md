# S3-C/H：应用已持有数据库的内部恢复桥接

仅原四批共享恢复后续切片。前置为已独立接受的内部core，main提交 `8b256d60807fca1992f37e8f14235488251fc754`；两目录原19组合各834/834、四包类型及实际source41事务门/15人工重试通过。生产broker/B2未统一，GUI/HTTP仍未验。

## 实际源码依据与目标

XRayApplication持有私有legacyStore、stores、snapshotStores；已有requireSnapshot、storeForRepository和remote.currentReference会按路径打开/创建或枚举数据库，不能直接用于恢复。当前RemoteTaskLifecycle只接受调用者提供的GraphStore实例，无法通过正常应用持有关系获得精确source/settings。因此增加真实应用内部桥接，运行“真实索引/答题材料 → 应用持有store解析 → 实际native资源登记/持久占位 → 停止/结算 → 精确补偿”的本地端到端回归，避免只交一个空locator接口。

本切片仅使用应用已经持有的实际实例。不实现2026-10-06方案的受限路径重开：当前没有SQLite路径与原生HANDLE绑定证明，未知源必须blocked。不得按文件名、rootPath或任意调用者路径打开/创建库；不改变原constructor加载策略，更不能将其旧枚举行为当成本locator保证。

## 文件与接口边界

原开发-Sol仅在5170修改：新 `packages/application/src/remote-recovery-source-locator.ts` / `.test.ts`，现有 `packages/application/src/index.ts` / `.test.ts` 的最小内部委派与关闭接缝，自有 `docs/development-runs/2026-10-08-held-store-recovery-bridge.md`。不得改其他source/test、公共index导出或AGENTS；若确需额外文件先报告源码依据，不能先扩范围。root维护主目录计划/队列/审查/交接。

每个实际application/authority只持一个生命周期；内部可信工厂或窄协调器不得接入preload/UI/IPC，不提供任意store、Boolean stop或普通Promise停止权限。优先复用既有RemoteTaskLifecycle，不重复实现native、SQL或身份规则。桥接显式严格SnapshotRef到其持有的source/settings，调用既有真实binding核验；不对缺配置元数据返回默认授权，不因错误而退回别的store猜测。source候选逐实例去重，两个不同实例同时声称同ref必须拒绝；显式映射错repo、损坏/已关闭source或settings均拒绝。不能泄漏GraphStore或SQL端口给渲染进程。

close撤销所有已发协调能力并关闭原生命周期；已排队/迟到operation或recover不得借close释放lease或发布。不能把同步close返回或发出terminate当成已停止证明。闭合后不为同authority重新创建根，失败重试仍遵循core的冻结域与新permit门。

## 必要验收

- 实际XRayApplication索引、原题、真实提交/评分/准备材料；legacy、split、legacy source配已持有project settings；两purpose正常占位及非成功恢复，真实自编Node Worker、准确T1/lease/source/result及非空答题/mastery前像。不得执行fixture代码或联网。
- 多次获取同一内部根、A→B→A、同snapshot别实例歧义、闭合后获取/旧协调器/迟到操作拒绝；同步登记必须通过native admission，未知历史owner/task不得清理。
- 严格ref错repo/错snapshot/访问器或后改、缺source/settings元数据、损坏配置、关闭store、配置/source变动后的旧binding拒绝及显式再绑定。全部核真实零写和旧材料保持。
- 在application构造之后设置目录枚举/打开观察门，调用locator时不触发requireSnapshot/storeForRepository/currentReference；未知ID不新增文件/连接，存在未持有SQLite也不加载。如应用旧构造行为独立触发枚举，明确分开记录，不伪称整个应用无枚举。
- 两连接占用/失败门，精确source已提交/global非成功窗口只补偿目标候选，completed历史保持；native实际退出且operation结算才恢复。既有core正式回归不放宽、不假SQL/exit、不以局部过代全组合。

冻结后先新locator/index/lifecycle三文件定向组合，再原19（新locator加入成为20文件），单worker/no-file-parallelism/no-cache；contracts/graph/application/llm原noEmit，类型与完整组合串行。19具体列表见core交付和独立审查，不引入不存在路径。保留本轮有意义失败/复现/根因/修正/实际命令/未验边界；生成before/after准确逐文件hash和可审查增量patch，测试备份不放可发现的.test.ts文件。开发不得Git。

## 不接受边界

本切片不启动生产HTTP，不改变broker/B2生产接线、跨线程私有control协议、Windows重开/进程退出证明、未知数据库物理安全打开、凭据/隐私授权或GUI。上述仍是原四批剩余门，不因内部桥接通过就称全部完成。重型build/native/dist/Electron由root另开单一协调窗口，本切片没有该窗口。无依据的准备任务或第五批禁止。
