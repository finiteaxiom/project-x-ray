# V1 开发状态

更新日期：2026-10-01

## 原生异步句柄生命周期与 desktop 复制更新（2026-10-01）

- `OpenWork`/`ReadWork` 现为所有 worker 使用的 `napi_external` 持有强 `napi_ref`；pending open/read 期间拒绝关闭根 scope，pending read 期间拒绝关闭文件句柄。完成及排队失败路径回收引用、pending 计数和 busy 状态；JS scope 只有在原生关闭成功后才标记为 closed。
- core 隔离子进程用 `--expose-gc` 和四个 PBKDF2 worker 排队后强制 GC，覆盖 open/read 完成、关闭冲突、缺失文件 open 失败与读期间路径逃逸的失败清理。`pnpm --filter @project-xray/analyzer-core test` 当前 6 项通过、1 项因最终文件 symlink 的 `EPERM` 跳过；core typecheck 通过。
- desktop 的原生模块复制脚本现每次先运行 `analyzer-core/scripts/build-native.cjs`，再复制构建产物；该入口按 native 源与 `.node` 的 mtime 决定是否重编译。第一次直接 desktop build 被仍运行的 Electron 实例阻挡，tsup 清理输出时遇到 `EPERM`；审查方停止其 Electron 实例后，在 native 源晚于 core `.node` 的状态下重跑成功，原生模块重新编译并复制，desktop/core 两份 `.node` 的 SHA-256 一致。本批没有重启 Electron，也没有重跑源码导航验收。
- 详细证据、首次测试夹具的未处理 rejection 修正和构建限制见[原生生命周期记录](development-runs/2026-10-01-path-escape-diagnostic.md)。

## 当前安全诊断：项目根目录路径竞态（2026-10-01）

- 隔离的确定性 Windows junction 复现确认：本地索引会在一致性复读时拒绝发布快照，但根外内容此前已进入 TypeScript 分析器；Git 工作区捕获可在目录于捕获后恢复时通过前后身份校验，并保存包含根外内容的右侧快照/`current` 报告。
- **修复已实现，独立审查与真实 Electron 验收待复跑。** Windows Node-API 原生句柄层从持有的项目根句柄解析源码相对路径，在同一 OS 文件句柄上查询最终路径与文件身份并异步分块读取；普通索引首读/复读及 Git `working` 共用该边界。定向 application 19 项、Git 11 项回归通过；core 5 项通过，最终文件 symlink 夹具因本机 `fs.symlink` 返回 `EPERM` 跳过。四个相关包类型检查及 desktop bundle 构建通过；没有启动 Electron 或构建安装包。根因、修复、失败诊断与当前限制见[路径竞态记录](development-runs/2026-10-01-path-escape-diagnostic.md)。

## 已有源码打开时调用流导航修复（2026-09-30）

- 独立真实 Electron 验收发现：先打开 Python `context.py:12`，再在调用流搜索 TS `outerA` 并点击 CALLS，边选择更新但源码仍留在 Python；节点列表选 `helper` 也无变化。关闭源码后重试同一关系立即显示 `src/nested.ts:3:9`，说明关系证据本身可导航。[验收记录](development-runs/2026-09-30-independent-review.md)
- App 控制器回归复现确认根因：显式导航先清空 `source`，这使页面恢复回调改变并重新运行；恢复逻辑用旧 Python 保存位置启动新读取，递增的请求序号让待处理的 TS 证据请求失效，TS `readSource` 因而没有发出。现在恢复回调从 ref 读取最新源码，但不订阅 `source` 变化；恢复仅随页面/项目上下文变化，跳过逻辑比对仓库、快照、文件、完整范围和证据 ID。项目/快照、页面代次和请求序号校验保持不变。
- App 真实控制器用例覆盖已有 Python 源码时的 TS 跨文件边导航、`helper` 节点导航及 `nested.ts` 内两段范围更新。修复后 `readSource` 分别使用所选 TS 文件/范围，并且 viewer 的文件和 Monaco 选区随操作改变。
- 本轮验证：目标回归修复前失败，调用记录显示只有两次 `src/context.py:12:4` 读取、没有 TS 读取；修复后目标回归 1 项通过。`pnpm --filter @project-xray/ui test`（11 文件、82 项通过）、`pnpm typecheck`（10/10）、`pnpm build`（10/10）和 `git diff --check` 均通过。构建仍报告主 UI 与 Monaco 代码块超过 500 kB。
- 按首批范围的独立真实 Electron 验收已通过：Python → TS CALLS、两组 `helper` 节点、同文件范围更新和跨页恢复均已实操（见[独立验收记录](development-runs/2026-09-30-independent-review.md)）。版本为工作区 `0.1.0`；安装包与发布验收仍未执行。详细失败和修复记录见[开发记录](development-runs/2026-09-30-source-navigation-restore-race.md)。

## V1 可信索引与源码导航修复（2026-09-30）

- TypeScript 嵌套同名声明现在把词法所有者纳入限定名和稳定节点身份；Python 绑定收集补齐控制流中的 `for`/`except`/上下文管理器目标与推导式局部作用域，装饰器重绑定的调用保守保留为 `unknown`。对应分析器版本为 TypeScript `+xray.3` 和 Python `2.1.1`，没有执行被导入项目。
- 目录发现现在纳入普通隐藏源码目录，同时保留秘密文件、构建/供应商目录排除和不跟随符号链接的限制。普通索引与 Git 比较侧均用实际内容末行生成完整文件范围。
- 文件节点通过 Graph IR `1.3.0` 的 `evidenceId` 指向其 `verified` 文件证据；架构页把该 ID 传入源码读取，所以空文件的唯一 `1:0–1:0` 范围也能在证据校验下打开。零宽文件范围仍不能用作所有权引用；旧快照需要重新索引才能带上新节点链接。
- 为 Windows 全仓 Git 子进程测试的并行负载将根 `pnpm test` 设为 Turbo 并发 2；没有放宽测试超时或移除断言。构建仍会提示 UI 与 Monaco 代码块超过 500 kB。
- 本轮历史验证仍为：`pnpm test --force`（18/18 Turbo 任务成功，150 项测试通过；桌面 Vitest 没有测试文件）、`pnpm typecheck`（10/10）、`pnpm build`（10/10）、`pnpm --filter @project-xray/desktop test:e2e:file-source`（真实 Electron/IPC/Monaco 单行、多行、空文件通过；隐藏源码可检索，秘密、构建和依赖文件未索引）、`git diff --check`。首批按范围独立验收通过（见[独立验收记录](development-runs/2026-09-30-independent-review.md)）；150 项为原开发记录数量，没有改写。安装包验收和完整六功能视觉验收仍未运行。过程与失败诊断见[开发记录](development-runs/2026-09-30-v1-correctness.md)。

## Python 上下文管理器作用域回归修复（2026-09-30）

- `scope_statements` 将同步/异步上下文管理器与带 `orelse` 的 `if`/循环分支分开遍历，继续收集 `with ... as` 和 `async with ... as` 的局部绑定。嵌套控制流可完整扫描，目标变量调用保持 `unknown`，未遮蔽的模块函数调用仍为 `verified`。
- Python analyzer 升为 `2.1.1`，worker 协议仍为 `2.1.0`：修复改变失败文件能否提供事实，分析器版本纳入快照身份以使旧失败快照需要重索引；IPC/worker 响应形状没有变化。
- 复验通过：`pnpm --filter @project-xray/analyzer-python test`（16/16）、`pnpm --filter @project-xray/application test`（15/15）、`pnpm typecheck` 和 `pnpm build`（均 10/10）；生产构建已复制修复后的 Python worker。Python with/async with 的遮蔽、`unknown` 关系及源码定位按当前任务范围独立验收通过（见[独立验收记录](development-runs/2026-09-30-independent-review.md)）；未运行安装包验收。详细失败与复验记录见 [上下文管理器开发记录](development-runs/2026-09-30-python-with-scope-regression.md)。

## CSS 职责归属与级联整理（2026-09-26）

