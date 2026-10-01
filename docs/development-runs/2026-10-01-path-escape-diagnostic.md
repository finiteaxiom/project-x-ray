# 根目录路径竞态候选确定性诊断

日期：2026-10-01
任务：只复现并判断路径检查与打开之间的根目录逃逸，不实施产品修复。固定当前主 checkout；保留原有改动；未构建 GUI、提交或推送。

## 目标与边界

- 分别判断本地索引及 Git 工作区比较中，根外内容是否被发现、读取、交给分析器，以及是否进入持久化快照/报告。
- 仅使用系统临时目录中的隔离仓库、无敏感 TypeScript 哨兵和确定性目录联接；不读取或执行真实用户项目代码。
- 临时诊断测试在复现后删除；没有修改生产源码或保留会断言当前不安全行为的测试。

## 复现方式与结果

使用临时 `packages/application/src/path-escape-diagnostic.test.ts`，通过应用现有 `onProgress` 回调在首次 `reading` 前切换目录联接；Git 路径通过测试替身包装 `discoverProject`，在第二次发现已返回校验过的路径后切换联接，并用现有 `captureComparison` 的 `afterSidesCaptured` 测试钩子在前后指纹复核前恢复原目录。没有使用计时等待。

执行命令：

```text
pnpm --filter @project-xray/application exec vitest run src/path-escape-diagnostic.test.ts
```

结果：1 个临时测试文件、2 项诊断断言通过。这里的“通过”表示按设计复现了当前行为，不表示安全要求通过或缺陷已修复。测试文件随后删除，后续实现需要添加断言“根外哨兵从未被读取/分析/发布”的正式回归。

### 本地索引

- **发现：** 切换前 `discoverProject` 无失败并返回仓库内 `nested/escape.ts`；应用也进入该文件的 `reading` 阶段。
- **首次读取与分析：** 在 `reading` 通知后、按路径打开前将 `nested` 替换为指向仓库外临时目录的 junction。实际 `TypeScriptAnalyzer.analyzeProject` 收到的源文本包含仓库外哨兵，确认外部字节已被读取并交给分析器。分析阶段发生在一致性复读之前；读取到的路径字符串仍表现为相对 `nested/escape.ts`。
- **一致性复读：** 联接仍存在时，重发现不返回仓库外文件；索引没有为该文件发出 `verifying.currentFile` 读取进度。初始清单与复读结果不一致，应用以“索引期间项目发生变化，未发布快照”拒绝本次索引。
- **持久化：** 关闭并重新打开相同的临时 SQLite 库后，没有 current 项目/索引快照。因而现有复读门禁阻止了本次本地索引的快照发布，但不能阻止外部文本先进入分析器。

### Git 工作区捕获与报告

- **捕获：** 在 `captureComparison` 的工作区侧捕获中，`discoverProject` 已返回仓库内的路径后、`captureWorking` 按该路径读取前，将父目录换为指向仓库外临时目录的 junction。右侧比较快照的 TypeScript 分析输入包含外部哨兵。
- **前后身份检查：** 测试钩子在 sides 捕获后、后置工作区指纹计算前恢复原目录。比较前后的工作区指纹因此相同，捕获未重试或拒绝。
- **发布：** 完整 application 流程保存了变更报告及右侧快照；报告状态为 `current`，Git diff 文件列表为空，但读取该右侧快照相对原始工作区返回 `stale`，变更文件为 `nested/escape.ts`。这证明本次被捕获的外部内容进入了已保存的比较侧快照/报告引用，即使实际工作区在最终身份校验时已恢复。

## 根因判断

**根因确认，缺陷尚未修正。** 普通索引和 Git 工作区捕获都在路径字符串上完成发现时的 `realpath`/根包含性校验，之后才按该路径调用 `readFile`；两个阶段没有绑定到同一已验证文件对象。本地索引额外的逐文件一致性复读可以挡住这次快照发布，但发生得太晚，不能撤回已送入分析器的外部文本。Git 前后状态指纹只比较捕获前后可见的工作区状态；对照捕获 side 的内容与该身份，也不能挡住在中间短暂发生并恢复的 junction 替换。

代码依据：`packages/analyzer-core/src/index.ts:83,100-109`；`packages/application/src/index.ts:82-89,103-125,144-152,357-359`；`packages/git/src/index.ts:62-69,100-106`。

