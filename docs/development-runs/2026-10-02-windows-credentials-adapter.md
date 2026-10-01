# 1C-2B-2A：Windows 凭据适配器与隔离验证工具

## 授权、基线与限制

固定 Sol worktree；实施前分支codex/llm-explanations，HEAD为a50d7ab2e13dd463ed9e1c0b8348dc1c9925b589，工作区干净。已核对AGENTS、接受的ADR0007及计划当前2B-2A边界。只开发固定自有target的状态/写/删/内部读取、独立编译与复制工具，以及隔离测试工具；不接main/preload/worker/broker/UI，不修改provider/application/graph/contracts/analyzer或公共协调记录。

执行窗口只允许纯TS/脚本测试、类型检查及offline/ignore-scripts依赖链接。新凭据原生模块的编译、实际Node/Electron/OS验证留给协调方，不能用源码或纯端口测试代替。没有用户API key，不索取、不扫描生产凭据/其他target，也不配置网络、证书或安全设置。

## 实现

- desktop声明已有同版本node-gyp12.4.0 devDependency。平台TS/fetch不能调用Win32凭据API，而现有node-gyp可编译NAPI，无需新runtime/SDK/FFI依赖；lock仅desktop importer三行，不借其他包私有node_modules。
- binding.gyp输出两个独立NAPI8文件：windows_credentials.node固定production target；windows_credentials_test.node编译期固定`com.projectxray.desktop/openai/api-key/v1/test`。生产target固定`com.projectxray.desktop/openai/api-key/v1`。参数、renderer和环境均不能选择target，无枚举接口。两个模块只在初始化时注册函数及只读variant标记，初始化不调用Win32凭据API。
- native仅用CRED_TYPE_GENERIC/CRED_PERSIST_LOCAL_MACHINE和Advapi32。写入接收Buffer，先把有界输入复制进自持栈缓冲，再验证该副本并调用CredWriteW，避免验证与实际写入读取不同字节。应用上限1–2048 bytes，static_assert与wincred.h实际CRED_MAX_CREDENTIAL_BLOB_SIZE比较。MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS)拒绝非法UTF8；控制字符规则与现有key契约一致，不截断或改编码。
- 原生自持字节缓冲通过RAII在正常、失败、NAPI结果创建失败路径SecureZeroMemory；临时UTF16校验视图也清零。CredReadW分配持有者在返回前清零blob并CredFree。napi_create_buffer_copy复制到运行时拥有的Buffer，不把Win32分配或临时栈指针暴露成external；回包属性创建失败时清零已建Buffer。此实现没有async work、external裸指针或跨回调借用，因此不依赖GC finalizer来清理Win32分配。上述原生路径仍需编译/运行验证。
- TS窄可信port仅供未来解释worker内部构造。公开状态只有availability/configured，写/删只有固定枚举；readInternal才返回临时credential，不新增IPC或getter。缺模块、错误variant、权限/编码/平台/协议失败均unavailable，不回退文件、SQLite、safeStorage或环境。生产factory无参数、只加载固定dist/native生产文件；测试variant拒绝调用。没有实现credentialRevision、跨库changing/unavailable事务或主进程权限；这些属于2B-2B。
- TS校验UTF8字节、控制字符和孤立UTF16 surrogate，后者必须在Buffer编码替换前拒绝。读取用fatal TextDecoder验证编码；所有自持写入/读取及异常回包Buffer在finally清零，未知字段/访问器/错误code失败关闭，不调用秘密getter或输出异常文本。JS字符串无法保证抹除，adapter不缓存key，但这不是内存擦除保证。
- build工具只调用desktop声明的node-gyp，目标是本desktop新native/build；预先核对realpath，拒绝目录联接逃逸与额外参数。copy工具不触发build，只加载固定生产文件核对variant，再复制到dist/native；拒绝source/destination逃逸、重命名测试variant及已有测试模块，绝不复制测试文件。普通dev/build/pretest/tsup均未接这些步骤。
- Node smoke只加载固定测试文件。缺失检查与独占本工具lock成功后，使用自建非秘密ASCII、多字节及2048-byte边界值；每种写→读→重启子进程核对，随后测试空/超限/控制字符/非法编码拒绝，再删→缺失。子进程只读并核对固定样例，无写删。异常清理仅在读取值与本轮待写/已写样例精确一致时删除；已有测试target或lock拒绝，changed/unknown值留存且失败，不删除其他run值。所有输出是固定码，不打印内容或子进程异常日志。
- Electron smoke是独立运行入口，由Node启动实际Electron，再由Electron启动核对子进程；不能拿Node执行代替Electron。没有BrowserWindow、安全设置变化或生产target操作。替身仅通过内部脚本/TS测试构造注入，CLI没有任意path/target/native/provider输入。