- 当前唯一入口是 `apps/ui/src/main.tsx` → `apps/ui/src/styles.css`，导入顺序为 tokens、base、controls、layout、components、pages、responsive。旧 `design-system.css` 已移除，避免两套完整基础控件规则依赖导入顺序互相覆盖。
- 规则归属：原生按钮、表单、通用 focus/disabled 放 `controls.css`；应用外壳、导航、共享分栏和拖动区域放 `layout.css`；共享状态提示、面板、图表/源码表面放 `components.css`；架构、调用流、解释、训练和 Git 专有内容按页面分段放 `pages.css`；所有窗口媒体查询、容器查询和 reduced-motion 规则放 `responsive.css`。Monaco 与 Cytoscape 继续用各自运行时主题。
- 级联审计清理了 202 条已被同选择器后值覆盖或失效的声明。按选择器、属性及相同媒体/容器条件复核后，重复声明组为 0；保留的是状态、控件变体及断点下实际需要的布局覆盖。没有引入 `@layer`。原来被后加载基础规则遮住的 max-width 1180px 页面内边距属于无效旧规则，已删除；基础 20px 24px 和 max-width 900px 的 12px 紧凑内边距保持不变。
- 颜色 token 共 56 个，全部被样式引用；用途包含控件/列表/架构边界、可选行和卡片表面、错误与警示状态、证据范围标记和焦点光晕。PostCSS 审计确认 token 文件以外没有重复颜色字面值。单次渐变停止色、半透明证据底色及一次性图形状态仍按局部语义保留；同一字面值如果表示不同状态，不强制共用。CSS token 不传入 Cytoscape/Monaco API。两处 `!important` 只保留在 reduced-motion 的 `transition: none` 与 `animation: none`，用于覆盖应用和嵌入控件动效。
- 窗口断点在 `responsive.css` 依布局分组维护：1500、1250、1180、1100、900、800、740、620 CSS px；架构阶段容器 740px 与符号浏览器容器 650px 的局部排布使用容器查询。前者负责窗口级壳体/页面布局，后者负责局部图和面板；源码分栏用户偏好仍由现有工作会话管理，窄容器适配不会写回偏好。
- 基线和最终截图使用相同临时 fixture、Electron 操作状态及 DPR 1.5，记录 1440×900 外壳/架构/训练/解释、1024×800 Git 报告与双侧源码、1920×1080 架构源码分栏。基线在 `docs/screenshots/css-maintenance-baseline/`，最终图在 `docs/screenshots/css-maintenance-final/`。关键配对已实际查看；页面几何与主要控件保持一致。不同像素主要来自临时快照/报告 ID 和 Cytoscape 自动布局坐标。首次检查发现 Git 内容区相对基线多出 8 CSS px 内边距，定位为旧 max-width 1180px 规则迁移后才生效；移除无效规则后复采，边缘与基线对齐。125% 缩放通过 DOM/交互审计，但 Windows Electron 截图裁切，因此不作为完整图片目视验收通过。
- 本轮实际运行 `pnpm --filter @project-xray/ui test`（11 个文件、79 项通过）、`pnpm typecheck`（10/10 包通过）、`pnpm build`（10/10 包通过）、`pnpm --filter @project-xray/desktop test:design`（73 个场景、0 个失败/错误）、`node --check apps/desktop/scripts/ownership-training-e2e.cjs` 和无视口切换参数的 `pnpm --filter @project-xray/desktop test:e2e:workspace`（最后一次使用 Electron、真实源码和临时 Git 仓库通过）。此前完整 `test:e2e:workspace final` 截图采集已通过并生成对照图；随后仅把字面颜色替换为同值 token。最终 token 版复跑设计审计和普通 Electron 工作流均通过。复跑截图模式时，当前显示工作区为 1707×1067 CSS px（DPR 1.5）：1920px 视口能渲染，但回缩时 OS 曾将窗口保持在显示边界，精确 viewport 断言失败；加入 `unmaximize` 和原点复位后，下一次采集在 Git 左侧源码截图阶段触发 Playwright 30 秒截图超时。该截图模式的 token 版复跑未通过，不作为成功验证；没有降低尺寸或截图断言。截图目录中的对照图来自先前成功的完整采集，最后的变量替换保留了完全相同的 RGB 值；之后的 token 版真实截图/状态由 73 场景设计审计复采。
- 目视复核记录了一个与基线相同的现存长内容布局：1440×900、训练引用列表较长时，E2E computed style 中 `.evidence-workspace` 约 1560 CSS px 高、源码面板约 1522 CSS px 高，内容需要纵向滚动；本维护重构未改变该视觉，也未做训练布局重设计。DPR 1.5 下 125% 页面缩放的 Electron 图片仍裁切，只能确认 DOM/交互审计；Cytoscape 自动布局的少量节点坐标变化和既有构建体积提示也属已记录限制。本轮没有改变业务逻辑、证据/置信语义或会话与任务生命周期，也没有引入依赖。

## 同一快照重新激活与调用流恢复（2026-09-26）

- 根因位于共享页面会话层：页面记录按 `repositoryId + snapshotId + page` 缓存；`markWorkspaceStale` 会使旧代次失效，但原 `activateWorkspaceSnapshot` 只归档其他快照，没有恢复同一快照下 stale/archived 的页面记录。因而源码恢复到快照 A 后，后端可能报告 A current，Flow 记录仍 stale，搜索和图查询门禁继续关闭。
- 当前只在索引任务成功后读取 `getSnapshotState`，并校验任务/项目/后端响应的仓库与快照一致、状态为 `current` 且源码可用，才安装项目并激活页面会话。源码恢复后普通状态轮询即使先报告 current，也不会自行解锁旧会话；索引失败、取消、校验失败或身份不匹配都不会激活。
- App 为每次后端确认的索引激活分配单调代次；即使 `repositoryId + snapshotId` 与之前相同，App 项目会话代次仍前进，旧快照状态检查不能覆盖新结果。会话控制器只接受比已处理代次更新的激活；重复和迟到通知幂等忽略。目标页面记录进入新的请求代次，旧请求的成功、失败及 `finally` 均失去回写资格。恢复保留同快照的输入、选择与身份匹配的完成结果，清除旧代次 pending、请求错误和临时 loading；身份不匹配的缓存结果会清除。工作区过期确认也会为尚未打开的架构、调用流与解释页建立 stale 记录，避免后续首次挂载默认解锁。
- 索引完成时替换查询 Worker 的旧 Worker 会收到预期的非零退出码。旧 `exit` 监听器原先会清空共享 pending 表，误伤新 Worker 上刚发起的快照校验。现在故障回收仅作用于当前 Worker；这是完成可信激活检查所需的最小主进程修复，没有变更 IPC 契约。
- 训练仍由独立所有权会话与后端评分/掌握度契约管理，普通架构、调用流和解释页激活不会恢复训练请求、重复评分或改变结果；Git 比较报告仍按 reportId 及实际左右比较基准独立判断。准确回到同一个不可变快照时，既有该快照掌握记录仍依照既有后端规则显示；切到 B 时旧 A 掌握记录显示“需要重新验证”。应用重启后的页面草稿和后台任务恢复仍未实现。
- 本轮 Electron 验证使用脚本生成的临时 fixture 副本，没有修改用户项目。真实 snapshotId 为 A=`a35668e297c36d231e8d63b1`、B=`0f76d2e41d7d1cbd808e4851`；第一次还原并索引仍为 A，随后 A→B→A 最终再次得到 A。Electron 中实际完成了过期检测、还原、重索引、Flow 搜索和图查询；B 使用 `normalize` 查询，返回 A 后恢复 `login` 草稿/结果并再次查询成功。B 的旧训练掌握记录显示需要重新验证；回到内容完全相同的 A 后，该快照记录按原契约仍显示已通过。
- 本轮验证：`pnpm --filter @project-xray/ui test`（11 个文件、79 项通过）；`pnpm typecheck`（10 个包通过）；`pnpm build`（10 个包通过，Vite 保留既有大 chunk 提示）；`node --check apps/desktop/scripts/ownership-training-e2e.cjs` 通过；`pnpm --filter @project-xray/desktop test:e2e:workspace` 使用 Electron、preload、IPC、Worker、SQLite、样例临时副本实际通过。首次 E2E 暴露旧 Worker 退出事件误清空新请求，已修复；随后一次脚本尝试在索引完成前仅凭文件状态 current 就返回，发现是 E2E 等待条件过早，已改为等待索引进度出现并结束后再检查完整快照 ID，最终端到端通过。Playwright 启动仍输出 Node `DEP0190` 提示。

## Git 比较生命周期与工作区页面会话（第三批，2026-09-26）

