# 第四批 4B-M5：同 HANDLE 的有限 PE 捕获与消费

2026-10-11，协调方。只推进原Windows发布批次。来源是当前M4的Get-XRayArtifactObservation只在同HANDLE顺序hash，尚不提供4B-P已验纯模块所需的DOS/COFF有限材料；旧portable CLI按路径另读不满足M2对象绑定。4B-A已修复独立接受，但真实ASAR枚举/安全副本仍另有未验边界。本切片只把单文件hash与PE头消费接成实际自有材料路径，不扩展产品或启动第五批。

## 路由与基线

原开发-Sol，gpt-6.1-sol/medium，仅5170。协调方先核当前404冻结像全部hash、HEAD及M4/M3依赖，精确补已接受4B-P模块/测试/记录三个缺失文件、manifest协议/原测试两个缺失依赖及本计划，不覆盖任何既有文件。新的410正式起点和raw副本保存自己ignored目录，开发再核之后实施。新PE/结构员工及主目录原Luna保持冻结。复杂共享接线不转新员工。首次协调基线检查发现5170没有manifest依赖，在任何复制前停止；补充明确缺失依赖后重新检查，非产品失败。

只允许修改一个既有文件apps/desktop/scripts/windows-artifact-handle-bridge.ps1；只允许新增五文件：

- apps/desktop/scripts/windows-artifact-pe-capture.cjs
- apps/desktop/scripts/test-fixtures/windows-artifact-pe-handle-probe.ps1
- apps/desktop/src/windows-artifact-pe-capture.test.ts
- apps/desktop/src/windows-artifact-pe-handle-capture.test.ts
- docs/development-runs/2026-10-11-artifact-pe-handle-capture.md

原M4 probe/测试、M3进程端口、PE纯模块、manifest协议/原测试、ASAR模块、native/broker/loan/cache/UI/DB/core/package/lock/build/共同规则及其他正式文件全部冻结。AGENTS本轮不修改；经验可以记自有记录供协调方逐条评估。不得自行Git。

## 有界实际目标

为M4单文件顺序hash提供明确选择的内部有限header捕获；原默认API/DTO和原正确断言保持。不新增seek、第二路径打开、扩大sharing、创建/写入/删除能力或新原生API。只从同一次ReadFile流复制最多64字节DOS，以及经MZ/e_lfanew/实际长度严格校验的至多24字节signature+COFF。处理offset在首块、块末跨界、后续块、EOF及短文件，不把整文件留Buffer。固定1MiB流缓冲不变，header额外空间为常数；整数/范围/计数检查失败关闭。

只有原同HANDLE完整hash、叶/父身份与长度稳定检查全部成功后才返回有限内部捕获；任一失败不得部分成功，原readStarted/关闭/错误语义保持。捕获不得包含任意源码、路径、异常文本、可执行体或无界原始材料。有限DOS/COFF字节只用于内部消费，不持久化进公共manifest或日志。内部DTO明确schema、长度、范围及有界编码，不靠调用者声明机器号。输出仍snapshot incomplete/signature not-evaluated；不能认定文件不可变、目录快照或签名/运行通过。

纯CommonJS consumer同步完整捕获并运行时校验内部DTO，拒绝访问器/proxy/多余字段、非canonical编码、长度/范围不一致及后改污染；使用已接受derivePeHeaderRange/observePeHeader真实构造器重新计算范围并消费，不能复制伪造其私有请求。只输出既有PE有限观测与关联的有限hash/identity/count，手工传入DTO不等于可信来源认证；真正同对象保证来自已审实际桥接路径。模块导入零FS/child/native/network副作用，不注册生产scanner CLI、不自动读取候选材料。

新PS fixture入口只收显式自有文件，复用M3严格start/ready/release/terminal与有限错误，不以ConvertFrom-Json覆盖重复键作为校验；ready后完整handle链继续持有，到真实release/close才算释放。真实消费发生在Node consumer，覆盖正常x64/x86/未知machine/non-PE/短DOS/错signature/offset边界、跨1MiB块及较大自有fixture；有限捕获与独立fixture字节和完整SHA/128bit身份核对。保持取消/deadline、重复会话、关闭后可重开和固定脱敏失败，拒绝路径逃逸及写占用。不能由mapping单个实验推广不可变保证，literal零OS后代门保持未满足。

## 验证和交付

开发先只普通纯单元/原PE及manifest回归、desktop noEmit及JS/PS解析，不运行真实PowerShell HANDLE/进程技术测试，也不build/native/dist/Electron。重型/系统技术窗口当前关闭；新Windows集成测试写成可运行自有fixture入口，交付冻结后由协调方单窗口运行实际M4原回归/M3及新端到端测试。未运行的测试必须明确记未验，不能预报通过。原symlink EPERM断言不删、不改安全设置，不扫描旧artifact或用户数据、不执行候选代码。

开发以正式基线/raw字节和精确增量patch交付，记录实现/纯验证/失败诊断/修正/未验边界后冻结。协调方独立审全部差异、必要普通和目标Windows技术回归之后才接受和精确集成。本切片不证明完整reader/ASAR私有副本/全目录枚举/sidecar/checked-close/完整manifest、安装/GUI/API/签名/干净Windows通过；四批停止门保持，不因长期员工制造后续任务。
