# 4B-M12 有界 ASAR header 预检

## 目标与边界

在现有 ASAR reader 前提供纯同步、有限字节输入的 header 预检与条目 DTO。它不打开归档、不调用现有 parser，也不连接原 HANDLE 捕获、私有路径读取或 M11 编排。本轮只新增预检实现、定向测试和本记录。

## 基线与依据

- 派发 HEAD：`455d4ad50830ee2495b70927e51caf830a4efbb8`，本轮没有 Git 操作。
- 派发收据列出的原 447 个文件，编辑前均与收据 SHA-256 及 raw 备份逐一相同；完成后再次逐一比对，仍为 447/447。当前可见文件清单为原 447 加本轮 3 个新文件，共 450 个；完整相对路径与 SHA-256 清单随交付提供。
- 使用已安装 `@electron/asar` 3.4.1 的 `lib/pickle.js` 生成测试 pickle；版本和入口在定向测试中核验。`disk.js`、`pickle.js`、`filesystem.js` 的 SHA-256 分别为 `849EA3EEBAF945978A48AE1F08D429D235430F4F8CC94486D124755A7FA379BB`、`771C59CF05E42EE55F5BF03CBABC84F86FD623DEE1BD725F0602812637FA0867`、`4ED3F336AF7D7906C374222C0A5D085BA91471EBA9E2B55E700190FE3CFCC24B`，均与派发收据一致。
- 直接核对 producer 后按其 8 字节 size pickle、header 长度字段、4 字节字符串对齐和零填充处理。现有结构观测器只读取了主目录只读参考并核对 SHA-256 `63BCC47AD10737B7F3F4E22006AF1CE0A1B0BDABDCB020681C14A719E7433C7B`；未复制、导入或修改它。条目 DTO 保持 `{path,file,unpacked}`，目录 unpacked 标志不传播为条目事实。

## 实现与验证

预检先验证 Buffer 类型、输入长度和硬上限，再复制私有字节；只接受精确的 size/header pickle，不接受路径、stream、HANDLE 或已解析对象。实现检查严格 UTF-8、Unicode scalar、pickle payload 与完整消费，并在 `JSON.parse` 前用有界语法扫描拒绝重复键（包括转义后重名）。它限制深度、节点、字符串、条目数和输出大小；核对 producer 文件/目录字段、link、integrity 元数据、规范 offset、archive 数据区范围与 packed 重叠；限制路径并拒绝 Windows 路径碰撞和设备名。成功 DTO 仅说明 caller bytes 中 header 元数据通过有限预检；内容、hash、签名、快照与来源身份仍标记为未评估。任一失败使用固定 failureCode 并返回零条目。

本轮验证按计划串行执行：

- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-asar-header-preflight.test.ts`：1 个文件、26 个测试通过。
- `pnpm --filter @project-xray/desktop typecheck`：通过（`tsc -p tsconfig.json --noEmit`）。
- Windows PowerShell 5.1 `Parser.ParseFile`：对收据所列 M10/M11 `windows-artifact-copy-reverification.ps1` 与 `windows-artifact-private-copy.ps1` 做 AST 解析，2 个文件、0 个解析错误；没有执行脚本。

测试覆盖 producer pickle 夹具、空树、Unicode、多层目录、packed/unpacked、目录标志、零长度、排序、constructor 与 `__proto__`、路径/条目/JSON 边界、重复键、非法 UTF-8、link、混合结构、integrity 元数据、越界/重叠、固定错误与无部分输出。没有读取或执行候选归档代码。

## 失败诊断与修正

- 首次 desktop noEmit 在测试源码中报 `TS2740`：点属性 `files.constructor` 被 TypeScript 解析为继承的 `Function` 属性，而不是动态 JSON 键。根因确认为测试夹具的访问写法；改为字符串索引后，定向套件 26/26 和 noEmit 均通过。分类：测试源码类型错误，不是产品缺陷。
- 一次基线审计命令的 PowerShell 正则有未匹配括号，且过滤发生在递归枚举之后，产生了无关错误输出。根因是审计命令构造错误；没有写入文件。随后改为仅遍历收据的 447 个路径并与 raw/hash 比较，全部匹配。分类：验证命令错误，不是产品、测试或环境问题。

## 未验证项与规则判断

未验证原 HANDLE 的 header 有界捕获、私有路径 parser 消费、parser 前后 M11/缓存隔离、packed 内容、物理 unpacked 成员、文件身份、签名、安装运行或真实 Electron/API。当前 DTO 不声称完成这些能力。

本轮不新增或修订 `AGENTS.md` 规则：已确认的问题分别是单次测试索引写法错误和审计命令构造错误，均由本任务内的直接修正与复验闭环，不形成超出现有规则、可用于同类工程问题的预防动作。原 447 文件（包括 `AGENTS.md`）保持不变。
