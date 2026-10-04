# S1b-L：私有源借用与双遍预算

2026-10-04 08:03，协调方，P1，原开发-Sol/5170。仅Windows现有升级保护准备，依据writer设计、权限实验独立复验和当前源码，不新增产品能力。S1a file symlink EPERM整体未接受，不能以本切片绕过或提交它；main只接受隔离诊断工具，产品原生源能力仍在Sol目录。

## 依据与可运行目标

真实native/windows_upgrade.cc的Lease只有ready/pending/closed、累计bytesRead/maxBytes及原单调until；Queue read累计扣额，Complete失败会直接release源。windows-upgrade-files.ts只有public acquire/read/verify/cancel/close与私有WeakMap，没有writer loan/剩余额度端口。B0要求同源HANDLE两遍hash，但总20GiB不能默加至40GiB；原source关闭为void/未核CloseHandle仍是未来材料交付门。只读掩码不能视为OS创建拒绝，窄端口而非metadata须传递能力。

本切片只实现graph内部不可序列化、操作身份绑定的源loan：真实获取lease→私有借用预检→按原HANDLE/固定成员顺序两遍有限读取核一致→verify→释放loan→源正常释放/重占用。零目标文件创建、零SQLite、零manifest/marker/恢复。测试consumer使用自有固定字节，不执行导入项目；不是完整writer或产品成功receipt。

## 文件与依赖边界

只允许原Sol修改packages/graph/native/windows_upgrade.cc、src/windows-upgrade-files.ts及其test、必要的原scripts/windows-upgrade-capability-smoke.cjs；新增src/windows-upgrade-source-loan.ts、对应test及docs/development-runs/2026-10-04-upgrade-source-loan.md。私有WeakMap跨模块困难时允许内部实现放原adapter，新模块有限入口；不导出原生external/HANDLE、root字符串操作或任意路径打开接口。

原native fixture/windows_upgrade_fixture.cc只在无法观察本批真实生命周期时可加固定测试端口并记录必要性，不扩大生产端口。binding/build/package/lock/index/core/UI/desktop、已接受probe五文件/ignore/两writer设计/AGENTS冻结；不合并旧HEAD、不覆盖partial、不Git。新内部模块不接公共index、IPC或UI；root计划只读，各自只维护自己记录。

相关S1a文件本批因loan明确解冻，不重做已独立修正的Proxy/signal/GC逻辑。基线native8A0809C2584DC2C2607F16E8AC9052B1948B62256BA807A9D53C45D2D171A91C、adapter03B7A8F4C8BACF39F34E4A81F20EB9D8DB7713F5B1BFC6457035AD8FFF2FB1F9、test513E038777ACCA8C6B8E9974385ED5A880A54F2FD2948699F2F3049F9536CF21、smoke29271B1ED57C8D7529AE3BC5C7E1D005295FC3A34A8CD10D757B028E19B9437B。目录/Git/hash未对齐先报告，不重置。root收尾完再交Sol独占native/Electron技术窗口，无GUI。

## 必须保持的契约

- loan来自真实lease/typed external/私有状态，绑定operation和root/member完整ID；plain DTO、metadata、伪对象、其他lease、序列化标识不能借用。输入校验保持，Proxy/accessor零trap/固定错误。
- native从实际成员尺寸求B、校验未public读取/无pending/无借用/未取消/未过期，核2B可用预算。算术安全，空文件/全空集合语义明确；不能信caller的B或余额，失败零新增文件/SQLite。通常10GiB是20GiB默认下推导，用小budget测边界，不造10GiB材料；不足用有限SOURCE_READ_BUDGET等固定码。
- 借用期间public read/verify/close/二次借用拒绝，cancel继续作用同源；metadata不能作authority。内部read<=128KiB/原maxFiles/maxBytes/同一until，按真实已读数消费，不重置deadline、不透传fd另一addon。release不恢复额度或取消源。
- loan及每个排队work对源external/自身保留强napi_ref至完成；pending不能提前解borrow/关源。GC/失败/排队失败/cancel先drain再解，不能沿用Complete直接release清掉consumer在用的源。当前无target，释放loan后owner正常关闭；未来target关闭门不伪造。
- finally释放借用/保留原固定失败，进度/listener失败不能掩盖。关闭不明不能称材料完成，本批不升级source void close为checked或伪造生产成功。若checked close有真实必要，先交root具体差异/计划。

## 最小充分验收

真实自有源普通/空文件，两遍逐块hash/ID一致和原字节不变；预读过/预算略不足/恰好2B/借用冲突/错操作/伪authority/取消/原deadline/失败重试。borrow期间owner禁止方法与允许取消、pending释放拒绝或drain、GC期间外部写仍busy、终态后真实立即重占用。原生异步失败/引用回收分别验证，不用模型替代OS句柄。

原相关adapter回归/graph noEmit及真实Node/Electron原技术入口，加新增loan consumer实际入口；正确file symlink EPERM保留失败/未验、0 skip，不改安全设置、不用junction替代。不重复全库/整应用/旧probe重型构建；无API/数据外发或生产库。

冻结精确hash、命令/结果、原失败→根因→修正→再验证及未验。AGENTS候选允许0，但不改公共规则。交付只是source loan准备，不是S1a整体、安全权限全绿、writer/raw包/恢复/生产/GUI通过。root独立验收后再定writer切片，源实现未达旧安全门不得进入main。