分类：已确认的产品安全缺陷，影响导入根目录边界。没有修改路径读取、Git 捕获、分析器版本或其他产品实现；修复范围仍待用户审阅/派发。

## 未验证项与限制

- 只验证本地索引与 `working` Git 比较模式；未验证 staged、last-commit、目录/文件符号链接的其他组合及 GUI 表现。
- junction 替换通过受控确定性测试接缝完成；没有以无同步点的概率竞态代替复现，也没有触碰真实工作区文件。
- 没有运行全量测试、类型检查、构建、Electron 或安装包。测试命令仅覆盖本临时文件；未运行导入样例代码或安装依赖。
- 现有本地一致性门禁在该复现场景下确实阻止索引快照发布；Git 报告路径没有对应拦截。任何后续安全修复都必须分别验证文件未被读取、未交分析器、未持久化，并覆盖普通索引和 Git 捕获。

## 工程经验评估

现有 AGENTS 目录发现经验只要求证明符号链接不逃逸；本次可控竞态确认，单独测试扫描时不跟随链接不足以验证后续打开边界。修订现有同类规则，要求在发现与打开之间替换符号链接/目录联接，并分别断言读取、分析器输入和快照/报告发布；见 [AGENTS.md](../../AGENTS.md) 中的目录发现条目。本条只增加验证动作，不表示产品已满足安全要求。

## 批准修复与验证闭环（2026-10-01）

### 实现

- 为 analyzer-core 增加小型 Node-API 原生句柄层；根目录由原生层打开并保持句柄，逐个源码文件以相对该根句柄的受限路径异步打开，再查询最终路径/对象身份并分块读取。Windows 使用 `NtCreateFile` 的 `RootDirectory` 参数解析相对文件名，以及 `GetFinalPathNameByHandleW` 的 NT 设备路径和 `FILE_ID_INFO`（卷序列号 + 128 位文件 ID）；POSIX 使用 `openat`、文件描述符路径查询及 `st_dev`/`st_ino`。每个读取块前后都复查最终路径包含性和文件 ID；无法取得句柄身份或路径时失败关闭。
- 普通索引首读、快照一致性复读、源码读取和 Git `working` 捕获共用该读取边界。首读越界会在分析器调用前中止；复读和 Git working 越界会在快照/比较侧及报告持久化前中止，越界读块不会返回给上层。staged 与 last-commit 仍读取 Git 对象，不改比较语义。
- 读取限制仍为每文件 2 MB，读块间检查取消；发现时的隐藏源码、秘密/硬忽略、超限规则及索引内容漂移门禁保持有效。没有执行导入源码，没有改分析器版本或 Graph IR。
- 因 native build 产物位于源树，新增 `.gitignore` 路径并由 desktop build 复制 `.node` 到 `apps/desktop/dist/native`；新增仅构建期依赖 `node-gyp`。Node 标准 FileHandle API 没有已打开句柄最终路径查询；Windows 试验还表明不能假设 Node 的数字 fd 可由另一个 addon CRT 的 `_get_osfhandle` 安全接收。

### 失败诊断与修正

- 首次 MSVC 编译失败：C++ 诊断文本中的中文字符无法由当前代码页 936 解析。改成 ASCII 原生错误文本后，Node-API 模块编译通过。
- 首版方案尝试把 Node `FileHandle.fd` 传入 addon 并调用 `_get_osfhandle`。Node 24.17 Windows 子进程在该调用处异常退出；该 fd/CRT 桥接不具备当前目标运行时的可验证性。未保留该路径，改为原生层独占 OS handle 生命周期，并在同一 OS handle 上完成最终路径检查、文件身份读取和异步分块读取。
- 首版“打开后重命名父目录”调度在 core 夹具中被 Windows 返回 `EPERM`，application 夹具也触发原有内容漂移拒绝；该调度不适合作为当前 Windows 的稳定 after-open 回归。改为在打开原文件句柄后，将外部哨兵文件移入原文件路径、读取并还原，再分别断言返回字节、分析器输入和快照发布。此替代夹具确定性通过，没有放宽断言。
- 补充根目录替换审查发现：即使根句柄已取得，若源码仍通过绝对路径打开，再以根句柄创建时缓存的路径前缀判定包含性，攻击者可改名根目录并在原名放入 junction；绝对路径会解析到替换目录。尝试省略根句柄的 `FILE_SHARE_DELETE` 未阻止 Node `fs.rename` 改名，不能作为安全边界。改为由同一根目录句柄解析源码相对路径，再对最终文件句柄做设备路径、根前缀和文件身份检查；新增确定性根目录改名并换入根外 junction 用例，分别断言读块数为零、分析器未调用及快照未保存。
- 最终文件 symlink 的 Windows 夹具调用 `fs.symlink` 返回 `EPERM`，当前宿主无法创建该叶子链接；测试在这一明确环境错误上标记 skipped，保留可在允许创建文件 symlink 的环境运行的断言。目录 junction 的 Windows 竞态回归已实际运行。最终文件 symlink 路径因此尚未在当前 Windows 宿主实测通过。

