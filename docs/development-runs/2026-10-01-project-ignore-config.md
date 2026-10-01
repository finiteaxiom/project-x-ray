# 项目级本地排除配置

## 授权、基线与范围

本批由协调审查方批准实现，操作系统仅 Windows。起点为共同基线 `71dad1b8663925c8c3daf79205e4fc67ce23adf6`，分支 `codex/project-ignore-config`，实施前工作区干净。更早复制的 55 文件差异已包含在共同基线中，不属于本批成果。

范围为项目本地设置、受限排除规则、普通索引/Git 一致应用、配置身份与失效、SQLite 迁移、worker/IPC 与 Overview 保存/重新索引流程。不增加依赖、远程 LLM、增量索引或其他操作系统验收；未修改根/desktop package.json、锁文件或包装脚本，未提交、推送或合并。

## 实现

- 契约定义 `IGNORE_POLICY_VERSION=1.0.0`，后台协议升级到 `1.2.0`。规则最多 100 条，每条 256 字符；仅根相对路径、单段 `*`/`?` 与独立段 `**`。拒绝根外路径、盘符/UNC、反斜杠、否定重包含及扩展 glob。目录尾斜杠转为 `/**`；大小写、空白、重复和顺序规范化后生成稳定规则身份。匹配在 Windows 不区分大小写；普通段从根锚定。
- analyzer-core 使用同一纯规则匹配器。默认安全规则不可关闭，秘密文件优先分类。普通发现、Git 工作区/index/commit 在读取正文前分类；跨排除边界的重命名整项保守排除，避免读取被排除侧 patch。完整默认规则和自定义规则进入健康信息。
- SQLite 迁移 8 创建项目设置表，缺少记录表示默认规则；保存使用预期修订号。相同规范化配置不递增修订、不清空题目。损坏或未来版本配置失败关闭，不覆盖历史 payload。
- 新快照保存规则身份；普通与比较侧配置哈希均组合清单指纹与规则身份。三个 Git 模式的捕获身份也包含规则哈希。无匹配的规则变化仍使旧快照/解释/题目/报告过期。旧快照缺少规则字段时按旧默认规则兼容，新增自定义规则后过期；历史来源与题目不回写。
- 索引和比较固定起始配置，发布事务核验修订。Broker 拒绝活动索引/比较期间的设置保存，并拒绝保存 RPC 期间新启动任务；用户获得可重试提示。设置 CAS 防止两个客户端覆盖。
- 损坏设置返回 `unavailable` 和固定安全说明；App 校验异常也不得保留旧 `current`。编辑器停止编辑，历史快照源码仍可读；被当前规则排除的历史路径不再为工作区 hash 读取实时正文。
- 评分捕获起始修订，在配置数据库 immediate 事务内检查后再写 attempt，兼容历史源码位于另一数据库的情况。解释和出题在 await 当前性检查之后再次核验规则身份。
- Overview 提供默认规则、已保存规则和快照采用规则、逐行编辑、保存、保存并重新索引、失败刷新。保存后刷新过期状态；重索引沿用既有进度/取消/失败/重试。组件用代次和项目身份拒绝迟到响应，IPC 仅发送快照引用。

## 实际反馈闭环

### 已确认产品缺陷：评分校验到持久化窗口

审查方预审指出初版评分在 await 校验后仍可能无修订约束写入。实际回归使用两个 GraphStore 连接：第一连接已通过当前性校验，在读取答题引用时第二连接保存无匹配规则，然后第一连接尝试持久化旧评分。

为核验根因，临时重放未保护的 `saveOwnershipAttempt` 调用，执行：

`pnpm --filter @project-xray/application exec vitest run src/ignore-settings.test.ts -t '第二连接'`

实际退出 1：期望拒绝的 Promise 返回旧评分。重放结束通过 finally 恢复源文件。修正为配置数据库 immediate 事务和修订核验后，同一回归通过，并断言没有写入 attempt。此问题为本批初版产品缺陷，根因已确认，不是测试超时或环境问题。

### 已确认产品缺陷：损坏设置保留旧 UI 当前状态

初版 `getSnapshotState` 在 try 外读取设置，损坏配置直接抛出；App 的刷新 catch 不更新状态，可保留上一轮 current。审查方指出后按控制流确认，修正为固定说明的 unavailable，并在 App 后续校验异常时关闭当前操作。应用回归覆盖损坏数据库与历史源码仍可读；App 回归覆盖先 current、后异常、出现 unavailable 并禁用搜索；编辑器回归覆盖已加载后配置不可校验即停止保存。

### 测试夹具缺陷