- 本批沿用第二批的 `OwnershipSessionController`，扩展为页面会话与 Git 任务控制器；没有增加平行 store。页面会话按 `repositoryId + snapshotId + page` 隔离，页面仍按需卸载。比较任务按仓库独立保存捕获的项目/模式/参数、启动请求身份、后端 `taskId`、进度、取消请求、终态、错误和报告。App 级事件订阅在页面卸载期间继续接收事件。
- Git 比较每个仓库同一时刻只允许一个活动任务。页面卸载不取消；导航中的任务条显示所属项目和实际模式，可返回任务或明确取消。启动窗口内收到的事件会短暂缓冲，取消请求等到 `taskId` 返回后发送；“正在取消”只在后端取消或完成终态到达后收口。重试使用新请求身份，旧 `taskId`、重复终态及其他仓库事件不会改写当前任务。该生命周期只覆盖当前应用进程，不保证进程退出/应用重启后继续。
- 比较控件草稿、活动任务捕获参数和已安装报告分开保存。报告标签以报告实际模式、左右快照/提交和父提交数据为准；模式为 working（Index → 工作区）、staged（HEAD → Index）或 last-commit（父提交 → HEAD）。报告状态通过后端 `getChangeReportState` 复核，不凭当前 `snapshotId` 推断。工作区比较失效后，旧报告及其两侧源码仍可查看并标记为历史基准；安全重算安装新报告。左右源码响应仍分别验证报告、比较侧快照和文件身份。
- 架构页保存层级、搜索/分页、选中模块/文件/符号/关系、局部图查询、图视角及滚动；调用流保存草稿与实际提交查询、结果、选中项和图视角；功能解释保存草稿与实际提交问题、解释状态/结果、选中步骤/证据。三页以及训练页、Git 页分别保存源码位置和面板状态；源码正文仍按需读取，不放入会话。视角恢复不把 Cytoscape/DOM 实例持久化；容器变化可重新校正显示。
- 快照变化会隔离证据页面状态并使旧请求失效；工作区过期保留已显示结果并标记限制，遵守既有查询/评分门禁。Git 报告按自身 reportId 和左右快照复核，不因普通索引快照变化机械删除。页面缓存每仓库、每页面至多保留最近 4 个快照记录；架构图视角最多 40 个、架构滚动位置最多 12 个、调用流图视角最多 8 个。训练草稿和非终态 Git 任务位于独立集合，不由页面缓存裁剪；训练草稿需用户显式丢弃。源码全文、图实例和 DOM 不缓存。
- 本轮实际验证：`pnpm --filter @project-xray/ui test`（11 个文件、62 项通过）；`pnpm --filter @project-xray/ui typecheck` 通过；`pnpm --filter @project-xray/desktop typecheck` 通过；`pnpm build`（10/10 包）通过；`pnpm --filter @project-xray/desktop test:e2e:workspace` 使用实际 Electron、preload、IPC、worker、SQLite 与 Monaco 验证比较跨页完成/报告复核、架构与调用流的独立源码上下文、解释结果恢复、训练草稿与源码恢复、工作区变化后的报告重算和快照过期入口。`pnpm --filter @project-xray/desktop test` 成功退出，但当前 desktop Vitest 无测试文件；另增加了重算后报告状态读取不报错的 E2E 断言。最新截图：[比较跨页返回](screenshots/comparison-returned-after-navigation.png)、[架构上下文恢复](screenshots/architecture-context-restored.png)、[解释会话恢复](screenshots/feature-explanation-session.png)、[基准过期后重算](screenshots/comparison-recomputed-after-stale.png)。
- `pnpm verify` 本轮退出码为 1：全仓类型检查阶段通过；并行 Vitest 中 `packages/git/src/index.test.ts` 的“工作区身份包含未跟踪受支持文件内容，并拒绝捕获期间的混合内容”超过默认 5 秒（该测试实测 5007 ms，Git 包该轮 11 项中 10 项通过）。这与此前已记录的同一并行负载超时一致；本批未修改 `packages/git`。不提高超时或删断言的情况下，单独运行该用例为 1/1 通过，单独运行 `pnpm --filter @project-xray/git test` 为 11/11 通过；随后独立运行 `pnpm build` 为 10/10 包通过。`pnpm verify` 因测试阶段中断，本身没有进入其串接的 build 阶段。
- 已查看上述关键截图。重算截图显示工作区快照标为 stale、报告实际基准为 Index → 工作区，且报告状态读取成功，没有“后台查询工作线程异常退出”错误。测试使用临时确定性仓库；截图中只含 fixture 项目名和相对文件路径。截图保存在本机 `docs/screenshots/`，该目录由仓库 `.gitignore` 排除，不属于 Git 跟踪文件。
- 未实现应用重启恢复或持久化比较任务队列；进程退出会释放页面会话与未结束的比较任务。本批没有运行安装包、视觉审计矩阵或六页全面的长时间/多仓库压力验证。生产构建仍有 UI 主 chunk 与 Monaco 的体积提示，本批未做无关拆包。此前第二批记录中的“Git 比较后台任务迁移尚未实现”描述是当时状态，已由本节第三批实现与验证更新。

## 训练工作会话与跨页面恢复（第二批，2026-09-26）

- 所有权训练状态由 UI 内存会话控制器持有，按 repositoryId + snapshotId 隔离。当前范围草稿、问题轮次和捕获范围、题目进度、结构答案、源码引用/角色、未评估笔记、评分反馈、错误与训练页源码上下文均独立于页面挂载状态。导航仍按需卸载页面，不通过隐藏挂载六页保留草稿。
- 生成题目和提交评分的生命周期与页面可见性分离。请求通道、序号、捕获参数和 pending 状态由控制器管理；页面卸载只释放视图订阅。切页期间请求可完成并只写回发起它的会话，StrictMode 和重挂载不会重复执行写操作。工作区标记过期时控制器使正在进行的训练请求失效；晚到成功、失败及 finally 均不能恢复旧 loading、结果或错误。
- 工作区过期会保留答案、引用、笔记和评分用于查看，生成与提交被禁用。新快照创建独立空会话，旧快照以只读预览列出，可由用户逐项丢弃；切换仓库时会话隔离。草稿、请求和历史只保存在本次应用运行中，应用退出会清空，不提供重启恢复。已评分掌握度仍遵循既有本地数据库及快照复核契约。
- 训练源码位置独立于架构页共享源码状态，保存文件、证据范围、选择/光标、滚动、面板打开状态及必要布局。返回训练页时会重新读取源码并再次校验仓库、快照和文件；离开页面会使旧训练源码导航失效，不能在架构页突然打开。关闭面板后显示“重新打开上次训练源码”入口；恢复读取不自动新增引用。
- 缓存边界：范围搜索最多保存当前 50 条节点；文件浏览器只在挂载期间保存并最多显示 200 条，源码全文不放入会话。归档草稿是用户可编辑训练内容，绝不自动淘汰；用户可在“旧快照训练草稿”中显式丢弃，进程退出时全部释放。
- 本轮实际验证：pnpm --filter @project-xray/ui test（10 个文件、55 项通过）；pnpm typecheck（10/10 包通过）；pnpm build（10/10 包通过）；构建后的 pnpm --filter @project-xray/desktop test:e2e:ownership 真实启动 Electron 并通过。E2E 覆盖训练生成、回答和引用、切换架构页打开另一源码文件、返回恢复答案/引用/源码位置、继续核验、修改工作区、过期提示、重建快照、旧训练只读查看及掌握度重新验证。实际检查的截图：[结构反馈](screenshots/ownership-structured-feedback.png)、[新快照重新验证](screenshots/ownership-needs-revalidation.png)；截图不含源码全文或绝对项目路径。
- 本轮没有执行应用重启后的训练草稿恢复、Git 比较后台任务迁移、pnpm --filter @project-xray/desktop test:e2e、test:e2e:ui 或 test:design；设计审计未作为本轮验收，截图做了人工查看。生产 UI 构建仍提示 Monaco 与主 UI chunk 超过 500 KB；本批没有为此调整拆包。

## 训练范围一致性与源码导航请求身份（2026-09-26）

- 所有权训练生成题目时捕获仓库、快照、范围类型、节点 ID 和显示名称；题目与该范围作为同一轮结果安装，题面范围标签读取已安装轮次。生成期间范围类型、搜索与选项控件锁定；失败保留所选范围并可重试，空结果显示当前范围缺少足够 verified 事实。仓库/快照切换、重复请求和组件卸载会使旧结果与收尾失效。显示名称仅用于 UI，不增加 verified 图事实；题目协议和评分不变。
- 源码导航现在以仓库/快照身份、会话代次和递增请求序号共同确认有效性。项目切换（包括离开后返回相同快照）、新导航和卸载都会使旧请求失效；边证据查询后、读取源码前再次检查请求身份。只有仓库、快照、证据 ID 和文件路径均与请求相符的响应才会展示；失效错误不会修改当前项目错误或触发当前快照刷新。EvidenceWorkspace 原有仓库/快照过滤保留。
- 现有 `getEvidence` 响应原本缺少仓库 ID，无法在 UI 独立验证跨仓库归属。本轮只给证据查询响应增加 `repositoryId`：application 从已校验的快照来源补入，desktop IPC 用扩展后的 Zod schema 校验；持久化 Evidence、IPC channel 和 ownership 题目/评分协议未变。
- 本轮实际验证：UI 回归 10 个测试文件、50 项通过；application 11 项、contracts 4 项通过（含证据响应必须带仓库身份的契约回归）；`pnpm typecheck` 10/10 包通过；`pnpm build` 10/10 包通过。`pnpm test` 全工作区有 1 项既有 Git 比较测试在并行负载下触发 5 秒超时，其余已报告包通过；单独运行该测试通过，随后 Git 包完整测试 11/11 通过。desktop Vitest 当前没有测试文件。生产 UI 构建仍提示 Monaco 和主 UI chunk 超过 500 KB。
- 本轮没有运行 Electron E2E、视觉审计、截图或安装包验收；因此不将它们计为本轮验证。跨页面工作会话保存与应用重启恢复仍未实现，训练状态只在当前页面/快照生命周期内有效。