### 当前验证证据

- `node scripts/build-native.cjs`（`packages/analyzer-core`）：Node 24.17.0 / win32 x64 下 MSVC 编译成功；另用当前 Node 直接 smoke 原生 `createScope`、`openFile`、handle inspect 和 `readFileChunk`，返回 contained=true、稳定文件 ID 及读取字节数。
- `pnpm --filter @project-xray/analyzer-core test`：5 passed，1 skipped（仅最终文件 symlink fixture 的 `EPERM` 环境限制）。覆盖目录扫描、叶子 symlink 可运行路径、句柄打开后替换/恢复读回原内容。
- `pnpm --filter @project-xray/application test`：19 passed。竞态用例分别断言：子目录在发现后换成根外 junction 时读块数为 0、分析器未调用、快照未保存；整个项目根目录在发现后被改名并换入根外 junction 时也在读块前拒绝，分析器和快照未触发；文件句柄打开后路径短暂替换只把原句柄内容交给分析器并允许安全快照发布；Git working 根外 junction 攻击句柄读块数为 0，分析器/比较侧快照/报告保存均未发生。
- `pnpm --filter @project-xray/git test`：11 passed；覆盖 working、staged、last-commit 与既有内容漂移拒绝。
- analyzer-core、git、application、desktop 的定向 TypeScript 检查通过。
- `pnpm --filter @project-xray/desktop build` 成功；确认原生模块已复制到 desktop dist。没有启动 Electron、没有构建安装包或运行真实 GUI；这些由独立验收复跑。

### 范围与规则结论

- 产品路径竞态从“已确认缺陷”更新为“修复已实现并由定向回归支持，待独立审查复跑与真实 Electron 验收”。当前路径 API 只能把根目录句柄建立时实际打开的目录对象作为根；它不能证明文件选择器返回字符串到原生打开动作之间目录未被替换，除非调用边界能传递原生选择句柄。句柄建立后，文件相对该句柄打开，根路径改名/替换不会把替换目录内容交给分析器。当前结果没有覆盖最终文件 symlink 的 Windows 执行限制、安装包/asar 加载、Mac/Linux 原生编译或完整 V1 验收。
- 本轮修订既有目录发现规则，加入“必须相对持有的根目录句柄解析受限相对路径”的动作；同时保留针对 Windows 原生边界的经验：不能把 Node 数字 fd 的 CRT 转换视为跨 addon 稳定 API；若无法在目标 Node/Electron 上证明桥接，应由同一原生层持有、校验和读取句柄。这两点分别由根路径替换回归与本次可复现的 Node 24 进程退出支持，已写入 `AGENTS.md`。
- 没有提交、推送或合并；未覆盖现有用户改动。

## Node-API 异步句柄生命周期与 desktop 原生复制复验（2026-10-01）

### 目标与修改

- 处理独立审查发现的 pending native work 生命周期缺陷：`OpenWork` 和 `ReadWork` 原先只保存 `SecureScope*`/`SecureFile*` 裸指针，worker 排队时对应 `napi_external` 可被 GC finalizer 释放。
- `OpenWork` 为 scope external 建立强 `napi_ref`；`ReadWork` 为 scope 与 file external 都建立强引用。完成回调统一释放引用；准备 work、创建 work、入队失败均释放已创建引用并回滚 pending 计数/busy 状态。scope 计数追踪 pending opens/reads，冲突时 `closeScope` 返回 `ERR_SECURE_READ`，不关闭根 handle；`closeFile` 在 read busy 时维持拒绝。JS wrapper 在原生关闭成功后才记录 closed。
- `copy-secure-reader.cjs` 每次先调用现有 `build-native.cjs`，再复制 `.node`；原生构建入口用输入/产物 mtime 跳过不需要的编译，没有新增依赖。