新增应用测试第一次类型检查发现 SQLite 类型导入不在 application 包范围、结构化提交缺少必需字段；评分竞争测试第一次运行在版本门禁处返回“答案与题目版本不匹配”。修正测试为 Node createRequire 的受限结构类型、引用题目实际版本和完整提交格式，没有改变产品门禁或放宽断言。随后类型检查与回归通过。

另外在冻结前检查发现完整 Overview 对象会违反新增严格 get-settings IPC 输入；组件改为只发送 repositoryId/snapshotId，并加入完整 Overview 输入回归。此项在交付前静态发现，没有把未执行 GUI 记为成功。

## 实际验证命令与结果

- `pnpm install --frozen-lockfile`：成功，锁文件未变。
- `pnpm --filter @project-xray/analyzer-core build:native`：审查方协调的定向原生构建成功。
- `pnpm --filter @project-xray/contracts exec vitest run src/ignore-settings.test.ts src/index.test.ts`：13 通过。
- `pnpm --filter @project-xray/analyzer-core exec vitest run src/ignore-policy.test.ts src/index.test.ts`：24 通过，1 既有 Windows 叶子 symlink 权限用例跳过；没有更改系统安全设置。
- `pnpm --filter @project-xray/graph exec vitest run src/ignore-settings.test.ts src/index.test.ts`：13 通过。
- `pnpm --filter @project-xray/git exec vitest run src/index.test.ts`：11 通过。
- `pnpm --filter @project-xray/application exec vitest run src/ignore-settings.test.ts src/index.test.ts`：35 通过。
- `pnpm --filter @project-xray/ui exec vitest run src/components/IgnoreSettingsEditor.test.tsx src/App.test.tsx`：36 通过。
- `pnpm --filter @project-xray/desktop exec vitest run src/ignore-settings.worker.test.ts`：1 通过。使用实际构建 worker，覆盖默认读取、非法输入拒绝、保存、旧快照过期和重新索引恢复；这不是 GUI 或 Electron 运行时验收。
- `pnpm exec tsc -p <包目录>/tsconfig.json --noEmit`：contracts、analyzer-core、graph、git、application、ui、desktop 均实际通过；新增 desktop 测试后再次通过 desktop tsc。
- 经审查方批准资源窗口执行 `pnpm build`：10/10 成功，0 缓存；Monaco 大块提示保留，没有修改阈值。
- `git diff --check`：通过；Git 提示既有 CRLF 转换配置不影响检查结果。

本线程当前最终定向统计为 133 通过、1 跳过。此统计不能扩张为全量测试、真实性能或 GUI 完成结论。

## 稳定范围与未验证项

业务冻结范围：core/contracts/graph/application/git 的入口与 core 规则模块；desktop main/worker/preload；UI App/main/规则编辑组件。新增对应测试，后续仅补专属记录和经验，不修改业务或重新构建。构建产物和 native 已告知审查方可锁定使用。

未执行本批真实 Electron GUI、portable、其他 OS、完整六能力验收；没有执行导入项目代码或样例依赖安装。实际 GUI 验收由协调审查方独立完成，后续结果不由本记录预先认定。

## 审查方 Windows GUI 验收步骤

使用本 worktree 最后构建的真实 Electron 和隔离 userData，可设置 XRAY_E2E=1 使用现有测试项目路径入口；无需开发服务器。导入审查方自己的确定性 Git 夹具：普通/隐藏源码、自定义待排除目录、默认安全目录和测试秘密文件。

1. Overview 查看默认、已保存及快照采用规则；非法 `../outside` 或 `!**/.env` 应拒绝且不保存。
2. 创建并展示旧解释/训练；保存不命中的 `never/`，即使文件数未变也出现配置变化过期提示，解释和答题不可继续。
3. 保存等价规则（目录写法/递归写法、重复、大小写和顺序）不额外失效或递增修订。
4. “保存并重新索引”排除实际目录，验证新快照与检索结果、默认安全排除及隐藏源码；取消/失败仍保留设置和旧过期快照，更新索引可重试。
5. 工作区/index/最近提交比较两侧都应用规则；保存不命中规则后旧报告过期。跨排除边界重命名不得展示被排除正文 patch。
6. 重启同一 userData，保存配置仍在；删除自定义规则并重索引恢复允许文件。切换项目或页面不混入迟到配置响应。
7. 索引或比较运行时保存返回可重试提示；结束后可保存。隔离 DB 中损坏设置时编辑停止、快照不可校验，历史源码仍可复核，不保留伪 current。

## 工程经验判断

新增 1 条：持久化当前性检查必须约束校验到事务提交的修订窗口，配置不可校验不能沿用旧 current。依据为上述双连接竞争复现、损坏配置控制流和对应回归；适用于后续可改变证据范围的项目设置。该条细化现有事务/过期规则，未降低证据或测试要求；其他实现细节和当前数字只留在此记录。