## 可信语义分析与所有权训练闭环（2026-09-21）

- Graph IR `1.2.0` 明确区分外部包、未解析模块、未解析调用和不支持语义结构。`.map`、`.filter`、动态属性或未绑定名称不再仅因无法解析就显示为第三方依赖；未知事实仍保留证据、原因和置信度。
- Python AST 分析器 `2.0.0` 已从内嵌脚本拆为单一隔离 worker，并对协议做运行时校验。词法绑定覆盖模块、类、函数、嵌套函数、参数和局部遮蔽、基本 `global/nonlocal`、模块/成员别名、相对包、`__init__.py` 与循环导入；项目内调用不再使用唯一同名符号回退。
- 单文件失败隔离、最大 4 并发、15 秒超时、取消和子进程回收保持不变。失败模块不会贡献伪造定义，依赖它的导入和调用保持 unknown；诊断继续脱敏。
- 所有权题目契约和评分升级为 `2.0.0`。调用方向、有序路径和变量读写角色由服务端确定性检查；合法替代路径可以通过，颠倒方向、错序、交换角色、重复/伪造/过期引用不能通过。自由文本只保存在本地，明确“未评估”，不形成总分幻觉。
- SQLite 迁移版本 7 追加保存每次答题尝试、概念、题型、题目/评分版本、结构答案和引用。失败后可以修正同题；重开仍可查看记录；新快照下旧概念显示“需要重新验证”，不会继承通过状态。旧 mastery 记录保留为 legacy/unknown。
- 训练 UI 复用证据工作区，支持项目、目录模块和符号附近范围、分页文件浏览、结构化控件、提交后可点击证据、薄弱概念复习和再次验证。项目/快照切换会隔离题目、答案、引用和迟到响应。

本轮实际验证：Python 金标 11/11、ownership 5/5、application 11/11、graph 11/11、UI 10/10；工作区类型检查、10 包生产构建和真实 worker smoke 通过。真实 Electron 所有权 E2E 使用实际 preload、IPC、worker、SQLite 与 Monaco，完成混合项目导入、Python 别名事实、错误方向反馈、修正通过、精确证据范围、重开记录、源码变化、重新索引与“需要重新验证”。截图为 `docs/screenshots/ownership-structured-feedback.png` 和 `ownership-needs-revalidation.png`。

未支持边界：Python 星号导入、动态导入、实例类型推导、装饰器重写、描述器、猴子补丁和框架依赖注入仍保守为 inferred/unknown；旧 Graph IR 快照需要重新索引才具有新分类。本轮没有接远程 LLM、增量索引或安装包。

## 已完成的第一批端到端能力

- Electron 安全壳、上下文隔离、沙盒渲染进程和类型化预加载接口；
- React 中文桌面界面与六个 V1 功能入口；
- 本地目录选择与 Git 浅克隆导入；
- 项目根目录约束、符号链接逃逸防护、秘密文件与构建目录默认排除；
- 基于 TypeScript Program/TypeChecker 的项目级 JavaScript/TypeScript 分析，并读取 tsconfig 编译选项；
- 跨文件 import/export、函数/类/方法/箭头函数解析和可验证调用边；
- 参数传递、变量读写、返回值与调用结果的数据流证据边；
- Express/Fastify 风格 HTTP 路由与 React JSX 事件入口适配器；
- 隔离的项目级 Python AST 分析，不导入、不执行目标项目，并解析相对模块导入；
- Python 函数/方法/参数/局部变量、变量读写、返回值及唯一名称跨文件调用证据；
- FastAPI/Flask/Django 路由入口与处理函数适配器；
- 带快照、源码范围、分析器版本和置信度的统一证据图；
- 每项目 SQLite 快照持久化、事务写入和基础图查询；
- 架构图、三层调用子图和源码查看器；
- 基于入口、调用和数据流证据链的离线功能解释，支持常见中文功能词检索；
- 双侧不可变 Git 比较：工作区 index → working tree、暂存区 HEAD → index、最近提交指定父提交 → HEAD；
- 新增、修改、删除、重命名和未跟踪文件浏览，左右历史源码、hunk 与直接变化符号定位；
- 基于对应侧 `CALLS/HANDLES/IMPORTS` 证据的有界“可能影响”路径，并支持报告持久化、过期检测和安全重算；
- 所有权题目生成、源码范围引用和确定性评分；
- 混合 TS/Python 项目的端到端集成测试；
- Electron + SQLite 原生驱动的隐藏窗口启动测试；
- 不可变源码快照、逐文件内容哈希和 `current/stale/missing` 状态核验；
- 仓库/快照显式绑定的图、解释、差异、题目、答案和源码定位接口；
- 图节点、图边、解释步骤和答题反馈共用的源码范围导航、高亮与滚动；
- 独立索引 Worker Thread、版本化任务协议、真实进度、取消、失败和安全重试；
- Python 最大 4 并发、单文件超时、取消与子进程回收；
- 提交前二次哈希核验，失败或取消不替换上一份完整快照；
- 每项目独立 SQLite、版本 2 迁移和旧共享数据库兼容读取；
- 所有权引用范围服务端校验与去重、确定性结构评分、按快照保存掌握记录；
- 自动化 UI 闭环：导入、源码定位、引用答题、过期、更新及取消；
- Worker 真实进程冒烟：进度、持久化、源码读取、过期检测和取消。
- `Graph Query 1.0.0` 有预算查询：调用、数据、依赖视图分离，方向、深度、节点/边/工作量、置信过滤、截断统计和快照绑定游标均进入契约；
- 项目概览、模块页、搜索页、有界子图、指定证据与源码范围按需经 IPC 读取，新 UI 主路径不传输整图；
- 架构页以目录模块摘要开始，支持搜索、展开、返回和聚合关系底层证据；流程页控件真实驱动查询；所有权文件选择改为全量搜索分页；
- 状态检查及发布前验证使用同一规则重新发现清单，覆盖新增、删除、重命名、支持配置变化和索引期间新增；
- 源码坐标统一为 1 基行、0 基 UTF-16 列与半开范围，Python AST 字节列在边界转换；
- 功能解释改用有界调用查询，不再枚举最长路径或把数据关系拼成执行顺序；
- SQLite 版本 6 概览/范围/报告结构和查询索引、真实 Electron E2E 以及可复现真实项目性能基线。

## Git 双侧比较正确性收口（2026-09-20）

本轮实际复现并修复了以下问题：

- 工作区比较身份没有包含未跟踪受支持文件的正文。现在身份使用与捕获相同的发现、忽略、安全和 2 MB 上限规则，对实际纳入分析的内容清单和哈希取指纹；名称与 status 不变但正文变化时，历史报告会变为 `stale`，捕获期间持续变化在一次有界重试后会失败。
- 重命名状态和逐文件 patch 使用了不同 Git 条件，且新路径可被解释为 pathspec 模式。现在 name-status 与完整 patch 共享重命名阈值和比较基准，只捕获一次 patch，并用 `:(literal)` 限定路径；纯重命名保持零 hunk，重命名后局部修改/删除保留准确旧、新范围。
- 比较侧已经记录分析失败，但报告顶层固定为空。`ChangeSet 1.1.0` 现在保存左右完整性、排除/失败清单、无法映射变化、未知目标与影响截断；旧 `1.0.0` 报告兼容读取时明确降级为 `partial`。
- 旧 `analyzeDiff/getDiffImpact` 用户入口仍与新双侧流程并存。该 IPC、preload 和 worker 操作已移除，用户界面只通过不可变双侧比较生成报告。

同时验证但未发现需要改变既有语义的边界：合并提交父序号仍显式选择，浅历史缺父和未合并 index 仍明确失败；影响路径原本已绑定单侧快照。本轮继续补强了同名/嵌套符号、删除与新增映射、循环、菱形、多入口和证据侧别测试。

具体行为：