### 失败诊断与验证

- 首次隔离 GC 测试失败的原因是测试夹具在四个 PBKDF2 worker 完成前没有给预期失败的 `openFile` Promise 附加 rejection handler，Node 把缺失文件错误报告为未处理 rejection。给队列 Promise 立即附加 noop catch，同时保留后续 `assert.rejects` 断言；这是测试夹具缺陷，不是产品失败，修正后独立子进程通过。
- `node scripts/build-native.cjs`：Node 24.17.0 / win32 x64 MSVC 编译通过。
- `pnpm --filter @project-xray/analyzer-core exec vitest run src/index.test.ts -t "隔离子进程覆盖 GC 排队打开/读取、关闭冲突及失败清理"`：1 项通过。子进程用 `--expose-gc`、`UV_THREADPOOL_SIZE=4` 和四个 PBKDF2 work 占用线程池，分别验证 queued open/read 在两轮 GC 后仍成功；pending open/read 时 scope 关闭及 pending read 时 file 关闭均被拒绝；缺失文件 open 失败与根外路径 read 失败完成后，scope/file 可正常关闭。子进程隔离避免 native 崩溃带走 Vitest。
- `pnpm --filter @project-xray/analyzer-core test`：6 passed，1 skipped（最终文件 symlink fixture 在该宿主返回 `EPERM`）；`pnpm --filter @project-xray/analyzer-core typecheck` 通过。
- 为验证 desktop 直接构建捕获 native 源变化，先在 `secure_reader.cc` 更新线程约束注释，使其 mtime 晚于 core `.node`。第一次执行 `pnpm --filter @project-xray/desktop build` 时，tsup 在清理输出目录阶段以 `EPERM` 无法 unlink 已加载的 `dist/native/secure_reader.node`，在复制脚本之前失败；检查时 Project X-Ray Electron 进程仍运行，没有终止进程。审查方随后停止了其 Electron 实例；再次直接运行同一 build 命令后，tsup、`build-native.cjs` 重编译及 `copy-secure-reader.cjs` 均成功。core 与 desktop 的 `.node` SHA-256 均为 `3A2F24F3A5A66FDD82CAE24D8261AF844BD86036F820DB6E0E9B4AD6C7D15E19`，desktop `main.js` 也重新生成。
- 本批开发侧验证没有启动或重启 Electron、重跑独立 UI 导航验收、运行安装包、提交、推送或合并；该部分当时交由独立验收，后续结果见下文。独立审查中的路径竞态 core/application/Git 既有结果仍是上一批次证据，本批只重跑 analyzer-core 与类型检查以及 desktop bundle 构建。

### 规则评估

- 本次确认 N-API worker 对 external 裸指针的持有和显式关闭有独立生命周期要求，影响文件句柄安全且可转化为具体动作；已在 `AGENTS.md` 增加强引用、pending 关闭保护、全路径清理和隔离 GC 回归规则。
- 后续独立验收已在真实 Electron 中确认：原生模块缺失时安全拒绝索引，恢复模块后安全重试、重索引与源码导航成功。结合本批 desktop 直接构建成功及前述 core/desktop `.node` SHA-256 一致，desktop 原生模块复制复验已完成；最终文件 symlink、其他操作系统及安装包仍未验证。

## 错误摘要与 SnapshotState 诊断（2026-10-01）

### 目标与边界

- 只诊断错误文本进入快照健康数据/worker IPC 的路径，以及原生安全读取模块加载失败如何被 `getSnapshotState` 和 UI 表示；不修改生产代码，不启动或重启 Electron，不运行安装包或重型构建。
- 临时隔离夹具由本记录引用的诊断脚本完成，已在诊断后删除；没有执行导入项目中的代码。独立审查已提供真实 Electron 的原生模块缺失拒绝与恢复重试结果，本次未重复 GUI 验收。

### 诊断闭环与证据

