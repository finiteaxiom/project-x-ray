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
