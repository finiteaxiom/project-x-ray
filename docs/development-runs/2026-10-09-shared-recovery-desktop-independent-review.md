# S3-C/D 实际 desktop 后台接线独立审查

仅原四批内共享恢复接线，依据 [实施边界](../plans/2026-10-09-shared-recovery-desktop-integration.md)。不启动第五批，不使用电脑操作、真实 GUI、实际凭据或 HTTP。暂不复制、提交此生产 desktop 切片；GUI及集成门仍保留。主 HEAD 为 `983045fb91d273be0a5503a54904bace4c335c59`，Sol HEAD 为 `455d4ad50830ee2495b70927e51caf830a4efbb8`，两开发聊天冻结。

## 本轮实际材料与源码核对

- 原 root 前像381文件，SHA256 `8DA9234F96E4771968C11E179C8B2BA9FECEEB28885BC9B20784BCC23036B820`。交付旧9/新7/原372保持、当前388；manifest `7C56CDCD789BB320FA1C6233F5352EFBFE91A5AE420CB6CCFB85452F369A5D77`，patch `B2AC37180D26795A90C4B6081975F90C13845DF4E41E0BF109EAD8F96CD9B2DF`。root逐文件核原始字节与当前hash，并在独立目录由381前像执行窄patch重建388文件，全部SHA精确一致，零换行归一化例外；反向check通过。独立重建回执在自有临时目录 `xray-root-desktop-reconstruct-4jmd15gy`。
- 实际入口仅一个XRayApplication/held恢复根；凭据policy仅provider/saveProvider有限视图；真正执行Worker在prepare前由可信factory创建并登记，同一实际子Worker接收最终canonical正文，执行入口不打开数据库。私有控制session/channel/owner/window/generation/sequence和固定budget严格校验。main实际传入私有channel，生产分支不走旧结构port恢复；原持久identity/createdAt/context/发布结果门保持。
- 宿主断线/异常退出只关闭入口并保留不确定T1及lease。退休先关旧操作/事件入口，原root等待真实子资源及底层pending结算；RPC进度不签发SQL恢复权限。正常加载与恢复仅已held实例分开。semantic仅私有composition，没有renderer/default HTTP入口。

## root已取得的独立结果

2026-10-09实际串行8文件：desktop-remote-coordinator、explanation-worker、remote-execution-worker、原broker/runtime/policy/credential/startup组合，94/94通过，38.49秒。真实Node宿主/执行子Worker及自有索引SQLite样例，非真实远程或GUI质量证明。原完成/取消/BUSY/身份/未知owner/提交切点和历史断言保留。

root将交付中的退休DTO反例扩展至完整broker.close之后，再核实际T1及lease逐值不变，1/1通过、20跳过，2.66秒；原反例及产品源码未改。ignored探针为Sol `.benchmarks/desktop-review/explanation-worker.review.test.ts`。第一次副本未解析workspace包，零测试；修正探针绝对导入后通过，属测试工具问题，不改产品或断言。

## 产物harness最小补接

原裸协议harness不能匹配新宿主。root读完整proposal后，仅授权原Sol修改remote-explanation.worker.test.ts私有session/sequence封装与自身记录，原三条业务断言、5000ms RPC、15000ms测试时限逐行保持。补接旧2/新0/原386字节不变、当前388。manifest `9704B03FD9530482ED08159B195319FBAA1D7C6EC7A6D6382DBD3882FCA2ED1E`，patch `D8478A2556812A2DA45153C3EBFE9A205A94B2D59982C408528E4969AA1094E6`；root核全388hash、两个改动范围、原断言/时限和反向check通过。开发noEmit只记开发证据，尚不记产物通过。

## 2026-10-10恢复与待完成检查

上次root原20文件组合会话7058无法再取回终态（Unknown process id），不能据启动、开发报告或未见错误称通过。恢复时全388冻结hash仍匹配；旧会话状态未决列为工具会话问题，未诊断为产品失败。重取完整组合，命令保持原20文件、maxWorkers=1、no-file-parallelism、no-cache，并排除ignored探针；输出和退出回执留在Sol `.benchmarks/desktop-review/original20-20261010.*`。完成前仍为待验。