- 临时夹具第一次启动失败：脚本在父进程没有 `--child` 参数时把 `node.exe` 路径误当成临时目录，触发 `ENOTDIR`。根因是诊断夹具参数解析错误，未触及应用代码；修正为按分支读取参数后，同一命令通过。脚本已删除，没有留下产品测试或源码改动。
- 命令：`node --import tsx packages/application/src/path-diagnostic.tmp.ts`。隔离 fixture 令 `TypeScriptAnalyzer.analyzeProject` 抛出包含合成绝对路径与源码片段标记的异常。`safeError` 仅压平换行并截断，标记和路径仍在 `snapshot.health.failedFiles[].reason`；重开 SQLite 后 `getCurrentProject().health` 仍含该值。把概览放入 `completed` worker event 后，`indexTaskEventSchema`、`workerResponseSchema` 和结构化克隆均保留该字符串。`GraphStore.saveSnapshot` 同时序列化完整快照和 `snapshot_overviews` 概览，因此这是已确认的本地 SQLite 持久化，不是推测。
- IPC 路径也由当前代码确认：analysis worker 的 `send()` 只做 `workerResponseSchema.parse`；索引完成事件携带 `overview.health`，desktop broker 校验后发给 renderer，preload 再按 `indexTaskEventSchema` 校验。`getCurrentProject` IPC 同样把概览通过 `projectOverviewSchema` 返回。夹具验证了同一传输契约和 structured-clone 行为，但没有启动实际 desktop Worker 或 Electron。
- UI 当前保存收到的概览，但生产 UI 没有读取或渲染 `health.failedFiles[].reason`；概览只显示索引状态、文件数量、忽略规则和限制。定向日志搜索没有发现把该健康字段写入日志的代码；搜索到的 `console.error` 是窗口加载失败描述，与健康错误无关。由此确认了本次健康字段的本地持久化和 IPC 暴露，未确认日志落盘或用户可见错误片段。
- 另一个原生加载隔离子进程保持 fixture 源文件不变，并让 `PROJECT_XRAY_SECURE_READER_PATH` 指向临时无效 `.node` 文件。原生加载明确失败，但 `getSnapshotState` 返回 `status=missing`、`snapshotAvailability=available`、`missingFiles=["<项目根目录不可访问>"]`、`configurationChanged=true`，新增/修改/删除计数均为 0。fixture 源文本前后相同。临时 addon 和全部 fixture 在结束时删除。

### 根因与最小修复建议（本轮未实施）

- 隐私边界：`packages/analyzer-core/src/index.ts` 的发现失败直接保存 `error.message`；应用层 `safeError` 和 `apps/desktop/src/analysis-worker.ts` 的 `sanitize` 只压平/截断。应用将发现失败并入快照健康字段，GraphStore 持久化它，worker IPC 契约也接受并转发它。最小修复是在持久化和跨进程边界统一映射到安全错误类别/代码，并单独保留仓库相对 `filePath`；禁止把原始 `message`、绝对路径或源码片段写入健康摘要或错误 IPC。修复时需分别覆盖 Windows/POSIX 路径和合成源码片段。
- 状态误报：`getSnapshotState` 的整个 `discoverAndRead` 异常目前都被空 `catch` 折叠为 `missing`，同时错误地把 `snapshotAvailability` 设为 `available` 并把配置标为已变化。UI 对所有非 `current` 状态都显示“工作区已变化”和差异计数，忽略 `missingFiles`。最小建议是在 `SnapshotState.status` 增加 `unavailable`，原生读取器/根目录无法完成校验时返回该状态；快照仍可标记为 available。UI 对 `unavailable` 显示“无法校验当前工作区”，不展示零差异计数。现有 `status !== "current"` 所有权、评分和解释门禁保持 fail-closed，无需削弱。
- 相关源码：`packages/application/src/index.ts`（`getSnapshotState`、`safeError`、健康组装和 `discoverAndRead`）；`packages/analyzer-core/src/index.ts`（发现失败）；`packages/graph/src/index.ts`（SQLite 序列化）；`apps/desktop/src/analysis-worker.ts`、`apps/desktop/src/main.ts`（worker/IPC）；`apps/ui/src/App.tsx`（stale banner 与 fail-closed 会话标记）；`packages/contracts/src/index.ts`（`SnapshotState` 与 IPC schema）。

### 规则评估

- 本轮无 AGENTS.md 新增或修订：诊断确认了错误摘要暴露与状态分类缺陷，但修复和跨平台验证尚未执行；当前证据不足以形成已验证的预防动作。按用户要求等待单独实施派发。
- 本轮只更正本记录中 desktop 复制仍待重跑的过期表述；生产代码、契约、测试、Electron 状态和其他工作区改动均未改动。
