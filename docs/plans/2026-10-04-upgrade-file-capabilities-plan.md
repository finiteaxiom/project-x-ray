# 4B-S1a：Windows 闭库文件能力实施

2026-10-04，协调方。B0 两文档经实际源码及修订复审接受，生产打开仍未授权。P1：4B-A 已证实未来版本/角色没有现有拒绝门、跨库迁移可分段提交；原件字节保全必须先具有实际根句柄和整组拒绝共享访问能力。先交付独立可调用、在自有 Windows 文件上可验证的获取/读取/释放路径，再实施原始包写入。不能把内部能力交付称为完整 backup。

原开发-Sol，仅5170目录。主目录 f647b79；worktree 保留旧HEAD及全部改动，不整体同步。B0冻结设计 5F6AAACAC39759177C3A622CCF5A0E55D1C11DD3598B5E561B34B71EE2F2D874，记录 A2DE374352C6581914B1667DCD39F88D3ADE3280844CFA8C0426D26A86D894A6。原4B-A、B0、core、AGENTS、desktop/UI、package/lock均冻结。

## 精确文件范围

仅新增：

- packages/graph/native/windows_upgrade.cc
- packages/graph/native/windows_upgrade_fixture.cc（独立测试 target，产品 addon 不导出测试占用/映射接口）
- packages/graph/native/binding.gyp
- packages/graph/scripts/build-windows-upgrade.cjs
- packages/graph/scripts/windows-upgrade-capability-smoke.cjs
- packages/graph/src/windows-upgrade-files.ts
- packages/graph/src/windows-upgrade-files.test.ts
- docs/development-runs/2026-10-04-upgrade-file-capabilities.md

唯一已有文件例外：本目录 .gitignore 加一行 /packages/graph/native/build/，不改其余规则。无需package script或依赖/锁文件变更：显式运行新构建脚本，使用desktop已经声明的node-gyp 12.4.0，可显式require.resolve paths定位，不扫描环境/凭据。没有新npm运行依赖。现有source reader分享写/删除且2MB限制不可复用，故单独N-API target；不能修改或重建它。若需要额外文件先报告确切理由和边界，不创建通用框架。

## 能力与失败门

实现前记录准确私有接口及生命周期。目标路径是open trusted local NTFS root → 安全枚举/捕获布局候选 → 取得整组source lease → 从同HANDLE有界读取 → 重新核验集合/身份/大小 → 释放。原件零SQLite，不写源、不checkpoint，不扫描导入项目/生产userData；所有试验根由本次自建。

根路径只作bootstrap。从持有卷根逐级单组件相对打开并核属性/卷/128-bit FileId，固定本次root/必要目录，禁止reparse/cloud/network/设备/ADS/别名及跨卷。具体no-follow标志组合须本机试验确认；不能回退路径打开或仅startsWith校验。根/目录不共享删除；source每个已存在main/WAL/SHM/journal ShareAccess=0，read-data/attrs/synchronize，保持全组同时持有，任何成员占用失败释放整组。读取只从同原生层持有HANDLE进行，无Node fd跨CRT转换。

仅B0布局槽位及安全文件名候选，不认证repositoryId。global必须存在；legacy-only/projects缺失或空支持显式空集合。root非数据库Electron内容不读不递归，projects未知目录/额外数据库候选/孤儿sidecar/未知-mj集合拒绝。四类存在/不存在必须准确，拒绝不明/权限错误当missing。成员物理ID去重，既定排序，取得全组后以及读取后复核集合/身份/大小，absent变化拒绝；目录pin不能被描述为禁止子项增删。

lease是不序列化的私有能力，绑定operation/root/实际句柄，错root/错operation/已释放/GC对象拒绝。输入plain data严格捕获并验证，不保留调用者可变别名。只提供最大128KiB chunk read，offset/length/累计大小安全整数且有界，拒绝越界/短读/改变的文件；不会把20GiB读进一个Buffer。容量参数不得超过B0建议的10,000成员/20GiB，有限阶段计数及固定错误，不打印绝对路径/源码/字节内容。

异步native工作强napi_ref持有所有external，排队失败/完成/取消配对回收；pending close拒绝或延迟，root在leaf/group存活时不能提前关闭；close幂等语义明确。Abort/deadline是有限检查点上的请求，pending OS I/O未结束不假报已取消或释放句柄。单操作最多15分钟预算，单chunk完成后检查；不承诺同步OS I/O硬中断。回调错误不能掩盖原固定失败或留下成功lease。映射写入不在ordinary-win32-handles静止承诺内，实际自有映射反例必须明确报告，双hash不升级为全局停写。

结果仅file-capabilities，固定rawPackageCreated=false、restoreApproved=false、productionApproved=false。不写原始包/marker，不加SQLite profile/VFS/GraphStore/app startup/IPC/界面接线，不把metadata pin视作SQLite交接保证。下一S1b须另有目标写入/flush/不可变材料及退出切点计划。

## 实测与独立门

源码/严格类型可随实施运行。重型native构建/实际Electron技术检查当前单窗口分配Sol；执行前给出所用runtime/输出target，不同时运行旧build/dist/native或其他批次。root收到冻结交付后独立重复适用技术门。无computer-use/GUI。

脚本仅显式argv入口执行；其他require无副作用。构建不自动从模块导入或typecheck触发。命令建议：node packages/graph/scripts/build-windows-upgrade.cjs；node node_modules/vitest/vitest.mjs run packages/graph/src/windows-upgrade-files.test.ts --fileParallelism=false；graph tsc --noEmit；node packages/graph/scripts/windows-upgrade-capability-smoke.cjs；由实际现有Electron二进制直接执行同脚本。具体Electron argv识别核当前身份，不依赖require.main；不设置禁用安全的参数、不创建BrowserWindow。

正例：自有NTFS根、三库四类原始字节及空sidecar、>2MB分块精确读取/相同身份、legacy-only、释放后能重新占用、Node/Electron同addon真实运行。内容仅自有固定字节；真实SQLite活连接反例仅在自建测试库创建，不对源集合做迁移/恢复。

反例：现存普通read/write/delete HANDLE或实际SQLite连接占用（逐项）、全组后一个忙的释放、root/必要目录/leaf的替换及联接竞态、硬链接双槽、未知/孤儿/新增sidecar、成员变更/不存在性不明、容量/offset/文件大小越界、错lease/重复关闭、async queued GC、pending close、取消/异常清理。测试fixture只操作本次创建根；不得枚举其他进程或改系统安全设置。不能创建symlink时保留正确断言及EPERM未验边界，不靠skip改写通过。

独立测试target用于自有占用及持续映射试验，导入必须无副作用、显式绑定自建根；不得向renderer或公共graph导出。若验证用child，限本次PID、就绪/阶段/关闭有时限，未知close时保留owned根，绝不递归删未知路径。崩溃退出会由OS释放HANDLE，实测原内容/外部内容不变；该批没有marker/数据库包崩溃验收。

交付全部确切文件/hash、实际命令/结果及未验项；root独立对照原生实现、句柄/引用生命周期和真实runtime检查。AGENTS经验候选须实际复现且去重，可0条；在自身记录提建议，公共规则由root逐条集成。当前生产升级/GUI/远程/签名/干净机器门保持。如目标API实测无法满足安全门，交付固定失败及最小具体修正，不自动增加VFS/依赖/其他OS。