- 支持 SHA-1 和 SHA-256 Git 对象格式，空树按仓库对象格式生成；尚无提交的仓库明确报错，不冒充初始提交。
- 秘密、忽略、不支持、二进制、超限和子模块内容不为指纹或 diff 读取正文；界面展示允许的元数据和不完整性。因为未纳入报告，这些正文变化本身不会使报告过期。
- TypeScript 语法诊断以文件、错误码、行和 UTF-16 列记录并脱敏；局部成功的报告显示 `partial`，不把失败文件解释为“没有受影响符号”。
- 纯重命名只产生文件级变化说明，不自动声称符号语义改变；报告 ID 包含影响查询预算，不同预算结果不会互相覆盖。
- UI 分开显示无变化、没有已知影响、分析不完整、查询截断和任务失败；影响证据按钮与 Monaco 暴露实际侧、快照、证据和精确选择范围供端到端验收。
- 变更浏览器按仓库和快照隔离组件状态；项目切换或离开页面会取消仍在运行的比较，迟到事件和旧报告不会覆盖新项目界面。

## 有限正确性修复：Python 失败隔离与 patch 统计（2026-09-20）

- Python 项目分析现在按文件隔离语法错误、超时、子进程异常和协议错误；正常文件的节点、边和证据继续保留，失败以项目相对路径和脱敏原因进入 `FileAnalysis.failures`。
- 取消仍以 `AbortError` 终止整个任务，不会被降级成普通文件失败；最大 4 并发、15 秒单文件超时和子进程回收保持不变。
- 只有成功分析的 Python 模块可参与项目内 import 解析。正常文件引用失败模块时，`IMPORTS` 和对应 `CALLS` 保持 `unknown`，不会生成伪造的 verified 目标。
- Python 运行环境无法启动时返回明确的环境不可用诊断；普通索引和 Git 左右比较侧均沿用现有完整性管线显示 `partial`。
- Git patch 统计现在以进入 `@@ ... @@` hunk 为边界：文件头 `---/+++` 不计数，hunk 内真实的 `+++counter`、`---counter` 等源码正常计为新增或删除；多 hunk、零行范围、二进制判断和无末尾换行标记的既有行为保持不变。
- 定向验证实际通过：`analyzer-python` 7/7、`git` 11/11、`application` 9/9，10/10 工作区包类型检查通过。本轮未重跑 Electron E2E、性能基准或全量构建。

## 可阅读的源码工作区与分层架构地图（2026-09-21）

- 架构、调用流和功能解释页共用可拖拽证据工作区；分隔条支持鼠标与键盘，左侧导航可收起，源码可最大化／还原，窄窗口使用明确的图／源码切换。
- Monaco 现在占据源码标题栏后的剩余高度并独立滚动，保留文件、快照、选择和证据高亮；面板尺寸变化触发 `layout()`，自动换行与纯布局偏好只保存在本机，不保存源码内容。
- 架构地图按“目录分组概览 → 模块文件 → 文件／符号局部关系”分层。模块默认不展开全部符号，文件依赖和局部调用通过既有有预算查询按需读取。
- 模块聚合关系展示底层数量和置信度构成并可分页打开真实边；目录导航不再生成空证据 ID 的 `verified` 包含／定义边。
- Cytoscape 实例在同一组件生命周期内复用；普通 React 更新和 ResizeObserver 只更新数据／尺寸，不重建实例或强制覆盖用户视口。
- 定向验证实际通过：UI 组件 7/7、图查询 8/8、UI 与图包类型检查、10/10 包生产构建。真实 Electron 工作区 E2E 使用 ByteAtlas 只读输入通过，覆盖 1920×1080、1280×800、窄窗口切换、拖拽与键盘调整、源码最大化、换行、Monaco 横向滚动条和无页面横向溢出；实测 `devicePixelRatio` 为 1.5。
- 既有真实 Electron E2E 继续通过，实际经过 preload、IPC、worker、SQLite、Monaco 与 Cytoscape；本轮单次观测为首次可操作 652.3 ms、导入 896.8 ms、证据查询 436.8 ms。该数据是回归观察，不是性能分位数。
- 截图保存在 `docs/screenshots/architecture-overview-1920x1080.png`、`architecture-module-1280x800.png` 和 `source-maximized-1920x1080.png`。

本轮未验证除 1.5 之外的 Windows 显示缩放比例；也没有扩大到安装包、远程 LLM、分析器语义或增量索引。

## 架构关系总览与浏览正确性收口（2026-09-21）

- 项目概览新增“关系图／列表”双视图。两者使用同一个 `ModuleOverview 1.0.0` 查询：节点仅为实际 `CONTAINS` 已索引文件的目录分组，边是服务端对真实底层关系的定向聚合，展示关系数量、类型与置信度构成；点击聚合边后再分页读取可核验的底层边。
- 未解析相对模块引用与外部依赖作为独立引用摘要返回，不再混入零文件目录模块。项目概览中的模块数也只统计实际目录分组，不把 `./styles.css` 一类未解析引用计为模块。
- 概览查询绑定仓库、快照、搜索和分页范围；默认每页最多 40 个目录模块、160 条聚合关系，响应明确给出总数、截断和继续游标。当前页关系只统计当前可见模块集合，不能被理解为全仓库无限制整图。
- 文件符号搜索已下沉精确 `filePath` 过滤，并支持稳定游标、名称和类型过滤；不再先取全仓库前 80 条再由 UI 过滤。专用 fixture 实际分页读取到单文件的 106 个索引符号，并定位到末尾的 `symbol_104`。
- 架构浏览的模块展开、聚合证据、文件依赖、文件符号、局部调用和源码打开都使用包含仓库、快照、层级、对象与筛选条件的请求身份；同快照 A→B 快速切换、返回上层或切换项目后，A 的迟到成功和错误都不能覆盖 B。
- 尚未打开证据时不再保留空源码面板；打开后可关闭并恢复同一阅读上下文。项目或快照变化会清除旧源码。拖拽、最大化、自动换行、引用和准确范围导航保持不变。
- Cytoscape 仅在关系上下文变化时重新布局；同一上下文的数据刷新保留视口和选择。首次布局等待稳定容器后适应视图，用户开始交互后不会被迟到布局覆盖。总览画布高度与滚动检查器分离，避免长引用列表把节点居中到首屏之外。
- 本轮定向验证：graph 10/10、UI 10/10、application 18/18（应用测试以 30 秒用例预算运行）；10 个工作区包类型检查及生产构建通过。真实 Electron 工作区 E2E 使用 ByteAtlas 只读输入与专用大符号 fixture 通过，实际经过 preload、IPC、worker、SQLite、Monaco 与 Cytoscape；覆盖 1920×1080、1280×800、项目关系总览、模块/文件浏览、A/B 快速切换、源码开关与最大化、拖拽缩窄和单文件跨 80 条分页。实测显示缩放 `devicePixelRatio=1.5`。
- Electron 验收读取 Cytoscape 的 rendered bounding box，确认默认 11px 标签及节点位于可视画布内；源码验收比较当前项目快照、精确文件范围、Monaco 实际选区及不可变源码首行。三张视觉检查通过的截图为 `architecture-relations-overview-1920x1080.png`、`architecture-module-readable-1280x800.png`、`source-open-maximized-1920x1080.png`。

本轮没有验证除 1.5 外的 Windows 显示缩放，也没有用超出 ByteAtlas 规模的真实大型仓库验证 40 模块分页体验。外部依赖名称仍受现有分析器静态解析质量约束；浏览器只负责正确分类和展示，不在本轮改写分析语义。Vite 仍报告主包和 Monaco 延迟块较大，代码拆分是后续性能事项。

## 当前限制

