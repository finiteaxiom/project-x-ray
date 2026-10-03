# 4B-P 产物清单纯协议开发记录

2026-10-04。按协调方计划只新增本记录、`apps/desktop/scripts/windows-artifact-manifest-protocol.cjs` 与 `apps/desktop/src/windows-artifact-manifest-protocol.test.ts`。基线按计划提供的 `60abf56318bc95966cf2c1f307cb3ded8e553f2d` 记录；本轮不读取或执行 Git。不得修改原设计、其他源码/测试、package/lock、build/native/core/UI/contracts、AGENTS 或协调记录；不读环境/cwd/`dist`，不读候选 artifact，不使用 FS/path/child_process/ASAR/PowerShell，不注册真实 CLI，不运行 build/GUI。

## 冻结协议面

模块仅导出版本、有限常量和无外部副作用的纯协议函数：

- `PROTOCOL_VERSION = 1`、`LIMITS`、`EXIT_CODES`、`ProtocolError`；
- `parseObservation(input)`：拒绝 Proxy、非 plain object、访问器、符号键、非 enumerable 字段、循环/共享对象、数组空洞/额外属性、unknown 字段、错误类型和容量越界；逐字段捕获到私有副本，规范化无序诊断与文件顺序并深冻结，不留调用者别名；
- `deriveManifest(input)`：执行捕获、关联校验与有限状态推导，返回深冻结的 v1 DTO；输入不是认证材料；
- `deriveExitCode(input)`：有效观察返回同一推导码；无效观察为 64；未预期内部错误为 70；
- `serializeManifest(manifest)`：严格校验推导后 manifest 并返回有大小上限的确定性 canonical JSON；
- `parseManifest(canonicalJson)`：只接受 canonical JSON，验证 schema 和全部推导字段后返回深冻结 DTO。输出再解析必须与原推导一致。

观察 DTO 精确字段：

```text
ObservationV1 = {
  schemaVersion: 1,
  observationKind: "synthetic" | "caller-supplied", // 测试伪状态必须显式标 synthetic
  sourceCommit: null | 40/64 位十六进制字符串,   // 操作者声明
  files: FileObservation[],
  scan: { status, enumeratedFileCount, listedBytes, issues: ScanIssue[] },
  structure: { status, issues: StructureIssue[] },
  authenticode: AuthObservation[],
  publisherPolicy: null | { policyId, allowedCertificateSha256: string[] }
}
FileObservation = {
  rootId: "portable-exe" | "app-staging", path, bytes, sha256,
  classification: "portable-exe" | "app-file",
  peStatus: "pe" | "non-pe" | "unknown", machine: null | 4 位大写十六进制
}
AuthObservation = {
  rootId, path, fileSha256,
  captureStatus: "captured" | "not-captured" | "not-applicable",
  rawStatus: null | bounded status token,
  signer: null | {
    certificateSha256, subject, issuer, validFrom, validTo, codeSigningEku: string[]
  }
}
```

输出 DTO 保留 `observationKind`，除 schemaVersion 外固定 `evidenceBoundary="caller-observation-unverified"`；sourceDeclaration.kind 固定 `operator-declared`。全部自有 fixture 明确为 `synthetic`，不能表示 cmdlet 捕获或真实产物验收；未来 reader DTO 仍只是 `caller-supplied`，本协议不认证其输入。保留 raw scan/structure/raw Authenticode 观察，同时另列推导状态；每个文件及 Authenticode observation 由 rootId、规范相对 path、SHA-256 精确关联。`releaseDecision="not-evaluated"`、`buildAssociation="not-established"`、`runtimeWiring="not-assessed"` 永不由观察输入覆盖。publisher policy 仅记录规范化 allowlist 与其 canonical SHA-256 摘要，不认证策略或来源。

输出 `ManifestV1` 的精确顶层键为：`schemaVersion, observationKind, evidenceBoundary, sourceDeclaration, scan, structure, signatureCoverage, publisherPolicy, publisherPolicyEvaluation, files, releaseDecision, buildAssociation, runtimeWiring, exitCode`。嵌套形状固定为：