## 官方依据

已打开核对[CredWriteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew)、[CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw)、[CredDeleteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-creddeletew)、[CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)、[CredFree](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credfree)及[SecureZeroMemory](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/legacy/aa366877(v=vs.85))。GENERIC blob由应用定义，Win32上限2560bytes，LOCAL_MACHINE限定同用户同设备，不等于防同用户恶意进程。

已核对[Node-API缓冲及生命周期](https://nodejs.org/api/n-api.html#napi_create_buffer_copy)：copy创建运行时拥有的新Buffer，不能依赖借用栈指针或原CredRead内存跨native调用。使用NAPI8不等于已通过当前Node/Electron或portable运行验收。

## 真实反馈与修正

1. 首次desktop tsc exit1、TS2339：私有native字段与this交叉类型守卫被约为never，属于本轮TS实现错误。改成返回NativeCredentialPort|null，并捕获局部port后调用；重跑exit0，没有放宽strict。
2. 首次两文件纯测试37 passed、exit0；同轮tsc exit1、TS2493：测试vi.fn零参数函数使mock.calls推断为空元组。给测试load/spawn添加实际窄参数类型，重跑纯测试及tsc通过。
3. 补子进程核对回归后测试通过，tsc exit1、TS2345：测试持有变量默认Buffer<ArrayBufferLike>，fake函数推断Buffer<ArrayBuffer>。保留Buffer.from局部类型并另存观察引用，重跑tsc通过，不修改生产类型或编码规则。
4. pnpm exec在manifest改变后自动同步已有workspace链接，输出Already up to date/跳过resolution；没有新凭据build目录或凭据原生执行。随后明确执行`pnpm install --offline --ignore-scripts --frozen-lockfile`，exit0，node-gyp已在desktop声明路径链接；后续直接使用node调用现有vitest/tsc，去除隐式pnpm步骤。没有执行安装生命周期/native/build。
5. 范围偏差已主动报告：曾把上一批remote-provider.test.ts纳入同轮55项回归。其真实索引样例使用已有SQLite/安全读取依赖，超出了本批纯TS/脚本验证窗口。这不是凭据原生验证，也不将该55项作为本轮冻结计数；后续删除该测试组合，只重跑本批纯测试。未编译或加载新凭据addon，未运行实际Node/Electron凭据smoke。
6. 两次rg使用Windows路径中的shell通配符失败，属检查命令问题，改用目录与-g过滤核对；不作为产品缺陷或经验条目。native源文件编译及OS行为尚未执行，因此不编造原生失败→修正闭环。

### smoke写入后回包失败：工具产品缺陷

模拟正常native写入已成功，但创建JS回包抛错；原脚本只在收到ok后设置清理身份，无法清除已经写入的本轮值。纯端口复现命令在apps/desktop目录：

```text
node ../../node_modules/vitest/vitest.mjs run src/windows-credentials-scripts.test.ts -t 'write succeeds internally' --maxWorkers=1 --no-file-parallelism
```

exit1：1 failed、14 skipped（过滤器）。清理调用期望1、实际0，根因确认。修正为写入尝试前登记本轮样例，finally仍必须读取并精确匹配才删除；未知/更换值不删。增加回包失败清理回归，同时清零readMatches的临时比较Buffer。重跑两完整纯测试文件39 passed，desktop/contracts类型均exit0。该复现不等于实际NAPI分配失败/OS故障已经验收。

## 首次冻结已执行验证（独立审查后退回修正）

在apps/desktop目录执行：

```text
node ../../node_modules/vitest/vitest.mjs run src/windows-credentials.test.ts src/windows-credentials-scripts.test.ts --maxWorkers=1 --no-file-parallelism
```

2文件39 passed、exit0，无skip。TS adapter使用内存native端口，脚本使用显式fs/load/spawn替身，无真实module加载、子进程、凭据调用或生产读写。覆盖正常/空缺/编码/字节/控制字符/孤立surrogate、Buffer清零、未知字段/访问器/错误码、生产factory拒绝选项/测试variant、工具路径逃逸/编译参数/禁止测试打包、预存target/lock保护、重启子命令、写入后回包失败及其他失败清理和changed值保留、Electron独立启动协议。

在仓库根目录逐条执行：

```text
node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit
```

均exit0。生产新文件核对无process.env、CredEnumerate、console日志或普通存储回退；新native/build不存在。当前编译工具链接存在不等于已执行编译。

## 协调窗口：命令与安全目标

以下为原协调窗口命令；首次冻结时未执行，后续协调方的实际结果见下节。修正后的原Electron入口仍待协调窗口复验，不能以隔离wrapper通过替代。所有命令从仓库根执行；不运行普通desktop build/dev或portable，不对生产target做state/read/write/delete。

```text
node apps/desktop/scripts/build-credentials.cjs
node apps/desktop/scripts/credentials-smoke.cjs
node apps/desktop/scripts/credentials-electron-smoke.cjs
node apps/desktop/scripts/copy-credentials.cjs
```

编译只应产生desktop/native/build/Release下两个不同文件。Node/Electron工具先核对test模块的只读variant，再检查自有固定/test target，绝不加载生产凭据文件来执行操作。已有test target/lock要失败并人工核对，禁止先删；工具异常或发现值被更换时不可把“残留未清理”描述为成功。协调窗口应逐条保留exit码，并分别确认实际Node、实际Electron、重启及清理；编译通过不能替代OS验证。

copy只应加载production模块的初始化元数据，不调用四个凭据方法；dist/native只允许windows_credentials.node，不含test variant。若编译或runtime失败，保留源码和固定错误，不关闭门槛；没有任何可转为真实服务/凭据成功的替身结果。

## 精确文件清单与规则判断

修改3文件：apps/desktop/package.json（四个独立工具脚本与node-gyp dev声明）、pnpm-lock.yaml（desktop importer三行）、根.gitignore（后补授权：精准build目录及自有smoke lock条目）。

新增10文件：

1. apps/desktop/src/windows-credentials.ts
2. apps/desktop/src/windows-credentials.test.ts
3. apps/desktop/src/windows-credentials-scripts.test.ts
4. apps/desktop/native/windows_credentials.cc
5. apps/desktop/native/binding.gyp
6. apps/desktop/scripts/build-credentials.cjs
7. apps/desktop/scripts/copy-credentials.cjs
8. apps/desktop/scripts/credentials-smoke.cjs
9. apps/desktop/scripts/credentials-electron-smoke.cjs
10. 本记录。

首次冻结为12文件、39项纯测试及两包类型，已被独立审查退回。本轮无新增AGENTS规则：普通运行时验证已有要求，具体Electron主/verify ready时序进入共同实现和回归；不将主进程验证脚本的ready要求推广给无app的worker。未修改协调记录或其他checkout，不提交、推送或合并。下节明确独立结果、新冻结及剩余门槛。

## 协调方独立验收与三项修正

以下实际运行结果来自协调审查方2026-10-02交付的独立证据，不是开发方重新运行OS测试。协调方独立39项及desktop/contracts类型通过；实际node-gyp编译通过，Node固定/test target的ASCII/中文/2048字节、三个重启子进程、非法拒绝和清理通过；生产copy只调用初始化元数据、hash一致、dist无测试模块。未访问生产target。

### 构建产物未忽略：工程配置缺陷

实际编译后Git列出binding.sln、config.gypi、vcxproj/filters等生成文件。补充授权仅允许根.gitignore精准增加`/apps/desktop/native/build/`及`/apps/desktop/native/.credentials-smoke.lock`；没有删除构建目录或其他文件。

实际只读验证：

```text
git check-ignore -v apps/desktop/native/build/binding.sln apps/desktop/native/build/config.gypi apps/desktop/native/build/windows_credentials.vcxproj apps/desktop/native/.credentials-smoke.lock
git ls-files --others --exclude-standard apps/desktop/native
```

前条exit0，均命中这两条精准规则；后条exit0，仅列binding.gyp和windows_credentials.cc。源码仍可提交，没有用全局*.node/build规则隐藏其他范围。

### npm Electron入口隐式下载：工具产品缺陷

协调方实际观察到Node launcher的require('electron')在binary缺失时运行install.js下载，然后才进入120秒子进程超时；其内部安装spawnSync无timeout。旧launcher因此不能保证离线/有界启动。

修正为固定desktop自有node_modules/electron/package.json绝对路径，仅resolve元数据及读JSON，不执行npm包入口、不搜索环境/全局module路径。从真实package目录只接受dist/electron.exe与dist/version，核验binary存在、真实目录/文件边界、普通文件及版本相同；缺失、逃逸或版本不符立即固定失败。无ELECTRON_OVERRIDE_DIST_PATH、环境端点或下载安装回退。实际Electron分支仅用运行时内建electron.app，并核对process.versions.electron与安装版本；主进程脚本不会在Node中require npm入口。

纯回归覆盖缺binary、exe/dist/version逃逸、版本不符、非文件、实际runtime版本不同，断言零spawn和零npm entry load；正常launcher仅调用本地已安装exe，保留外层120秒timeout。

### Electron主与verify readiness：设计修正，早先对照未隔离入口变量

原入口实际Electron smoke超时120秒，固定exe直接--run也20秒ETIMEDOUT；通用whenReady后退出的probe成功，报告Electron44.4.3/Node24.21.0/NAPI10。不能从这个失败推断nativeABI错误。

协调方早先对照：只包主--run的whenReady仍status1；主和三个verify共同whenReady的无条件隔离wrapper通过，exit0、三个重启及清理、总计小于1秒。后来确认wrapper同时改变了CLI entry guard，而失败对照的verify仍被该guard跳过，因此这些结果未单独隔离ready变量。不能据此断言“子分支ready前退出”是已复现根因，也不能声称ready修正定位了全部挂起原因。共用ready设计仍保留，避免在初始化完成前执行同步测试/退出；它的纯时序回归与wrapper整体成功不能代替原入口验收。

修正：两类分支共用10秒ready等待；等待成功后才同步调用smoke并退出。ready失败/超时发一次固定failure；尚未ready时用process退出，已ready时app.exit，日志写入失败也不跳过退出。保留外层120秒、verify子进程30秒，不使用RUN_AS_NODE或其他伪造Electron模式。纯回归逐个检查--run、ascii/unicode/boundary verify在ready之前零操作，覆盖拒绝、超时和callback失败退出及成功一次退出。

本轮新增测试初次51项通过，desktop tsc因测试fake isFile推断literal true而TS2322失败。给fake函数明确boolean返回类型，重跑通过，没有改变生产边界。随后补实际runtime版本和日志异常退出回归，最终53项通过。

## 第二次冻结验证（原CLI入口仍被退回）

仍只运行纯替身测试与类型，未并行执行Electron/native/OS。使用上面同一两文件vitest命令：2文件53 passed、exit0、无skip；desktop/contracts两条独立tsc均exit0。旧39项保留为历史，不充作新结果；协调隔离wrapper成功也不替代最终原命令复验。

当时13文件（3修改、10新增），tracked及10个新增文件独立空白检查通过，范围没有扩展到普通build/UI/worker或其他core。Git HEAD保持a50d7ab2e13dd463ed9e1c0b8348dc1c9925b589；保留协调方构建产物，只通过精准ignore排除。此冻结随后因下述CLI入口问题退回，不将53项或wrapper成功改写为原命令通过。

### DefaultApp CLI entry：独立确认的入口缺陷与第三次修正

协调方独立53项/两包类型/check-ignore通过，但原Electron命令仍挂起。实际最小cjs显示Electron44.4.3 DefaultApp加载文件时require.main不等于module，尽管require.main存在；它在ready后退出成功。旧脚本用require.main===module作为唯一guard，直接跳过runElectronSmoke，主--run和verify均未执行，也没有测试lock。协调方只停止经PID/命令归属核对的本轮Electron，最终launcher固定失败exit1；没有生产凭据操作。

补充实际对照：协调方的ignored隔离wrapper无条件调用修正版导出的runElectronSmoke，并将三个childScript同样指向wrapper，实际Electron主/verify完整exit0、固定成功码，约1秒。该结果证明导出流程与测试native可运行，结合DefaultApp入口观察确认guard问题；它同时绕开guard，仍不能替代最终原命令。

修正仅在原script/tests/记录内：导出纯可测试isElectronSmokeEntry。Node沿用main guard；实际Electron不看main相等，而是将process.argv[1]与当前脚本__filename经绝对路径、realpath和Windows大小写规范化精确匹配。无效/不可核验/其他应用入口不运行；不能只因process.versions.electron存在而自动smoke。不接环境路径或任意target，保留本地exe版本验证、共同ready、固定失败与所有timeout。

回归用VM执行真实cjs顶层代码，显式替换全部模块/fs/process/子进程/凭据端口，模拟DefaultApp的main不相等：主--run及三个verify匹配入口成功并等待ready；其他Electron应用require和Node import零凭据/子进程操作、零package元数据读取；Node CLI仍走原main路径。另覆盖路径规范化、同名其他目录、无效入口及realpath失败拒绝。没有启动真实Electron或加载native。

### 第三次冻结：当前实际验证

同一两文件纯vitest命令：2文件61 passed、exit0，无skip；desktop/contracts两条独立tsc均exit0。13文件范围保持，tracked及10个新增文件空白检查通过，未修改其他core/GUI、未提交/推送/合并，HEAD仍a50d7ab2e13dd463ed9e1c0b8348dc1c9925b589。script、native、adapter、manifest/.gitignore、测试和本记录统一冻结。

当前：协调方实际Node/原生/copy及导出wrapper已通过；第三次修正后的原Electron CLI命令仍待协调方单窗口复验。portable、credentialRevision与安全worker/main接线、生产凭据和第一批E2E仍未验收。本轮无新增AGENTS规则，未单独隔离的ready因果不沉淀为已验证经验，已确认entry行为通过真实顶层回归防止重现。