- TypeScript 数据流仍是静态、过程内和非字段敏感分析；动态分派、反射、装饰器和依赖注入容器仍可能无法解析；
- 当前 Web 适配器仅覆盖 Express/Fastify 风格路由与直接 JSX 事件绑定，尚未覆盖各框架的全部约定；
- Python 跨模块调用现在依赖词法作用域和明确 import 绑定；尚未覆盖星号/动态导入、实例类型推导、装饰器重写、猴子补丁和框架依赖注入；
- 当前索引更新为全量重新索引，尚未实现经过一致性证明的增量复用；
- 规则排除的整个目录会展示规则，但为避免遍历依赖/构建目录，不枚举其中每个文件的精确数量；
- 取消进入 SQLite 提交阶段后采用事务完成优先，可能以成功完成结束；
- 旧共享数据库原样保留，但旧快照没有不可变源码副本，需要重新索引才能获得完整证据导航；
- 自由文本职责解释在离线模式下明确为“未评估”，当前只对定位、调用方向和读写结构作确定性评分；
- 功能解释目前使用本地确定性证据模板，尚未接入需要项目级授权的远程 LLM 适配器；
- Git 比较当前只支持三个既定模式，不提供任意两个提交选择；复制状态保留契约但没有独立 UI 流程；
- 影响传播只覆盖已有调用者、入口和文件导入证据；动态分派、运行时配置和未知目标可能形成缺口，未发现路径不等于确认无影响；
- 声明/签名变化可作为直接变化展示，但 V1 不证明兼容性破坏；重命名相似度不表示语义等价；
- 比较侧采用完整分析且报告当前以单个 JSON 读取，超大仓库仍需对象缓存、报告行级分页和更系统的资源基线；
- 工作区报告身份只覆盖实际纳入分析的受支持源码与配置正文；排除项只保存分类元数据，其正文变化不会使报告过期；
- 普通文件系统最后一次发布核验之后仍存在极短竞态窗口；历史报告会保存当时状态，后续 UI 核验负责识别继续发生的变化；
- Windows 无法实际创建的 Git 合法特殊名称仅有纯解析/对象级覆盖；可创建的方括号等路径已做真实仓库测试；
- 尚未完成 Windows 安装包、升级与卸载验证。
- 普通文件系统无法提供跨多文件绝对原子快照；当前在首次读取后和事务发布前各校验一次，第二次校验后仍存在极短竞态窗口；
- 配置身份只覆盖 package.json、pyproject.toml、requirements.txt、tsconfig.json、jsconfig.json，不解析外部 extends；
- 模块是目录分组，不代表业务边界；聚合关系最多附带 20 条底层边，更多关系需继续图查询；
- 完整快照 JSON 仍为历史兼容和尚未迁移的所有权/Git 内部用例保留，新 UI 主路径已不再传输；
- 搜索计划仍可能为排序使用临时 B-tree；801 文件基线约 1–2 ms，暂未引入 FTS；
- 开发构建的真实 Electron E2E 会显示 CSP 警告，生产 CSP 与安装包不在本轮范围。

这些限制必须在界面和交付说明中保持明确，不得把当前静态结果描述为完整运行时真相。

## 下一批顺序

1. 根据现有基线设计增量索引的一致性与复用边界，不在正确性证明前实现；
2. 在实测大型仓库上优化双侧分析复用、报告行级分页，并扩展有限契约变化规则；
3. 实现项目级远程 LLM 授权和结构化证据解释适配器；
4. 拆分前端大体积代码包并扩展 Electron 端到端覆盖；
5. 完成 Windows 打包与安装生命周期测试。

## 历史累计验证记录（截至 2026-09-20）

- 10 个工作区包 TypeScript 类型检查通过；
- 48 个单元、集成、协议和 UI 测试通过；其中 Git 10 个、应用编排 8 个、图存储/查询 8 个、UI 4 个，覆盖未跟踪内容身份、统一重命名 hunk、literal pathspec、SHA-256 空树、部分分析、单侧证据、项目切换隔离和旧报告兼容读取；
- 10 个工作区包构建通过；
- Node Worker 真实进程冒烟通过：进度、事务持久化、快照源码、外部变化、取消和旧快照保留；
- Electron 隐藏窗口启动通过；
- 前端生产包构建成功，初始主 JavaScript 包约 801 KB；本地 Monaco 延迟块约 2.64 MB、editor worker 约 301 KB，仍需后续进一步拆分；
- 真实 Electron E2E 通过：实际 preload、IPC、worker、SQLite、Monaco、Cytoscape 覆盖导入、符号搜索、有界调用查询、证据定位、外部新增文件过期和更新索引；
- `pnpm benchmark` 已实际运行：混合金标、200/800 文件确定性项目与固定 SHA 的 MIT `p-map`；原始数据见 `docs/benchmarks/latest.json`；
- 取消由真实 Worker smoke 单独覆盖；窗口在索引与查询期间仍由独立 worker 保持可交互。
- Monaco 与 editor worker 已本地打包和延迟加载，不再从 CDN 获取或退回主线程。
- `ChangeSet 1.1.0` 双侧比较集成测试、Git 隔离仓库边界测试和真实 Electron 比较 E2E 已通过；删除/重命名旧侧源码、变化符号、影响证据、过期与重算均走实际 preload、IPC、worker、SQLite 与 Monaco。
- 最终真实 Electron E2E 单次观测：首次可操作 610.2 ms、导入 901.4 ms、证据查询 412.5 ms、暂存区比较 1305.8 ms、未跟踪正文变化后的状态核验 2.5 ms、比较重算 4119.8 ms、重新索引 800.8 ms。状态核验耗时受轮询时点影响，不是过期通知 SLA。
- Worker 冒烟实测索引取消响应约 4.56 ms、比较取消响应约 3.02 ms；60 文件多跳样例的历史基准约 1.13 s、响应 30.5 KB。均为单次观测，不是分位数。
- E2E 使用实际 preload、IPC、worker、SQLite 和 Monaco，核对重命名局部修改的旧/新路径与 hunk、删除文件旧侧源码、语法错误导致的 `partial`、影响边证据 ID、对应侧快照和 Monaco 完整起止行列；随后只改变未跟踪文件正文，确认报告过期并安全重算。

## A + B + C 深色工作台（2026-09-22）

已将石墨/蓝紫视觉、SVG 导航、点阵节点画布和源码主题接入现有真实工作流。UI 10/10 测试、UI 类型检查和构建、真实 Electron E2E 与工作区 E2E 通过。设计约定、截图与实际验收边界见 [UI-DESIGN.md](UI-DESIGN.md)。


## 第二版架构探索工作台（2026-09-22）

完成模块规模卡片、关系证据检查、源码定位与返回视角的连贯样板。新增证据读取竞态/错误快照/重试与异步空图适应回归，UI 13/13、UI 构建及真实 Electron 核心/工作区 E2E 通过。最后一轮工作区测试验证精确视角恢复与两种窗口尺寸，截图保存在 `docs/screenshots/exploration-v2/`。完整范围和限制见 `UI-DESIGN.md` 第二版章节。

## 完整工作台设计收口（2026-09-22）

六个页面已采用统一设计变量、高对比度文本与自适应布局；新增真实操作入口及可重复视觉审计。13/13 UI 测试、UI 类型检查/构建、Electron 核心/架构/所有权 E2E 通过。36 个真实页面与源码状态通过对比度、水平溢出和可见控件中心遮挡检查。准确尺寸、样本数量、截图和保证边界见 [FINAL-DESIGN-ACCEPTANCE.md](FINAL-DESIGN-ACCEPTANCE.md)。

### V1 最后打磨

保留既定视觉风格，折叠调用查询的次要参数，增加连接真实节点导航的可搜索列表，并简化查询与训练说明。UI 14/14、类型检查/构建、核心与架构工作区 Electron E2E 通过。视觉审计扩展到 38 场景、1461 个文字样本，最低对比度 4.90:1；节点列表在窄窗口和 125% 页面缩放下额外验证完整按钮可见。未生成安装包，未提交 Git；全项目仍为未跟踪状态。当前详细验收以 FINAL-DESIGN-ACCEPTANCE.md 为准。


### 阅读与检索深化（2026-09-22）

新增独立 GraphNodeBrowser：中文类型、搜索、类型筛选、稳定排序、40 项分页、空结果恢复与选中反馈。概览覆盖信息分层、规则展开、长路径换行。16 项组件测试及 UI 类型检查/构建通过；39 场景、1505 个文字样本、最低 4.90:1，列表点击实际打开 Monaco。核心、架构、所有权 Electron 功能回归通过。架构回归截图因 Windows 捕获超时未完成，关闭该套截图后全部功能断言通过；设计审计截图正常生成。测试增加精确标题定位与异步首批符号等待。未添加依赖、未生成安装包或提交 Git。


### 查询交互与状态一致性（2026-09-22）

FlowExplorer 拆为独立组件，修复新搜索残留旧选项与修改条件后沿用旧游标的行为。增加加载状态、输入校验、无结果恢复提示、结果起点、条件变更提示和中文输入法 Enter 保护。19 项组件测试、UI 类型检查/构建、41 场景视觉审计及 Electron 核心 E2E 通过。1600 个可见文字样本最低对比度 4.90:1。架构/所有权回归沿用上一轮结果，未重复运行。

### V1 UI 交互可靠性深化（2026-09-25）

完成三个可操作切片。功能解释增加请求身份/快照隔离、顺序化阅读、空结果/失败恢复和证据导航；所有权训练清晰化操作阶段，修复引用移除后的 variable-flow 角色索引，分开显示定位、结构与未评估自由文本；Git 比较绑定报告、文件、左右侧和快照，补齐即时防重、基准提示、旧报告保留、状态恢复与来源证据 ID。