```text
sourceDeclaration = { kind: "operator-declared", commit: null | string }
scan = { observedStatus, status, enumeratedFileCount, listedBytes, issues: ScanIssue[] }
structure = { observedStatus, status, issues: StructureIssue[] }
signatureCoverage = {
  status: "complete" | "incomplete" | "not-applicable",
  applicablePeCount, capturedPeCount, unknownPeKindCount,
  issues: ["capture-not-complete" | "raw-status-unknown" | "raw-status-unsupported" |
           "signer-on-not-signed" | "valid-signer-missing" | "pe-kind-unknown"][]
}
publisherPolicy = null | { policyId, policySha256, allowedCertificateSha256: string[] }
publisherPolicyEvaluation = {
  status: "complete" | "incomplete" | "not-evaluated" | "not-applicable",
  policyId: null | string, applicableValidPeCount, evaluatedCount,
  issues: ["valid-signer-missing" | "signature-status-not-evaluated" | "pe-kind-unknown"][]
}
ManifestFile = FileObservation & {
  authenticode: {
    captureStatus: "captured" | "not-captured" | "not-applicable",
    rawStatus: null | bounded status token,
    assessment: "valid" | "unsigned" | "failed" | "incomplete" | "not-applicable" | "not-evaluated",
    signer: null | Signer
  },
  publisherTrust: { status: "matched" | "mismatch" | "not-evaluated", policyId: null | string }
}
```

`ScanIssue` 精确枚举为 `cancelled,timed-out,enumeration-incomplete,file-read-failed,file-changed,reparse-rejected,file-count-limit-exceeded,depth-limit-exceeded,file-size-limit-exceeded,total-size-limit-exceeded,child-error,child-nonzero,child-not-closed,invalid-helper-reply,scratch-cleanup-incomplete,declared-complete-inconsistent,enumerated-count-mismatch,listed-bytes-mismatch`；`StructureIssue` 精确枚举为 `missing-required-entry,unexpected-entry,python-worker-location-mismatch,native-unclassified,portable-root-missing,portable-not-pe,app-staging-empty,profile-unsupported,profile-incomplete,declared-passed-with-findings`。数组重复项拒绝并按 code-point 排序。plain-data 捕获本身另限 5,000 阵列长度、200,000 节点、80 层和 32 MiB 字符累计，拒绝超限而不先复制无限输入。

所有对象键精确校验。Windows 路径必须是非空、规范 `/` 分隔的相对路径，拒绝绝对/UNC/驱动器/ADS、反斜杠、空或点段、控制字符、尾随点/空格、保留设备名及 Windows 等价重复路径；不修复路径。路径最多 64 段、512 UTF-8 字节，每段最多 255 UTF-16 code units。拒绝同 root 下重复文件或重复 Authenticode 关联；跨 root 同名允许。排序用显式 Unicode code-point 顺序，不用 locale。SHA-256 只校验格式和 DTO 关联，不声称已读或散列真实字节。

硬上限：每报告最多 5,000 个文件记录；每文件 2 GiB；累计 8 GiB；安全整数；签名者 Subject/Issuer 各最多 2,048 字符、有效期固定 UTC ISO 毫秒格式且 validFrom 不晚于 validTo、EKU 最多 16 项且每项最多 256 字符；签名者 canonical 子对象最多 2 KiB；policy 最多 256 个不同证书 SHA-256；有限诊断码；canonical 报告最多 32 MiB。观察到超过扫描限额可用限额内文件记录加枚举计数/issue 表达为 incomplete；DTO 数组本身超过安全接收上限则拒绝。

## 状态与退出矩阵

| 维度 | 推导规则 |
| --- | --- |
| scan | 保留 observed status。仅 `complete` 且枚举数/文件记录数、listedBytes/记录大小一致、无 issue 且未超限才是 complete；自相矛盾降为 incomplete；原值 failed 为 failed。 |
| structure | 保留 observed status。failed 或任何已知 finding / portable EXE 角色不匹配为 failed；无 finding 的 not-evaluated 保持 not-evaluated；`passed` 携带 finding 不得保留 passed。 |
| PE 识别 | 每个文件必须有恰好一条按 rootId/path/fileSha256 精确关联的 Auth observation；缺失/重复/错配关联作为无效 DTO 拒绝为 64。PE 的 not-captured、未知 PE kind、unsupported/未知 raw Status 均为 coverage incomplete。非 PE 必须显式给 `not-applicable` 行，不代表执行过签名检查；未知 raw 原值保留。 |
| raw Status | `Valid` → valid；`NotSigned` → unsigned（单独保留，属于完整的已知签名失败）；`HashMismatch`/`NotTrusted`/`UnknownError` → known failure；`NotSupportedFileFormat`/`Incompatible`/未知 token/未捕获 → incomplete。cmdlet 未返回用 null，不伪造 `UnknownError`。`NotSigned` 同时带 signer 是自相矛盾的捕获，coverage 降为 incomplete。 |
| publisher trust | 无 policy → not-evaluated。仅 raw `Valid` 且有 signer certificate hash 时按显式 allowlist 得 matched/mismatch；其他状态为 not-evaluated。对适用的 Valid 项缺 signer 时 trust coverage incomplete。Valid 本身不等于可信；NotSigned 不转换成 policy mismatch。 |

