# 4B-M10 已持有源码文件 HANDLE 的有界私有副本

原第四批 reader 本地剩余能力。依据原 reader 计划 ASAR 副本段及当前 M4 Get-XRayArtifactObservation：M4仅顺序hash且readStarted单次读取；M8只创建目录；M9接受byte[]≤32MiB，不能拿整文件Buffer复制上限2GiB的app.asar。当前没有 source HANDLE→私有文件→同副本HANDLE独立读回的实现。先实现这个可运行能力，不用纯列表或设计代替，也不把它称为ASAR解析或完整reader。

## 责任与冻结

work tree 2原ID/5170/gpt-6-luna/max；先核437完整raw/hash及主目录M4/M8/M9依赖相同。只五新：scripts/windows-artifact-private-copy.ps1、scripts/test-fixtures/windows-artifact-private-copy-probe.ps1、src/windows-artifact-private-copy.test.ts、src/windows-artifact-private-copy-handle.test.ts（均apps/desktop下），docs/development-runs/2026-10-12-artifact-private-copy.md。原437全冻结，尤其M4只读桥接/M5捕获、M8/M9已验生产与测试、reader/协议/native/UI/DB/core/AGENTS/公共记录/package/lock。缺少固定端口时失败并反馈实际缺口，不擅改原文件或新增API。

## 实际行为

仅内部接受本次已持有、未释放、未readStarted的M4普通文件session及ready且登记的M8输出目录session。入口先捕获有限内部字段及完整metadata/chain，严格核actual source HANDLE、ledger位置、前后volume/128bitID/类型/no-reparse/length/attributes/相关时间与所有父HANDLE身份；禁止任意path/stream/callback/handle输入、重开source或seek source，不由caller摘要自洽推断来源。M4尚无公开不可伪造owner registry，不能声称OS metadata相符证明授权来源；此端口只供可信reader内部编排，缺少最终reader权威来源绑定仍未验。

source上限2GiB（含0），明确整数边界/累计计数检查；在首次读取前标记readStarted，不因失败恢复为可再次消费。同source HANDLE最多1MiB固定块顺序ReadFile、增量SHA-256及本次私有copy计数，不创建整文件buffer。source保留readonly/shared-read/no-follow路径语义，不新增write/delete端口或扩大M4权限。

复用M9已验内部能力创建空普通文件，文件basename仍为内部opaque token单组件，其.sidecar后缀不证明内容是JSON；本copy原始字节只作future ASAR parser私有输入。仅在新模块私有owner账本里保留该M9会话，立即撤销空文件ready后写入，不能对外暴露半完成的M9会话/handle。通过M9已固定WriteFile/ReadFile/SetFilePointerEx/helper/ACL端口及私有登记state验证使用本次实际创建的目标HANDLE，不能关闭或改写任意caller文件。不得为流式写入把source变成32MiB数组或将其声称完整sidecar。

每次目标WriteFile成功且实际count精确，短写/0/超界失败；source EOF与开读前后metadata/length必须一致，父链和借用M8继续保持。写毕目标同HANDLE回到0，固定块独立读回hash/length/EOF，source hash与copy读回hash独立相等，目标完整身份/类型/length/links/creation/相关属性保持（M9已记录写HANDLE时间限制）。不能用写缓冲hash代替目标读回。再次核source及目录身份后才发布ready。

公开结果仅固定状态、opaque token、有限计数/identity proof/source hash/copy hash，不含path/SID/源码/raw exception。输出仍incomplete/not-evaluated，不证明ASAR结构、真实build/source provenance、签名、持久化或完整manifest。状态必须私有，不让caller字段修改跳过failed/closed/owner checks。失败撤销ready，保留已创建文件及精确登记HANDLE，close仅释放本次M9 owned session，不关闭source或M8；失败释放保持unconfirmed可安全重试，未知对象零删除。无候选代码执行/require/extract、无新dependency/compiler/binary/网络/child/CLI。

## 验收和交付

开发只串行纯测试、desktop noEmit、PS5.1 AST/纯转换；不得运行fixture/HANDLE suite/reader/native/build/dist/Electron。纯回归真实调用有界转换/数值/私有会话校验（stub须显式区分），不只源码字符串。

冻结442完整raw/hash，原437不变、恰五新，root单窗口源码审查及真实Windows自有fixture：空/Unicode/多块/超过32MiB本地copy、source与copy精确hash/EOF、source消费仅一次、借用保持、collision不变、source/target身份改变/短读/短写/EOF/ACL/Close故障到达marker及固定拒绝。目标持有期rename/delete拒绝；只处置精确本次创建材料，材料保留，不递归清理。2GiB实际大文件/全扫描资源上限未跑时显式未验，不能用计数stub称实际boundary已验。修复反馈写自有记录，AGENTS允许0，开发不Git；稳定后root独立接受/精确main集成。

本slice不实现ASAR parser/private路径消费者、副本parse前后再次hash、父进程sidecar重开/JSON、完整manifest/签名/安装运行/GUI/API。全部仍分列未验；四批外部门停止规则不变，不第五批。
