# 4B-M5 同 HANDLE 有限 PE 捕获与消费

2026-10-11，开发-Sol。属于原第四批 Windows 发布内部读取切片，不是第五批或完整 scanner。

## 基线与边界

实际 HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`、分支 `codex/llm-explanations`。实施前核对完整 410 文件原始前像：baseline SHA-256 `904270B008FAC23950454246F7B018FD2D36F37604A99A1E5B53690933CEBBA0`，原始备份及当前文件全部一致。

只修改一个旧文件 `windows-artifact-handle-bridge.ps1`，新增计划指定五文件：纯 CJS consumer、新 PS 自有 fixture 入口、纯测试、Windows 集成测试及本记录。其他 409 旧文件冻结，包括原 M4 库之外的 probe/测试、M3、已接受纯 PE、manifest 协议和测试、S3 全部 UI、backend、native、依赖、配置和 AGENTS。不执行 Git，不修改其他 checkout。

## 实现

`Get-XRayArtifactObservation` 新增默认 false 的内部 `CapturePeHeader` 选择；默认返回原 DTO，不增加字段。明确选择后仅在原同 HANDLE、固定 1 MiB ReadFile 流中复制 DOS 至多 64 字节及 PE signature+COFF 至多 24 字节。DOS 齐全并满足 MZ、e_lfanew >=64、范围不超过原叶长度时才捕获 PE。按块重叠计算复制位置，允许 DOS/PE 横跨短读和 1 MiB 边界；没有新 seek、路径打开、sharing 回退、写/删端口或新原生 API。

完整 hash、实际 EOF 长度、读前后叶 metadata/128bit 身份和原父链检查仍在原位置全部执行。只有全部通过后才生成内部 `peCapture`，明确 version/fileBytes/canonical lowercase hex/peOffset；范围失败留空 PE，语义由纯 PE 构造器判定。读取/身份/父链失败不返回部分观测。最多增加两个常数数组 64+24 字节，最终清零；有限编码字符串也为常数大小，不保留全文件。

纯 CJS `consumePeCapture` 同步复制并校验全部普通字段，拒绝 proxy/accessor、symbol/多余/非 enumerable 字段、非 canonical 编码、范围/长度/计数不一致。使用既有真实 `derivePeHeaderRange` 重新生成私有 range，再调用 `observePeHeader`，不复制或伪造请求对象。只返回冻结的有限 hash/identity/count 和既有 PE 观测，去掉全部原始 header。导入除 Node loader 读取该模块源码外没有 FS/process/native/network 操作，不注册 CLI。手工 DTO 只接受形状，不能认证来源；同对象来源须由真实桥接路径独立验收。

新自有 PS fixture 复用 M3 start/ready/release/terminal 和原明确重复键/escaped duplicate 检查，ConvertFrom-Json 前先验 token/键。仅显式自有文件，ready 后持完整叶/父链到 release；只有确认 CloseHandle 后输出 released。故障注入只在该测试入口包装原方法，提供七字节短块、提前 EOF、读取失败、重复读取、叶/父身份变化和第一次关闭失败。原 probe 不修改。实际 Node 测试 consumer 使用新 CJS 消费捕获，并与独立自有 fixture 字节、SHA-256 和完整身份比对。

结果继续 `snapshotStatus=incomplete`、`signatureStatus=not-evaluated`。不声称映射不可变、目录枚举完整、签名、运行或 literal 零 OS 后代成立。有限内部 DOS/COFF 不写入公共 manifest、日志或源码记录。

## 反馈闭环与实际验证

- 初次辅助字节编辑发现旧 PS 文件是 LF，编辑器预期 CRLF 的匹配断言失败；脚本在落盘前终止，旧文件未写。确认原始换行后采用原 LF 小块修改。属于工具使用问题，不是产品故障。
- 首次纯回归 72 项中 71 通过、1 失败：新增测试试图 spy ESM namespace 的 `openSync`，namespace 不可配置。首次 desktop noEmit 同时指出 CommonJS 目标不能使用 import.meta。均为新测试夹具缺陷；改用实际 CommonJS require，不放宽业务断言。导入测试进一步确认只有一条 Node loader 源码读取且路径就是 consumer 模块。
- 最终 `pnpm exec vitest run apps/desktop/src/windows-artifact-pe-capture.test.ts apps/desktop/src/windows-artifact-pe-observation.test.ts apps/desktop/src/windows-artifact-manifest-protocol.test.ts --maxWorkers 1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`：3 文件、72 项通过，0.554 秒。新纯 consumer 41 项与既有 PE/manifest 31 项均通过；既有测试原字节保留。
- `pnpm --filter @project-xray/desktop exec tsc --noEmit`：通过，包括新 Windows 测试的类型检查，不代表执行通过。
- `node --check apps/desktop/scripts/windows-artifact-pe-capture.cjs`：通过。
- 宿主 PowerShell 的 `System.Management.Automation.Language.Parser.ParseFile` 分别解析旧桥接和新 fixture：零语法错误。只解析 AST，未导入/执行脚本、绑定 native、打开 HANDLE 或启动 PS5.1 测试进程；目标 PS5.1 实际兼容性仍未验。

纯回归覆盖 x64/x86/未知机器、non-PE/短 DOS/坏签名、DOS 内 offset/越界/最大 uint、1 MiB 周围和 2 GiB 上界、捕获长度/范围/计数/编码、getter/proxy/多余字段、输出冻结和后改污染。纯 DTO 测试不证明实际流采集正确。

## 已编写但未执行的 Windows 技术验证

新 `windows-artifact-pe-handle-capture.test.ts` 可由协调方单窗口定向运行：

`pnpm exec vitest run apps/desktop/src/windows-artifact-pe-handle-capture.test.ts --maxWorkers 1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`

包含正常/未知 PE、零/短文件、错误 DOS/PE/offset、首块/块末跨界/后续块/精确 EOF/较大自有材料、七字节分块、提前 EOF/读取失败/重复 session/叶父身份变化拒绝部分 ready、既有 writer、持有期间写拒绝及关闭后重开、实际 consumer 取消/deadline/异常、close failure 无 released terminal、junction/点段拒绝、重复键/escaped duplicate/错 token/重复 start 和固定脱敏。测试仅创建明确标记自有材料并保留，不递归清理、不扫描候选、不执行材料。junction EPERM 仍是正确失败，未删除断言或更改安全设置。

本轮技术窗口关闭，以上实际测试全部未执行。M4/M3 原 Windows 技术回归也未执行；原历史验证不能作为本轮验收。协调方需独立源码审查、单窗口新旧 Windows 回归及实际端口验收后再决定精确集成。

## 交付和经验评估

交付核完整 410→415 原始 before/after hash，仅一个旧文件及五新文件；其他 409 旧文件逐字节一致。精确补丁独立逐 hunk 从原始副本重建并比对当前字节，不把 Git 总差异当本轮增量。

AGENTS 新增 0 条，按任务冻结；已存在的同句柄读取、边界/身份验证和有限错误规则覆盖，无新产品故障经实际 Windows 复现，工具及夹具失败不升为仓库规则。

未执行 build/native/dist/Electron/GUI、实际 HANDLE/PS5.1 进程、网络/API/凭据、签名、材料扫描、用户项目或 Git 操作。本切片不证明完整 reader/ASAR 副本/全目录/sidecar/checked-close 整体、完整 manifest、安装或干净 Windows；四批停止门保持。
