# 4B-M12 有界 ASAR header 预检与元数据观测

## 当前实现依据

M10/M11 已独立接受并精确集成主目录，提供私有副本与原 HANDLE 重复核验。M2 ASAR 第3/4条还缺实际 parser 前后的控制路径编排。直接读取当前安装 @electron/asar 3.4.1 的 disk.js、pickle.js、filesystem.js：readArchiveHeaderSync 从八字节 size pickle 取调用者材料声明的 size 后直接 Buffer.alloc(size)，readString 非严格 UTF-8，JSON.parse 会覆盖重复键；readFilesystemSync 按路径缓存。现有结构观测仅消费调用者条目，不读取 header。本切片实现可运行的纯字节有界预检及条目转换，作为控制路径 parser 之前的必要拒绝门；不替代后续现有 @electron/asar parser，也不把纯字节观测冒充 M2 reader 完成。

## 责任与文件边界

work tree 2，原 ID、5170、gpt-6-luna/max，仅三新：

- apps/desktop/scripts/windows-artifact-asar-header-preflight.cjs
- apps/desktop/src/windows-artifact-asar-header-preflight.test.ts
- docs/development-runs/2026-10-13-artifact-asar-header-preflight.md

派发前447完整文件与 M11 已接受来源逐字一致并保存完整 raw/hash；原447全部冻结，尤其 PS/HANDLE/native、M10/M11、结构观测、package/lock、AGENTS、公共记录。主目录 plan 可直接读取，不复制到自身目录。依赖已安装版本及来源由协调收据记录，不新增依赖。缺固定能力或契约冲突反馈协调方，不修改冻结文件。

## 可运行行为

纯同步转换，只接受精确八字节 size pickle、精确完整 header pickle 的有限 Buffer，以及有限安全整数的 archive 总长度；不接受路径、stream、回调、脚本、HANDLE 或调用者已解析对象。先检查输入自身类型、长度与硬上限，再捕获本次私有字节与标量；无路径读取/解包/require 候选内容，无异步和持久缓存。导入模块无执行副作用。

根据实际 producer 的两个 pickle 布局核长度、payload、四字节对齐、string 字节长度和完整消费；不得在核上限前按声明分配。八字节前缀与 header 实际长度严格一致，header cap 8MiB、archive cap 2GiB；data offset/length 使用安全算术，截短、负长度、声明溢出、额外未消费材料拒绝。padding 规则须以实际已安装 producer 源码和生成夹具证明，不能凭推测增加不兼容断言。严格 UTF-8 与 Unicode scalar；在 JSON.parse 前用有界语法扫描拒绝每层重复键（包括转义后同键），有限深度/节点/字符串，避免栈溢出或无界递归。可自行实现有限 scanner，但不得依赖正则猜测嵌套 JSON 或放宽到静默覆盖重复键。

核实际 ASAR header 的 files 树，目录与 packed/unpacked 文件分类互斥；固定有限字段按实际 producer 核验，link 必须明确拒绝为不完整，不能解析、跟随或当普通文件。size 为安全非负整数，packed offset 为规范非负十进制字符串，范围在 archive 数据区内，非空 packed 区间不重叠；零长度文件不得误拒。unpacked 文件不凭 size 推断，必须核标志及无 packed offset。directory 的 unpacked 标志是合法 producer 材料，核标志但输出结构 DTO 的目录 unpacked=false；叶标志与目录传播须核实际 producer，不能补造不存在的事实。integrity 仅作为有界 metadata 校验，不能标已验证内容或签名。

最多5000条目录/文件、路径深度64、UTF-8路径512字节、单组件255 UTF-16单元；拒绝绝对路径、空/点/父组件、反斜杠、ADS、控制字符、Windows歧义名称及大小写冲突，适用规则须与冻结结构观测兼容。constructor/__proto__ 等名称不能触发原型访问，使用 own 属性/安全字典；合法路径不因 JS 对象继承被静默遗漏。输出稳定有限 DTO：观测状态、固定 failureCode、计数/长度、排序后的 {path,file,unpacked} 条目，来源明确 caller bytes / header only，snapshot incomplete、signature not-evaluated、content/hash/source identity not-evaluated。失败零部分条目，无原始 JSON/源码/异常文本泄露；输出 JSON UTF-8 总量不超过32MiB。成功只证明有限 header 及范围描述一致，不证明 packed 内容、物理 unpacked 成员、真实文件身份、来源、签名、完整 reader 或可运行。

## 最小充分验证

开发仅串行运行该纯定向套件与 desktop noEmit；不跑 HANDLE/native/build/dist/Electron、其他 suite 或候选项目脚本。使用当前安装可信 @electron/asar 3.4.1 producer 的真实 pickle 序列化生成 golden bytes，并证明所用入口/版本；允许从已安装可信 pickle helper 构造 header，不加载候选档案代码。覆盖空树、Unicode、多级目录、packed/unpacked、合法目录 unpacked、零长度、排序/精确 flags；恶意超限长度/截短/错 payload/不完整消费/非法UTF8/重复及转义重复键/深度节点条目边界、链接/混合形状、越界及重叠区间、Windows路径碰撞、原型名称与固定错误。记录真实失败与修复、未验项、规则判断0可接受；原 AGENTS 冻结，不 Git。

交付冻结450，root独立完整差异/原447 raw核验、源码及定向回归/type接受，必要时修复明确允许文件后复验；精确主集成只三新，其他555 raw/hash保持，再适用回归。暂不扩大到全套回归或重跑 M11。下一步仍需原 HANDLE 的有界 header 捕获、私有路径 parser 消费及前后 M11/缓存隔离编排；未连接这些端口时明确待实施。sidecar、完整 manifest、安装签名运行与真实 GUI/API 未验；四批停止门保持，无第五批。
