# 4B-A：升级保护自有夹具实施

2026-10-04，协调方。依据当前 GraphStore 构造内基础/10/11 分段迁移、Application global→project 打开与单项目异常继续行为，以及已独立复审的 [升级保护设计](2026-10-04-windows-upgrade-preservation.md)。这是既有 Windows/V1 开发授权下的具体派发；设计中 B 所称“新授权”指协调方审查后的具体实施边界，不要求重新询问用户。当前仅实施 A，生产升级保护、桌面入口和真实用户数据仍不进入范围。

## 目标、优先级与基线

P1：在新建自有小数据库上运行真实迁移，精确确认旧源码、身份、时间、current/partial 与 ownership 数据保留；通过真实 SQLite 故障和 WAL 崩溃切点确认独立原始包及还原副本的边界。测试复制辅助函数不是产品 backup 能力，未来版本/角色错配/项目失败现状不能写成生产保护已通过。

主 checkout HEAD 95ebbd3b0dc88107b5b54e172138cb8685bd1bcb；Sol 保留 HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8 及原全部改动。GraphStore hash853DA33765953DC5803EFDB692583C37CDED7F13E7266545F1724395DCE4B4AB、application hash855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18 与 main 相同；remote store 原始 hash 因换行不同，但独立 no-index 内容比较一致。不能 reset、整份同步或整体合并 worktree。

## 唯一开发范围

原“开发-Sol”，仅 D:\Projects\CodexWorktrees\5170\Project X-Ray，新增：

- packages/graph/src/upgrade-preservation.test.ts
- packages/application/src/upgrade-preservation.test.ts
- docs/development-runs/2026-10-04-upgrade-preservation-fixtures.md

原设计两文档冻结。不得修改 GraphStore、application、contracts、ownership、迁移、desktop/native/UI、package/lock、其他测试或共享记录。若真实失败需要核心修正，先记录具体复现、原始预期、根因及建议边界交协调方，不自行扩大范围或删断言。没有新增依赖或公共 backup/helper API，两个测试不互相导入私有实现。AGENTS 本切片冻结，候选经验仅记录供 root 判断，允许零条。开发方不 Git 收尾。

## 行为和资源门

按已接受设计选择结构兼容夹具而非逐版本排列：raw legacy/pre-activation/pre-ignore、schema9/10 代表结构、当前11 的 ready/not-evaluated/无胶囊历史、混合 global+两个 project。重建结构注明兼容夹具，不宣称来自某旧发行包。精确比较 raw payload、来源/范围、源码字节/hash、已有 migration/creation/activation 时间、引用/attempt/capsule/掌握度；只允许设计声明的补列和 end_line 兼容变化。以公开加载接口和第二次重开补充 SQL/integrity/FK 检查，不能只数行。

所有路径由测试自身 mkdtemp 创建，固定布局/生成标记/非联接检查，最多三库、每库16MiB、整组48MiB；不接受环境、CLI、userData 或真实项目输入。先关闭 writer 并保全整组原始 main/实际 sidecar 文件，再打开任何操作副本。保全包、迁移副本、还原副本分开且独占新建。原始源集及保全包 hash 在迁移/失败/重开后保持，失败无保护完成标记，不覆盖或清理其他目录。

WAL child 仅 graph 测试内固定内联代码，process.execPath、固定已安装模块与自有叶路径、Windows hidden/无 shell 字符串，child 不派生进程。ready5秒、阶段总15秒、终止与 close 额外5秒、仅该新测试25秒上限。确认事务 committed 后仅本轮 PID 的 taskkill /T /F；必须确认终止结果和实际 close 才复制，保持真实未 checkpoint WAL。main-only 负对照与完整集合独立恢复必须给出不同的提交记录结果，环境未满足则失败/未完成，不改成跳过通过。取消/启动错误/超时/异常退出/杀进程失败均关闭成功资格；未确认退出则保留受控根、不删持有文件。finally 释放本轮句柄/timers/listeners。覆盖预取消及 IPC 前等待失败等有意义资源负例，不能仅以模型模拟代替实际 WAL 正例。

在操作副本执行固定 version10/11 trigger 故障、BEGIN IMMEDIATE busy、未来标记与角色错配；记录真实现状及缺口，允许测试明确断言已知现状，但不能把它标为保护门通过。多库失败须核对 global/A 早期提交与 B 被跳过以及可见 current；不包装测试事务遮蔽真实分段。生产失败关闭、原位自动还原、运行中备份和原生路径门留后续。

## 验证与独立接受

依次运行两个新定向测试、graph 整包、application 整包、两包 tsc --noEmit（命令见已接受设计）。仅普通 Node/SQLite 窗口，无 Electron/native rebuild/build/dist/GUI。每次失败如实分类，记录修正和再验证；不放宽原门或时限。冻结交付给出实际目录/HEAD、三个新增文件 hash、核心基线保持、实际命令结果及未验项。

root 待明确冻结后读取实际差异、独立运行适用回归/类型检查，并以自有原始包、WAL 和多库还原探针复核；不能以开发方报告接受。通过后仅精确集成本切片，按风险复验再 Git 收尾。没有产品 backup/自动升级或 GUI 验收，真实旧安装版本、生产数据保护、远程质量、安装升级卸载、签名/干净 Windows 与公开发布仍未验。

本计划是协调决策，不是工程经验；无新 AGENTS 条目。