验证：UI 10 个文件、35/35 测试；UI TypeScript/生产构建、全部 10 个工作区包构建通过；视觉审计 73 项/13 个交互结果通过，2,880 个可见文字样本最低 4.903:1，47 组调色板目标达标；核心 Electron、ByteAtlas UI 工作区（截图开启）、所有权训练 E2E 均通过。首次核心 E2E 暴露 Git 影响证据导航遗漏 evidence ID，已修复并添加针对性组件回归，然后重建并通过核心 E2E。真实 Electron 截图与审计写入 `docs/screenshots/ui-deepening-2026-09-25/`，UI 工作区截图位于其 `ui-workspace/`；另有最新所有权流程截图在 `docs/screenshots/`。

125% 页面缩放通过 DOM/交互审计，但 Windows Electron 分数缩放截图会裁切；没有把裁切截图报告为目视通过。静态分析限制、功能解释未接远程 LLM、自由文本不参与语义评分、未验证其他显示缩放和未制作安装包等范围保持不变。完整结果、历史对照和截图链接见 [FINAL-DESIGN-ACCEPTANCE.md](FINAL-DESIGN-ACCEPTANCE.md)。

### 第四批：界面交互打磨与首屏信息优化（2026-09-26）

先核对前三批已经存在的按仓库/快照页面会话、页面独立源码阅读上下文、训练生命周期控制器与 Git 比较任务控制器。本轮复用这些机制，没有再建立任务框架，也未改动分析器、评分或 Git 写操作。

架构文件层改为符号列表优先，选中后才展示有界局部关系；小于 720 CSS px 时切换列表/关系标签。源码工作区按实际容器宽度适配，宽屏可调分栏，窄屏使用面板标签，隐藏区不留焦点；分栏宽度偏好与临时窄屏适配分离。Git 首屏突出捕获时的报告基准、任务状态和变更文件，详细哈希与配置仍可展开查看。训练将结构答案、引用和提交前置，学习笔记折叠并明确“不参与评分”。功能解释修复旧步骤按钮规则挤压证据操作的问题，并保留只定位本步骤证据、失败局部重试的行为。比较任务、页面会话、过期门禁和异步身份检查沿用前三批实现。

本批实际验证：

- `pnpm --filter @project-xray/ui test`：11 个文件、68 项通过。
- 定向架构、源码工作区、Git、训练、解释和画布回归：6 个文件、34 项通过。
- `pnpm typecheck`：10 个工作区包通过；`pnpm build`：10 个工作区包通过；最终 UI 样式调整后 `pnpm --filter @project-xray/ui build` 通过。
- `pnpm --filter @project-xray/desktop test:e2e:workspace -- final`：Electron/Playwright 跨页流程通过，覆盖 Git 比较离页继续、训练答案与源码恢复、架构视角与分栏、解释步骤证据定位、工作区变化及重索引。截取 1024×800、1440×900 和 1920×1080 场景，DPR 1.5。
- PowerShell 命令 `$env:XRAY_DESIGN_AUDIT_SET='ui-polish-2026-09-26'; pnpm --filter @project-xray/desktop test:design`：73 个状态/视口场景，13 个焦点与交互状态通过；3,124 个文字样本最低 4.903:1，47 组调色板检查通过；无对比度、页面横向溢出、未声明内容溢出、控件遮挡或控件边界错误。首两次审计尝试暴露脚本流程预期过时（未先切左侧源码标签；旧脚本预期过期页仍能生成），修正为选择实际侧并验证过期门禁禁用生成后通过，未删除产品断言或降低阈值。
- 默认 `pnpm --filter @project-xray/desktop test:e2e:ui` 在项目路径检查阶段因缺少 `XRAY_UI_PROJECT` 退出，未启动 ByteAtlas 专用流程。PowerShell 命令 `$env:XRAY_UI_FIXTURE_ONLY='1'; $env:XRAY_UI_SCREENSHOT_SET='ui-polish-fixture-2026-09-26'; pnpm --filter @project-xray/desktop test:e2e:ui`：确定性架构浏览样例通过，加载 106 个符号并采集截图。
- `node --check` 对视觉审计与两个 Electron UI E2E 脚本通过。

工作区 Electron E2E 首次曾使用旧 UI `dist`，在重建工作区包后重跑通过；后续一轮在 Monaco 选择属性尚未更新时过早读取，脚本改为等待编辑器选择后最终通过。基线/结果截图与解释页核验截图链接见 [FINAL-DESIGN-ACCEPTANCE.md](FINAL-DESIGN-ACCEPTANCE.md)。125% 页缩放的 Electron 图像受 Windows 分数缩放裁切，未作为完整截图验收；该尺寸通过了 DOM/交互审计。生产构建仍提示 UI/Monaco chunk 大于 500 KB，本批不做无关拆包。没有生成安装包、关闭应用恢复或跨平台/其他显示缩放验证。

## CSS 清理收尾（2026-09-27）

本轮从干净状态 `5bb791a` 开始；改动只涉及 CSS 归属、图工具栏禁用说明、其回归测试/Electron 验收脚本及本开发记录。没有改变会话、任务、分析或证据行为。

### 样式规则与差异

- 唯一入口是 `apps/ui/src/styles.css`：tokens → base → controls → layout → components → pages → responsive。通用表单和控件交互/禁用态归 `controls.css`；窗口外壳与导航结构归 `layout.css`；共享面板、源码面板及工具栏尺寸归 `components.css`；页面专属内容留在 `pages.css`；条件覆盖集中于 `responsive.css`。
- 禁用控件颜色集中定义在 `controls.css`，普通控件、图/工具栏和导航保留不同变体。删掉工具栏的 `.35` opacity、layout 中的通用禁用声明和组件样式里的竞争规则。次级按钮与表单只保留最终语义变量；`.sidebar nav` 取代裸 `nav`；共享 `.panel`/`.source-panel` 外观移出页面样式。没有把第三方 Cytoscape / Monaco 主题改成 CSS 变量接口。
- `--focus-ring` 设为原界面已生效的青绿色值，避免迁移后误用未生效的旧 token；输入焦点光晕、主按钮边框/hover 和工具栏 hover 色使用语义变量。局部证据范围半透明色、单次关系图状态与渐变停止色继续保留在页面规则，因为透明度和用途不同。全局仅保留 reduced-motion 的两项 `!important`（禁用 transition/animation）；无空媒体块。
- 响应式清单：窗口阈值 1500/1250/1180/1100/900/800/740/620 CSS px 控制外壳或页面布局；740/650 CSS px 容器阈值控制架构局部区域/节点搜索；另有 reduced-motion 查询。E2E 对八个窗口阈值分别测量前、当点、后，并对容器内容宽度 740/741、650/651 测量。窗口与容器查询各自负责不同层级，未合并相近数值的条件。
- 基线实际合成后的图工具栏禁用文字对比度为 1.87:1；结果 opacity 为 1、文字/禁用表面为语义色，对比度 5.93:1。禁用时 hover 不改变颜色、背景、边框、阴影或透明度；控件保持原生 `disabled`。“聚焦选中”旁有“选择节点后可聚焦/切回画布后可聚焦”说明。禁用侧栏项的背景/边框改为透明是有意变体，避免禁用导航项被误读为当前页面。

### 验收与产物

