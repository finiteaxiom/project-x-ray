# S3-C/D 实际 desktop 后台编排统一接线

仅原四批1/2/3共享恢复剩余工作。以已审查shared-recovery-producer-integration的“broker跨worker许可”段为依据，不重新设计核心，不第五批。S3-C/P原始pending缺陷已在原反例和Sol原20/四包独立复验闭环，主目录精确集成复验正在进行；本计划须协调方实际派发才开始，不称已执行。

## 源码依据及目标

5170实际 explanation-worker.ts:13/14各自new ExplanationPolicy和XRayApplication；policy:10创建另一个global GraphStore，runtime:24–52以policy实例直接构造RemoteExplanationApplication，并在父线程provider dispatch。broker:53–78用结构port/terminate/exited终止及旧feature recoverInterrupted；main:156–159创建独立policy和宿主Worker。当前内部新factory没有desktop使用者。不能把这些对象按同路径视为同一authority，不能让main凭宿主RPC/退出清理执行子Worker的共享lease。

交付完整实际安全后台路径：一个协调宿主持有一个实际XRayApplication和唯一held恢复根；feature生产者采用S3-C/P提前登记的同一真实执行子Worker，子Worker只处理最终正文，不打开数据库。semantic复用同一宿主/authority/根形成严格私有两用途流程；公开renderer semantic入口和默认HTTP继续关闭。main broker只路由、真实持久完整identity核验和监督，不再执行任务恢复/跨连接收养。不能以只新建未被实际入口使用的runtime或接口称完成。

## 精确许可及冻结

仅原Sol/5170实施，不Git、不改main。以本次实际380全文件字节前像为准，保留全部历史WIP。允许以下必要source及同名test；不用的文件不填数：

- apps/desktop/src/explanation-worker.ts、explanation-worker-runtime.ts、explanation-policy.ts、explanation-broker.ts、main.ts、remote-credential-policy.ts。
- 新私有 apps/desktop/src/remote-coordinator-control.ts、remote-execution-worker.ts（同名test）。前者仅严格有限控制/执行schema与预算；后者固定可信执行入口，不设环境key/endpoint/test-mode/injectable production branch。
- packages/application/src/remote-recovery-source-locator.ts、index.ts仅有限可信composition/策略视图接缝；必要时新增packages/application/src/desktop-remote-coordinator.ts及同名test。禁止返回GraphStore、SQL、native proof、permit、可调用的任意admission/stop签发端口给desktop/main/renderer。index不得公开转出native或held注册能力。
- packages/application/package.json仅为上述可信composition私有subpath导出（如确需，保持主入口语义与依赖完全不变）；apps/desktop/tsup.config.ts仅追加固定执行Worker入口，不改构建策略/原入口。
- 自己新增docs/development-runs/2026-10-09-shared-recovery-desktop-integration.md。

至多11 source与11同名test、两配置和一记录（25）。原public contracts/IPC/preload/UI、graph全部、native capability/lifecycle/recovery算法、LLM/HTTP实现、cache/analyzer/migrations、AGENTS、依赖/lock/build scripts/Windows adapter均冻结。具体纯有限视图先在记录说明；如果真实必要范围不够，给源码/失败证据及最小扩展，不能自行越界或另造准备轮。

## 不能降低的门

1. 子Worker由宿主真正factory创建并在prepare前登记；start仅向同一实际子Worker发送最终canonical正文/精确digest/预算及deadline。零第二执行者、零父线程fetch、零子线程数据库。prepare不读key/外发。现feature完整私有prepared校验仍在宿主；opaque token/R1/slot不能structuredClone到main重造。semantic本切片可在严格私有宿主通道做无key本地fixture验收，不添加生产默认semantic transport/renderer入口。
2. worker内policy与credential有限视图绑定该唯一实际authority，禁止另new global/project连接；正常准备通过原应用安全加载，恢复仅已held实例，禁止recover枚举路径/懒开未知DB。main独立policy连接仅原策略授权/context提交及只读核验，不能清任务/候选/lease。凭据仅OS适配器、短时执行内存，不日志/持久化/renderer；无人值守测试不调用实际凭据。
3. 私有通道必须严格运行时校验：实际channel、owner/window/context/generation/request序列、用途、固定码、完整budget；控制消息不是停止证明。普通结构WorkerPort/terminate Promise、Boolean、假ready/exit不得获取恢复许可。RPC超时/断线/宿主崩溃只关闭入口和保留不确定占用，不重发、不收养，不因单实例锁或宿主exit假设子Worker已停。Windows父子退出绑定/未知物理重开仍未验，不能制造成功兜底。
4. retire保留全部真实generation和底层pending；新context前停止旧两用途操作/事件入口，使用宿主原root.recover等真实子资源退出和全部实际工作结算，旧异步工作没结束时不释放。恢复返回的DTO只能进度/固定失败，main不得随后自行补偿/release。deadline5000/60000和原raw pending20/prepare门保持。close同步返回不等于资源退出；不能scope内部await自身全域恢复。
5. main事件保留严格持久T1/identity/createdAt/当前context/发布结果门，晚到阶段按合法收到顺序、终态按实际DB；任意事件不得制造completed或换context返回旧结果。原privacyauthorization/provider/credential失效与原分数/来源/置信度/快照不降级。异常主错误/COMMIT切点保留候选与占用，未知旧owner保持blocked。
6. 真正入口需连接上述可信宿主与固定executor，不以技术fixture冒充真实HTTP/GUI。实现配置与源码可修改，本轮不开build/native/dist/Electron重型窗口；开发方只源码/类型/Node离线技术回归。GUI成果仍不能据自测提交或完成。

## 验证及稳定交付

真实Node宿主/子Worker、自有最小索引与SQLite非空历史，legacy/split/hybrid，覆盖feature实际prepare→reserve→发送→严格响应→发布→原生停止→release，semantic私有同authority跨用途BUSY/取消/恢复；实际request发送计数、T1、源码/attempt/mastery/成功历史保持。覆盖旧scope raw pending/超时/取消、换context及退休generation、source提交/global失败、publish/release BUSY、错私有identity/budget/channel/generation、创建/发消息失败、宿主断线/退出保守拒绝、未登记旧owner。网络与OS凭据只测试明确自有端口，不加载生产entry发实际HTTP/读实际key，测试替身结果明确仅fixture。

保留原broker/runtime/policy/credential/startup回归，实际Worker回归及四包原20/四包noEmit/desktop noEmit串行。原正确断言/协议/门槛不删除，不盲更快照。测试副本.review后缀，不放匹配.test.ts的staging目录；具体失败区分产品/测试/环境。无重型验证直到稳定交付由root开单窗口。

交付准确before字节/after全hash、changed/new/unchanged、窄patch、实际命令/结果、反馈闭环和未验边界；完成即冻结，由root独立复验及决定精确集成。AGENTS仅有合格新证据时再提，允许0，本次冻结。生产desktop/GUI/API/Windows退出/发布未验清单保持，四批收尾按用户停止门。
