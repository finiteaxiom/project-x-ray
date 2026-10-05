# 2D-L5：所有权语义结果持久化契约

2026-10-05。按 [批准计划](../plans/2026-10-05-ownership-semantic-result-contract-implementation.md) 只实现 result-envelope contract，不启动第五批，不执行 Git 收尾。

## 基线、来源与文件范围

- 实际目录：`D:\Projects\Project X-Ray`；开工与交付 HEAD 均为 `49b484663286a4a57d22cdd8564126c163587b14`。
- 计划 SHA256：`0EA3D104E86A4AE58FFD690C54CC7EB2DF13B5C78476C6F7356B395715FD4553`。
- root 提供的 394 项原文件清单 SHA256：`A09C13C3AB58FD09AAF841CC981C6C02DC4AE18AE9C417D0817335D626176E59`。原 `packages/contracts/src/index.ts` SHA256 为 `B7495553483DFFB851D20EDC44097C812A065D8C97E8BEF45A028C8EEAFE8DEA`。
- 开工时工作区已有四个 tracked 文档差异及一个协调计划 untracked；全部保留。与 root 提供的字节清单比较，最终 394 项中 391 项逐文件 SHA256 不变。两份协调记录在实施期间又有基线外改动；按指示不读取、不修改且不纳入本任务 patch：

| root 来源文件 | 提供基线 SHA256 | 当前 SHA256 |
| --- | --- | --- |
| `docs/development-runs/2026-10-01-overnight-handoff.md` | `E4575E1476C386DBDF1DECEB76B3E3ED2BDF7255E54199DED1E1A0A585F87CA2` | `C95C8C8B3A4A8F1FBD18C09A1B3CAE871341E47675A4F88083D11D99A93B918D` |
| `docs/development-runs/2026-10-01-v1-long-development-review.md` | `CBAD89CE45BCC2E1D223BD49DEA6A04C6380347B79FF42EF5CAEADC2EDF324B8` | `E0C8B816E7E7A1CD69EC3A882D7EBF4F314E3CEF1DD91277A67DFF3FF0126703` |

本线程仅新增 `packages/contracts/src/ownership-semantic-result.ts`、对应测试和本记录；`packages/contracts/src/index.ts` 只添加一行 `export * from "./ownership-semantic-result.js";`。没有改既有契约、数据库、应用、LLM、UI、AGENTS 或公共协调文档。

## 实现与验证反馈

新增版本 `1.0.0` 的 strict envelope，字段仅包括 `version`、完整 L3 `identity`、`createdAt`、`completedAt`、`bindingHash`、`responseDigest` 和原 strict `response`。builder 不收 caller 摘要。builder 与 validator 都在首次 await 前按属性描述符完整捕获 private plain JSON；拒绝未知/隐藏/符号字段、访问器、`undefined`、非有限数、非良构 Unicode、稀疏数组、循环和不支持原型，不执行 getter 或 `toJSON`。不依赖 Node-only 模块。

完成状态通过现有 `ownershipSemanticTaskRecordSchema` 的 `phase="completed"`、`code=null` 规则核验，因此沿用完整 UTC 小数秒比较；不以 `Date.parse` 截断。response 必须匹配 identity 的 `assessmentPackageId` 和现有 response 版本，criteria ID 及各证据/限制/答案范围数组必须唯一，但保留原顺序，不猜补或重排。response 摘要是完整 canonical response 的 SHA256；binding 摘要与 graph `semanticBindingHash` 一致，只去掉 `taskId`、`ownerSessionId`、`contextHandle`、`contextEpoch`，保留其余 identity（包括 `bodyDigest`）。返回递归冻结的新 DTO。

首轮 contracts noEmit 有一个新测试的 TS2322：测试 fixture 的 `version` 被推宽成 `string`，而 response schema 要求字面量版本。修正为使用现有 `OwnershipSemanticResponse` 类型后 noEmit 通过；这是测试类型缺陷，不是产品行为问题。首轮定向测试 10/10 已通过，修正后完整回归再次通过。

测试用 8 个 criteria、64 个较长 Unicode evidence ID 及含中文、emoji、引号和反斜杠的说明核对 canonical UTF-8 字节数和最终 envelope 字节数。当前 strict response 字段自身上限使 256 KiB/272 KiB 超限分支无法由合法契约材料触达；本轮验证了实际编码计量与常量，不宣称实测穿过这两个超限分支。caller 自洽重算的候选也能通过结构/摘要验证，测试明确证明本契约不代替 exact prepared-response 验证或发布授权。

两次只读核对命令出现工具用法问题并已改正：PowerShell byte-array 上调用不可用的 `SequenceEqual`，改用 SHA256 比较；`rg` 指向不存在的 graph 测试路径，后改为实际 `packages/graph/src/ownership-semantic-task-store.ts` 和 contracts 测试路径。这些不是产品或环境故障。

## 最终验证与精确改动

- `pnpm --filter @project-xray/contracts typecheck`：通过，`tsc -p tsconfig.json --noEmit`，exit 0。
- `pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-result.test.ts src/ownership-semantics.test.ts src/ownership-semantic-task.test.ts src/ownership-semantic-policy.test.ts`：4 个文件、109/109 项通过，exit 0。
- `git diff --check -- packages/contracts/src/index.ts`：通过。该文件相对原 bytes 只增加上述一行。
- 没有提交、推送、合并或其他 Git 写入；HEAD 未变。

| 本线程文件 | 状态 | 最终 SHA256 |
| --- | --- | --- |
| `packages/contracts/src/ownership-semantic-result.ts` | 新增 | `E9AB87EEC083CDAB98A421D2433BA73A96071752D72AC7CC60A1E3B510861CF1` |
| `packages/contracts/src/ownership-semantic-result.test.ts` | 新增 | `8A1E27FF7B4CC15CF7A05978D21E4F3F268ABED5FEC2044F246520EEEFB9460C` |
| `packages/contracts/src/index.ts` | 一行 export | `42C2A1F66567627461EAD62D0998FA012EAD6D12A09F9A6E620A623C642FB12F` |

本层只认证严格形状、有限本地关联和摘要自洽。builder 的 `createdAt` 是调用者提供的 T1 候选值，契约不能证明其来自权威任务行；摘要不是签名或 provenance，且不能证明答复符合 exact prepared rubric、证据引用、答案边界、当前性、模型质量或 global completed/source 发布状态。上述整链与持久化仍待后续原四批门禁。本轮无 AGENTS 新规则：首 await 前捕获与完整 body 字节身份已有通用规则；自洽摘要不等同权威发布也由本契约注释及测试明确约束。AGENTS 按计划保持冻结。
