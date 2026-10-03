# 4B-P：产物清单纯协议实施

2026-10-04，协调方。root 已完整复审修订后的 windows-artifact-manifest.md 及实际源码 reader/候选 better-sqlite3 selector。接受阶段 A 的拆分、两 artifact 输入与受限 control data、来源声明/扫描/结构/签名/信任分别报告的设计方向；阶段 B 的 Windows API、对象锁定、ASAR 私有副本和离线签名仅是后续要求，尚无安全 reader 或真实扫描接受。

当前 main60abf56318bc95966cf2c1f307cb3ded8e553f2d；原“开发”在主 checkout 实施，仅新增：

- apps/desktop/scripts/windows-artifact-manifest-protocol.cjs
- apps/desktop/src/windows-artifact-manifest-protocol.test.ts
- docs/development-runs/2026-10-04-artifact-manifest-protocol.md

目标是提供可调用、严格且可独立验证的 observation DTO 解析/规范序列化/退出码推导函数；这是后续 reader 的协议准备，不是发布 CLI 或产品检查通过。P2，依据旧检查无完整 manifest 与修订设计。不得修改原设计、其他 scripts/tests、package/lock、build/native/core/UI/contracts、AGENTS 或协调记录。禁止 FS/path/child_process/ASAR/PowerShell/候选模块导入与副作用，不读环境/cwd/Git/dist，入口被 require 时只导出纯函数，不注册命令。无新增依赖，无 Git 收尾。

## 协议门

实施前在自身过程记录列出确切 DTO/schema/导出/版本及状态矩阵，开发记录中公开可复核，不把字段选择藏在测试中。字段按本设计最小用途定义，严格拒绝未知字段/状态、错误类型、访问器、符号属性、非 plain data、数组空洞和超限，不能用 JSON.stringify 静默丢字段完成捕获；捕获后返回私有数据，不保留调用者可变别名。输出始终标明“调用者提交的观察材料、未验证来源”，releaseDecision 固定 not-evaluated、buildAssociation 固定 not-established、runtimeWiring 固定 not-assessed；protocol 校验不能给 DTO 内容认证或签名。

固定 portable 单文件与 app staging tree 两 root 的角色、相对路径及一文件一记录。拒绝绝对/驱动器/UNC/上级/控制字符/空路径和 Windows 等价重复路径；只输出规范斜杠路径，不自动修复歧义。数量/深度/大小/安全整数/总量、有限 signer/policy/诊断、32MiB报告上限与稳定排序都有硬门；排序用明确字节/码点顺序，不依赖 locale。SHA只校验格式与关联，不宣称实际读取/散列过文件。manifest 不含源码/证书原文/任意异常或绝对路径。

scan、structure、authenticode capture/raw状态及签名评估、publisher policy 信任独立；Valid不是publisher可信，NotSigned不是其他签名失败，不支持/未知状态保留原值并不完整，未捕获用null而非伪造UnknownError。逐PE覆盖、非PE not-applicable、重复/缺失关联、签名者与policy关联、状态自相矛盾必须拒绝或推导明确不完整，不能把调用者complete标签直接传成成功。声明SHA/policy命中不建立来源或运行时事实。

明确退出优先级：协议/control输入无效固定错误对应64（无CLI执行）；内部错误70独立；任何 scan不完整/failed、签名未捕获/不支持/未知/未评估覆盖都不能得到0，即使结构或签名另有失败，完整性问题优先3；材料完整时结构/已知签名失败/显式policy不匹配为2；仅完整扫描、结构passed、适用签名覆盖完整且无已判失败/显式policy mismatch为0，仍永不表示发布获批。无PE与非PE对应可以签名not-applicable，不制造缺失；需完整列出无policy和NotSigned时的原始语义及退出矩阵。状态的推导/错误与原始观察保留有各自字段，不能覆盖rawStatus。

至少以最小正例、排序/重复/未知字段/身份错配/超限、全原始签名状态、publisher缺省/命中/不命中、矛盾complete标签、参数无效/完整失败/完整通过/不完整优先级、输入后修改和无模块导入副作用回归验证。伪状态只能标synthetic，不冒充cmdlet或真实产物验收。直接调用纯函数完成解析→状态→canonical JSON→重解析/一致性路径，不能只留schema常量。

## 验证和交付

仅普通Node/Vitest定向测试、node --check及desktop tsc --noEmit；不得用 npm/pnpm pretest触发native重建，不运行build/dist/真实候选/GUI。失败按测试/实现/环境分类，修正再验证；不修改旧正确断言。冻结三文件/hash、准确命令与未验项，root读实际差异/运行回归再决定接受。若desktop类型失败来自保留未验历史模块，记录精确错误而不跨范围修复。

阶段 B 不自动开启。真实文件安全、子进程/签名/ASAR、build association、安装升级卸载、GUI、签名/干净 Windows/公开发布均未验。AGENTS经验候选仅记录，允许零条，协议准备不等于工程经验。