- `pnpm --filter @project-xray/ui test`：11 个文件、80 项通过；包括“聚焦选中”使用原生 disabled、就近说明原因且不触发聚焦的回归。
- `pnpm typecheck`：10 个工作区包通过；`pnpm build`：10 个工作区包通过。构建仍提示 UI 主包约 922 KB、Monaco 约 2.64 MB 超过 500 KB 建议值；这是已知体积提示，本样式收尾不做拆包。
- `pnpm --filter @project-xray/desktop test:design`，环境变量 `XRAY_DESIGN_AUDIT_SET=css-cleanup-followup-design`：73 个场景、13 个键盘/状态交互，失败与错误均为 0。覆盖项目概览、架构、调用流、解释、Git、训练及 1024/1440 CSS 视口；包括空结果、过期、失败重试、缺少左侧源码、键盘焦点和训练控件焦点。
- `pnpm --filter @project-xray/desktop test:e2e:workspace final`：Electron/Playwright 跨页路径通过。测试执行 Git 报告跨页继续、左右源码身份、解释步骤证据定位、训练答案/引用/笔记和源码位置恢复、架构选符号与源码阅读、拖动分栏/最大化/恢复、窄宽切换，以及工作区变化后过期与重算；A→B→A 样例也覆盖恢复流程。测试为确定性临时副本，不运行样例代码。最终输出 `cross-page-workspace-e2e: passed`。
- `node --check apps/desktop/scripts/ownership-training-e2e.cjs`、`git diff --check` 通过。E2E 的针对性计算样式审计逐一验证禁用文字合成颜色与 4.5:1 项目目标，不依赖通用审计跳过 disabled 的行为。
- 窗口边界采样用 CSS `innerWidth/innerHeight`，设计审计直接通过 BrowserWindow 设置原生窗口尺寸（验收脚本将最小尺寸临时设为 800×600，以容纳 1024×800）。为最终同流程截图，E2E 基线九张均是 Electron 原生窗口/DPR 1.5；结果欢迎页/外壳两张为原生窗口/DPR 1.5，其余 Git 1024、解释/训练/架构和 1920 场景由 Playwright 渲染视口模拟，DPR 约 1.0。计算 JSON 明确标记 `captureMode`、DPR、CSS 窗口与容器尺寸；这些模拟结果用于布局检查，不作为同 DPR 像素差结论。原生 Electron 窗口的 1024/1440/断点布局另由设计审计覆盖；本轮没有在所有页面/三个目标尺寸取得同一 DPR 的原生截图。
- 人工并列查看了 shell、Git 1024、架构分栏、训练引用和解释证据场景。匹配的原生 shell 样式没有意外几何差异；界面可见的设计变化是禁用态恢复清晰度、禁用导航透明，以及图工具栏原因提示。解释页基线图还显示临时 Git 任务条，结果截图采集时该状态已消失；这两个场景不能按完整页面像素一一比较，任务条差别不是 CSS 修改。架构关系图的节点位置会随 Cytoscape 重新布局，报告/证据/快照 ID 也随临时导入变化，不把这些变化归为 CSS 回归。

E2E/审计调试记录：早期截图阶段发现 Monaco 选择范围尚未更新，脚本改为等到目标文件和完整范围匹配才保存；断点视口审计移至场景截图之后，避免污染截图；Windows Playwright 字体等待导致 `page.screenshot()` 超时后，改用 Electron `webContents.capturePage()`。最后一次断点失败是审计探针把含 32px padding 的节点列表外框当作内容宽度，导致 651px 内容阈值读到 619px；现探针按内容宽度设置，740/741 与 650/651 断点通过。路径文本变更后增加两帧等待，保证捕获的是已脱敏帧。上述调整只修正测试时序、采集或测量，不删除产品断言、不下调阈值；最终完整跨页 E2E 与设计审计均通过。

基线截图和计算样式位于 `docs/screenshots/css-cleanup-followup-baseline/`；结果截图、原始 Electron E2E/设计审计日志、完整计算样式及逐项差异位于忽略产物目录 `docs/screenshots/css-cleanup-followup-final/` 与 `docs/screenshots/css-cleanup-followup-design/`。最终差异文件为 `ui-polish-computed-style-diff.json`。截图使用确定性本地副本并已将项目路径改写为 `C:\xray-fixture\workspace`，不包含用户项目源码或凭据。125% Electron 图片裁切限制、应用重启恢复和跨平台显示缩放未在本批重新验证。

### 功能解释证据读取禁用反馈（2026-09-27）

#### 修复

`.steps button` 在 `pages.css` 中无条件设为 `cursor: pointer`，与后加载的禁用规则同优先级；`.steps button:hover` 未排除原生禁用状态，读取挂起时仍把按钮边框改成可用态的青绿色。删除页面上的无条件光标声明，并将 hover 限定为 `.steps button:not(:disabled):not([aria-disabled="true"]):hover`。禁用光标、文字、表面和边框继续只由 `controls.css` 的原生 disabled 规则负责。该区域没有独立 `:active`、阴影或位移声明；本次未增加禁用变体、`!important`、`pointer-events` 或键盘拦截。

#### 同条件 Electron 验收

- 修复前后使用同一个确定性 `ownership-training` 样例内容和“登录”解释结果；均为 Electron 44.4.3，内容区 1440×900 CSS px，DPR 1.5，应用缩放 1，使用 `BrowserWindow.webContents.capturePage()`。两轮分别从隔离的临时导入开始，因此可见的 snapshot/evidence ID 不同；样例文件内容、查询、页面状态、视口、缩放、DPR 和鼠标坐标一致。原始截图都是 2160×1350，没有缩放或裁剪。完整采集条件与值见 `docs/screenshots/explanation-disabled-final/computed-style-diff.json`。
- 修复前可用态默认/悬停样式分别是 `cursor:pointer`、文字 `rgb(240,242,250)`、背景 `rgb(36,40,52)`，边框从 `rgb(133,139,163)` 变为 `rgb(63,122,120)`。读取挂起时虽然颜色、背景和 opacity 已符合 `controls.css` 的禁用语义变量，光标仍是 `pointer`，悬停边框仍变为 `rgb(63,122,120)`；移出时回到 `rgb(69,75,96)`，再移入又被覆盖。
- 修复后可用态的默认和 hover 值不变。挂起态为原生 `disabled`、`cursor:not-allowed`、文字 `rgb(150,156,175)`、背景 `rgb(29,32,43)`、边框 `rgb(69,75,96)`、opacity `1`、box-shadow `none`、transform `none`。指针离开与重新悬停期间这些禁用值保持不变；背景为不透明控件色且所有祖先 opacity 为 1，实际颜色合成对比度为 5.93:1，满足项目 4.5:1 可读性目标。证据读取成功后以 `pkg/api.py` 的对应快照和 evidence ID 打开源码；按钮恢复可用且重新悬停生效。
- 挂起期间使用 Electron 原始鼠标坐标再次点击，释放请求前后 `evidence:get` 读取次数始终为 1。E2E 仅在测试进程里包裹现有 Electron IPC handler 并在释放时转发到原 handler；未修改生产 IPC 或读取逻辑。组件测试验证挂起期间重复点击无额外请求，既有组件用例验证失败提示、结果保留、解锁和重试。

截图对照：[可用默认态（修复前）](screenshots/explanation-disabled-baseline/explanation-evidence-baseline-available-default.png)、[可用 hover（修复前）](screenshots/explanation-disabled-baseline/explanation-evidence-baseline-available-hover.png)、[读取挂起 hover（修复前）](screenshots/explanation-disabled-baseline/explanation-evidence-baseline-pending-hover.png)；[可用默认态（修复后）](screenshots/explanation-disabled-final/explanation-evidence-final-available-default.png)、[可用 hover（修复后）](screenshots/explanation-disabled-final/explanation-evidence-final-available-hover.png)、[读取挂起 hover（修复后）](screenshots/explanation-disabled-final/explanation-evidence-final-pending-hover.png)。原图已实际并列查看：预期差异是禁用按钮边框不再呈现 hover 色；其他控件与布局未见意外变化。逐属性差异和计算对比度见 [computed-style-diff.json](screenshots/explanation-disabled-final/computed-style-diff.json)。

#### 本轮验证

- `pnpm --filter @project-xray/ui exec vitest run src/components/FeatureExplanationWorkspace.test.tsx`：7 项通过；新增用例使用受控 Promise 和真实组件按钮，第二次 `user-event` 点击在请求仍挂起时返回，请求数断言在释放 Promise 前执行。错误与重试仍由现有同组件回归覆盖。
- `pnpm --filter @project-xray/ui test`：11 个测试文件、81 项通过；`pnpm typecheck`：10 个工作区包通过；`pnpm build`：10 个工作区包通过。UI 构建仍报告主 UI 与 Monaco chunk 超过 500 KB 的既有提示。
- `pnpm --filter @project-xray/desktop test:e2e:workspace final --explanation-disabled-only`（分别设置 `XRAY_UI_SCREENSHOT_SET=explanation-disabled-baseline` 与 `explanation-disabled-final`）：受控 pending、hover 移出/移入、挂起期原始鼠标重复点击、成功导航及恢复均通过。完整 `pnpm --filter @project-xray/desktop test:e2e:workspace` 也通过，覆盖架构源码、Git 报告、训练引用/答案和跨页返回。
- 采集迭代中，第一次尝试发现 Electron `contextBridge` 暴露的 `window.xray` 是不可写代理；测试钩子改为仅包裹测试进程的 IPC handler。随后一次可视状态采集尝试在额外的第二轮失败请求上等待错误按钮进入 pending 超时；该重复的失败状态由组件集成测试负责，Electron 路径保留本次需求的 hover/pending/重复点击/成功视觉验收并通过。没有通过降低断言或加入生产延迟来处理这些采集尝试。

#### 历史视觉补证边界

上述前后截图只证明本次功能解释按钮修复。此前整轮 CSS 清理的截图仍有原生窗口和模拟视口/DPR 混用，不能据此声称全量像素等价；本次没有恢复历史 CSS 与采集环境重拍其余页面。历史重构的视觉等价性仍以既有记录中的限制为准，不由本次局部验收替代。
