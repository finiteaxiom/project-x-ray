# S3-C/P 两用途内部生产者接线实施

仅原四批共享恢复剩余工作。root已对实际broker/policy/worker/runtime、feature gate/reserve/dispatch/异常清理和B2 prepare/reserve/start/ledger publish源码核对。接受一次具体方案shared-recovery-producer-integration：真实执行Worker提前登记、同实际authority同步写入、全部异步scope及await后事务门。不能把desktop RPC、结构WorkerPort、普通terminate Promise或空清单作为已有native证明。

## 已核冻结与实施范围

Sol方案before377→after379，旧0/新2/377保持，root379全hash、反向patch check通过。manifest 515D7E1730A26C2A51C8AA275DF418BC7A68B0728D7AEB30CDB21CCDAAFBBBBE，patch847FFE29F149BF11AA7267A11D3A9F37B1B6DBB9C04ACB38913BC221A1D8C2E1。方案源材料保持，不将设计当实现。

允许仅以下7个source及已有或新增同名test：application remote-recovery-source-locator、remote-recovery-capability、remote-task-lifecycle、remote-explanation、ownership-semantic-application；graph ownership-semantic-reservation-store、index。另仅新增自身development-runs/2026-10-08-shared-recovery-producer-implementation.md。最多15文件；必要hunk先在记录说明，不为填范围而修改。当前379前像及其他所有WIP保持。application/index、graph recovery算法、公开contracts/renderer/preload、desktop/broker/runtime/main、native/cache/migration、AGENTS、依赖与包配置全部冻结。只在5170，无Git/main写入。

## 端到端与权限要求

在held注册模块构造可信内部两用途流程，捕获真实application/authority/live maps/close状态；不导出public barrel。提前创建的Worker必须是实际处理本次执行正文的同一个执行者，start才发请求；禁止空闲替身监督实际父线程provider请求，也不能另生成未登记Worker。prepare不读凭据/发网络；保持实际完整正文与原私有prepared对象/响应校验。fixture只在测试中处理自己材料，不伪装生产调用。

同authority原同步reserve由root.admit观察真实提交identity/T1；所有prepare/start/cancel/read和迟到返回在同root计数/门下。不要把整个异步ledger方法交给admit。feature原gate之外finish/补偿/finally release及semantic ledger实际await后的同步提交入口也必须受可信producer门约束，保留原完整身份/材料/配置/SQL前像与单任务真实native release检查。graph仅接向内契约：同步拒绝门返回undefined，Boolean/Promise拒绝；同步admission工作可以返回原receipt/task，不能混淆两者返回契约。任意回调不能授予停止或发布权限。

正常单资源停止仅复用native层捕获的真实getter/terminate和既有private stop，保留participant/退休generation，不签全域proof，不宣布其他scope结算。冻结后生产者零finish/补偿/release；旧scope实际结算后才由已有root.recover做全域处理。禁止scope内部等待全域恢复形成自等死锁。close不释放lease；未知旧owner、缺/歧义held source和不明执行域仍blocked。不新增task adoption或借RPC自报身份。

保留旧非统一构造的实际语义与回归，不称它们已加入生产统一；新可信factory禁止回退旧未登记执行路径。此切片不修改desktop、不启用HTTP/凭据默认适配器，不替代父子资源/Windows物理重开或GUI门。

## 必需验证与交付

使用真正两用途流程、当前实际索引/原题/提交/capsule/完整body、非空历史、真实Node Worker和SQLite，覆盖legacy/split/hybrid。失败矩阵按已核方案：提前创建异常/Proxy/Promise/unknown；prepare冻结；reserved未start恢复；promotion调用后COMMIT失败；每个真实await后的迟到写/返回；source提交/global失败与BUSY；退休generation和pending scope；source/settings/关闭异步变化；共享两用途预算/占用、未知旧owner；普通取消和人工安全重试零重发。原T1、源码/attempt/mastery/成功结果必须保持，阶段progress据真实COMMIT。

定向后原20完整组合及四包原noEmit串行；单worker/no-file-parallelism/no-cache，原正确断言及5000ms/60000ms不改。原20不是新接线覆盖替代。无heavy build/native/dist/Electron窗口、GUI/HTTP/钥匙/隐私操作，不执行被索引项目。若准确权限范围确不够，给具体源码/失败证据与最小必要扩展，不能自己改范围或另造设计轮。

交付before379准确字节、after/changed/new/unchanged全hash、窄patch、实际失败分类与修正复验；测试副本.review后缀。规则冻结，AGENTS0允许。root冻结后独立审查/真实Worker与SQL探针及适用回归，再精确main集成。仅四批，不第五批；不以内部端到端通过称生产统一/GUI/真实远程质量或四批全部完成。