root另已准备两用途×三布局原始workspace等待退休探针，尚未运行；四包及desktop noEmit、本轮正常desktop构建与原产物harness仍待实际结果。当前不开重型窗口，不并发测活动源；两开发聊天冻结。检查结果将追加，不用本记录替代运行证据。

## 2026-10-10最终独立结果

重跑原20文件串行组合已取得exit0：1047/1047，314.21秒；旧失效会话仍不补造结果。两用途×legacy/split/hybrid的原始workspace退休扩展6/6通过、9跳过，3.49秒：底层Promise未结算时退休未完成、同一实际子Worker已退出且正文发送0，结算后退休完成，原源码/答题/掌握历史不变。该扩展复用自有最小样例，产品及原正确断言未改。contracts/graph/application/llm/desktop五包原tsc --noEmit逐个串行全部exit0。

确认Sol仍idle/388文件冻结后，仅root打开一次重型技术窗口，执行原 `pnpm --filter @project-xray/desktop build`，正常tsup五入口及原copy脚本exit0。原artifact harness在desktop目录串行运行1/1通过，1.23秒，三条启动/provider/denied-state业务断言及原5000/15000ms保持。该脚本不观测OS/HTTP计数，只证明编译宿主启动与状态私有协议。

root另在自有Node fixture中require未改的实际编译remote-execution-worker入口，以fixture fetch守卫阻止任何网络，原严格拒绝用例7/7通过、1.57秒，守卫调用0。覆盖过期deadline、错误digest/bytes/purpose/canonical/credential及无默认semantic transport；仍是测试守卫下的编译入口验证，不是生产HTTP或模型质量。没有修改生产fetch、UI、隐私控件或凭据。

窗口已关闭，无本轮Electron/GUI启动。构建后重新核全部388源hash精确不变。Sol ignored `.benchmarks/desktop-review/root-final-evidence-20261010.json` 保存日志、退出回执、探针及实际产物hash，SHA256 `4C13593282AEB6876CB017A5CF951E68222882718BB05119E8295A578A1EC3C9`。实际构建main/explanation-worker/remote-execution-worker SHA256分别为 `23822C4F07B84E048863E6BABD1CD39871E20F390421F9103B715053C35D0E5B`、`490D6D79EF51A834C771A9A2B190D0D2AD7DD7093AF955B49474F4A7F187B59E`、`F57D965FCF6267A9E385CA82D650E61AF3F70C0A4DD17FF00D939C14AADE54DD`。产物不公开发布。

本切片后台源码、独立回归和上述本地Node产物技术门通过；生产desktop整体与GUI仍未验收。最终唯一17文件：旧10/新7/原371保持，其中追加旧harness1文件，原开发记录是此前新文件。没有为符合数量改其他文件。

## 下一项仍可推进的原四批工作

root实际比较主checkout与Sol：main目前没有explanation-broker/worker/policy/startup接线；main.ts差异集中于原B2 IPC/失效/单实例/退出和已验证私有宿主创建，preload仅两API，contracts仅两API成员及IPC两channel，desktop包仅已有workspace graph依赖及原凭据copy接入。contracts导出顺序、Sol Python缓存/导航observer/source-loan等其他差异不得整文件覆盖主目录。下一本地步骤为该已授权后台链的精确主目录集成和集成后技术回归；GUI前不提交生产接线，稳定进入主目录后才派Luna原1D UI。这是原四批依赖的实际缺口，不新增准备批次、产品能力或第五批。暂不派新的冲突开发，继续保持冻结。

## 未验收边界与规则

已实现、上述独立源码/回归、真实GUI和整批验收分别记录。真实GUI本轮0；生产正常远程发送/质量、实际OS凭据行为、Electron/Windows崩溃后的子资源关系及物理安全重开、完整reader/发布/签名/干净Windows均未验。宿主源码或Node样例不能提升这些门。主目录未集成该切片，无本轮产品提交/合并/推送；协调记录Git回执另核，不纳入旧B2六行WIP。四批仍有本地工作可推进，定时保持原ACTIVE/15分钟；收尾或只剩外部条件时暂停，不第五批。

AGENTS新增/修订0：实际资源停止、底层pending、身份及事务完整检查已有规则覆盖，harness包壳适配和会话失效未形成新的通用工程经验。
