# 4B-S1a 文件能力独立审查：首稿未接受

2026-10-04 05:57，协调方。main `f0e9a799dc9c225aea212ceac900c4b223638a5f`，原 Sol HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`。实际收到冻结八文件及 ignore 一行，开发记录 SHA-256 `AEBE3555B2BFF142642AC96C3F2325951434D9E6BA454C408C40C03F4C1D8C0B`；全部七个实现/测试 hash 与记录表相同。Graph/application/capsule core hash 与既定冻结基线相同。旧 worktree 未验改动保留，不整体合并。

## 首稿代码与技术复验

实际阅读原生产品/独立 fixture、adapter、两脚本、test、构建配置及开发记录；产品 target 无 fixture exports。逐组件相对 HANDLE、share=0 全组、候选集合复核、128KiB 分块、强 napi_ref、pending close/取消边界和 fixed result flags 已审查；这不构成全局停写或生产保护保证。

协调方接管唯一重型窗口，在冻结 Sol 目录执行：

- `node packages/graph/scripts/build-windows-upgrade.cjs`：exit0，`UPGRADE_NATIVE_BUILD_OK`。
- `node node_modules/vitest/vitest.mjs run packages/graph/src/windows-upgrade-files.test.ts --fileParallelism=false`：exit1，29通过/1失败/0 skip，634ms。真实 leaf file symlink 创建 EPERM，尚未进入产品拒绝门；这是环境限制，不删断言、不改安全设置，不把 junction 替代成通过。
- `pnpm --filter @project-xray/graph exec tsc --noEmit`：exit0。
- 原 smoke、`--expose-gc ... --gc`、原 smoke `--crash`：各 exit0，Node24.17.0 的原成功标记；只本次自有根/child PID。
- 实际既有 Electron 二进制直接 argv 原 smoke `--run`，由独立 Node spawnSync 捕获（windowsHide、30秒界限）：status0、signal=null、无 error、stderr为空，`UPGRADE_CAPABILITY_OK electron-44.4.3 mapping-outside-guarantee`。没有 BrowserWindow、computer-use 或生产 userData 验收。

## 两个独立真实反例

协调方忽略目录内探针 `.benchmarks/s1a-review-20261004/probe.ts`，SHA-256 `8DF82A9EFBDDFB0AADDEC60A653107F9D162CB061C87D8AD55BB36E8A378847A`，已由 git check-ignore 确认。不使用开发测试 helper；直接导入冻结真实 adapter 和实际独立 fixture target，所有文件来自自建 mkdtemp 根/nonce/固定字节。

首次探针因 Windows ESM 绝对导入未用 file URL 而在导入前失败：这是独立探针入口错误，无产品执行。修正为 file URL 后 `pnpm exec tsx .benchmarks/s1a-review-20261004/probe.ts` exit0，输出：

1. `proxy-input`：accepted=true、traps=14。plain() 在拒绝 Proxy 前使用 getPrototypeOf/ownKeys/getOwnPropertyDescriptor，随后属性读取执行调用者 traps；Proxy 被当作 plain data 获得真实文件 lease。违反本批严格捕获、不执行调用者访问逻辑的门。
2. `cleanup-signal`：fixedCode=null、sanitized=false、released=false。真实 AbortController.signal 上仅覆盖 removeEventListener 为抛错函数；acquired 阶段 onProgress 抛错。adapter catch 先调用该可覆盖方法，错误逃逸成为任意原文且跳过 api.close；自有 fixture 随后 write 占用失败，证明实际整组未即时释放。对应 adapter 第81行，closeState 与 FinalizationRegistry 同样使用动态 signal 方法，须一起收敛。不能以日后 GC/进程退出释放代替确定失败清理。

第二反例结束时未确认源能力即时关闭，探针按既定规则保留其自有临时根；随后探针进程已 exit0，未递归删除未知关闭状态的目录。无生产数据、外部代码、用户安全设置或其他进程操作。

## 修正派发与完成门

首稿不接受、不复制进 main、不提交实现。Sol 仅继续原 adapter、对应 test、原开发记录；必要的长期 signal/丢弃 wrapper GC 技术反例可以在原 smoke 内添加，其他原生/核心/UI/依赖/AGENTS 文件冻结。修正要求：

- 对 input/control/read 参数 Proxy 在任何 trap 前拒绝，真实复验要求零 traps；访问器/隐藏字段/额外字段拒绝与普通捕获语义保持。
- AbortSignal 的调用者可覆盖方法/属性不能干扰固定失败、监听解绑、原生 close 或 finalizer；可以安全拒绝不支持对象，或使用可靠的捕获/原生 intrinsic。必须记录实际接口选择及合理边界，不能仅对一个抛错字符串特殊处理。
- acquire/read/verify progress 原失败仍固定 `PROGRESS_FAILED`；失败后同根可立即再次取得普通写占用与新 lease，零依赖 GC。覆盖 signal getter/方法、Proxy control、正常 AbortSignal、close 幂等及长期 signal 不能保留丢弃 wrapper 的有界 GC 子进程。
- 保留正确 file symlink EPERM 失败和未验边界；普通回归/类型/Node/Electron及新反例重新冻结后由 root 独立复验。修复通过仍不代表整套安全门、原始包、恢复、VFS、生产保护或 GUI 完成。

AGENTS 新增0：输入捕获和失败清理已有规则覆盖；当前缺陷未修复，不把调查写成已验证经验。本记录只报告首稿审查和拒绝，开发后续交付另记。

## 2026-10-04 06:26：修正后独立复验，整体安全门仍未接受

原Sol回合01a103c7-32a5-7f31-a9f7-36ff72f11c61冻结完成，实际cursor26。四个修正文件实物hash：adapter `03B7A8F4C8BACF39F34E4A81F20EB9D8DB7713F5B1BFC6457035AD8FFF2FB1F9`，test `513E038777ACCA8C6B8E9974385ED5A880A54F2FD2948699F2F3049F9536CF21`，smoke `29271B1ED57C8D7529AE3BC5C7E1D005295FC3A34A8CD10D757B028E19B9437B`，记录 `05523299BD96A1828D603B8BD8DD376188D09E16DDB0BEF02FAB5C0A14155A79`。native/fixture/binding/build/ignore与首稿hash精确不变，未重新构建无变化native。

真实源码修正使用isProxy在反射前拒绝，错误读取own data descriptor；signal只接受当前realm/prototype且无own字符串覆盖或accessor的支持对象。预先覆盖signal拒绝，绑定后同名覆盖使用捕获intrinsic；失败保留固定错误、native close优先，detach/finalizer不动态调用signal方法。实际读查新增tests和两smoke模式，未替换历史失败记录。

本轮root实际复验：

- 原独立probe重跑exit0：Proxy accepted=false/traps=0；原预覆盖signal反例现在INVALID_INPUT、sanitized=true、released=true，自有根正常清理。严格拒绝是支持契约变化，不能称该signal仍受支持。
- 上一轮准备但未执行的独立`verify.ts`（hash `488A51604E77DBF3E95FAE828DFC6D472E84FD8C944B5A7F54073358E7E54F05`）本轮首次运行exit0，20个检查。直接真实adapter覆盖input/control/read Proxy零trap、revoked Proxy、绑定后signal方法/getter覆盖时acquired/read/verify progress固定失败、立即write重占用与新lease、普通取消、close幂等；自有根无需保留。不是开发helper或测试替身。
- 同一原targeted suite：exit1，41通过/1 file symlink EPERM失败/0 skip，683ms；graph noEmit exit0。两已复现缺陷门通过，整套安全门非绿色。
- 原Node smoke/queued GC/crash、新adapter、长期signal丢弃wrapper有界GC原模式：各exit0，原成功标记及新traps=0/shadows=0/listeners=0/writer=true标记均实际捕获。
- 独立`electron.cjs`（hash `A140FF48FB33D6115CD50A1EDABF09917922BBC5D0E9340A7D5E0381ED6C97C3`）直接启动真实Electron44.4.3原脚本`--run`与`--adapter`，各status0/signal=null/stderr为空且精确标记匹配；另一个Node应用require该脚本只有自身INERT_IMPORT_OK，入口无自动运行。每次30秒界限/windowsHide，无BrowserWindow/安全参数修改/GUI。

结论：两实质缺陷修正及上述技术部分独立通过；S1a整体仍因正确file symlink环境门未验而不接受，不复制或提交实现。原件零SQLite、容量/映射/驱动/断电/生产保护限制不变。AGENTS新增0，既有输入捕获和清理规则已覆盖，无需重复。下一步仅设计已形成的原始材料writer边界，先按新root计划审查两文档，未授权运行或实现S1b。