退出码固定优先级：无效 DTO/control 为 64（本模块没有 CLI）；意外内部错误为 70；scan 不是 complete、structure 未评估、签名覆盖不完整或显式 policy 的适用 trust coverage 不完整优先 3，即使同时存在已知失败；材料完整时 structure failed、`NotSigned`、known signature failure 或显式 policy mismatch 为 2；只有 scan complete、structure passed、所有适用签名覆盖完整且无上述失败时为 0。零仍不表示发布批准。无 PE 时签名 coverage 为 not-applicable；无 policy 时 trust 为 not-evaluated，可在其他门通过时退出 0。

## 实施与反馈闭环

- CJS 模块使用 Node 内建 `crypto` 与 `util.types.isProxy`，没有导入 FS/path/child_process/ASAR/PowerShell；require 只导出协议版本、上限、退出码、ProtocolError 和五个纯协议入口。未注册 CLI、未读真实 artifact 或环境。观察 DTO 进行 plain-data 私有捕获、全字段 schema 验证、关联检查、深冻结、稳定排序和 canonical 序列化/重解析；输入大小、树节点、对象深度、数组、路径、文件、signer、policy 和报告均有显式上限。
- 定向自有 fixture 覆盖 synthetic 来源标签、调用者事后改写、访问器不执行、Proxy/符号/稀疏/别名/unknown field 拒绝、Windows 路径逃逸/别名重复、文件/SHA/Auth 缺失重复错配、签名全 raw-status 矩阵、Valid 与显式 policy 匹配/不匹配、NotSigned 独立语义、capture 与 policy 不完整优先级、容量边界、矛盾状态降级、解析→推导→canonical JSON→重解析、无模块注册副作用以及 64/70 固定错误映射。所有伪状态均随 `observationKind="synthetic"` 输出，不能表示真实 cmdlet 或产物验收。
- 独立复读时补入机器可读的 synthetic/caller-supplied 区分，并将 plain-data 捕获节点/深度/字符串容量纳入公开 LIMITS；明确 Authenticode observation 对每个文件必须恰好一条、非 PE 明确 not-applicable。再跑的定向回归覆盖这些门。

### 初始失败及修正

第一次 desktop `noEmit` 发现新增测试的严格 TS 索引访问可能为 `undefined`，以及 LIMITS 测试类型使用宽泛 Record 导致值可能缺失。分类为**测试代码类型缺陷**，非协议实现缺陷或环境问题。为固定 fixture 索引添加非空窄化，并把测试中的 LIMITS 精确列为协议公开字段；之后完整按规定顺序重跑三项均通过。期间没有产品逻辑失败，也没有依赖/环境失败。

### 最终验证命令

1. `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-manifest-protocol.test.ts`：1 file passed，22 tests passed。
2. `node --check apps/desktop/scripts/windows-artifact-manifest-protocol.cjs`：exit 0。
3. `pnpm --filter @project-xray/desktop exec tsc -p tsconfig.json --noEmit`：exit 0。

最终三文件 SHA-256 在协调交付消息中冻结列出；本记录自身哈希不写回本记录，以免自引用改写摘要。过程验证未运行完整 test suite、其他包 typecheck、build/native、CLI/artifact/ASAR/Authenticode、子进程/PowerShell、Electron/GUI、安装/升级/卸载、Git 操作或远程/凭据流程。阶段 B、安全 reader、真实产物、来源关联和发布批准仍未验。`AGENTS.md` 本轮无新增规则：纯 DTO 协议与自有 fixture 没有提供可泛化、未被现行证据/安全规则覆盖的新经验。
