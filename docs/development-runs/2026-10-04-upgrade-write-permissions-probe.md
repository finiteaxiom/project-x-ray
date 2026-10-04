# 4B-S1b-P：目标 HANDLE 权限隔离实验及清理修正

2026-10-04，开发-Sol，基线 HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`、分支 `codex/llm-explanations`。依据 [原计划](../plans/2026-10-04-upgrade-write-permissions-probe-plan.md) 与 [清理修复计划](../plans/2026-10-04-upgrade-write-probe-cleanup-fix-plan.md)。本轮仅原五文件及原唯一新 ignore 行；既有未提交内容保持。交付等待协调方独立审查，不是产品验收或整体实验通过。

## 当前结论

**计划要求的“只读目录 HANDLE 直接创建子项应被拒绝”仍未通过。** Node 24.17.0 与真实 Electron 44.4.3 均以只读目录掩码 `0x001000a1` 成功创建子目录：Nt=0、Info=2 (FILE_CREATED)。两个修正后的原 CLI 均退出 1、passed=false、readOnlyCreateDenied=false，native outcome 保留 `READ_ONLY_CREATE_ASSUMPTION_FAILED`。不删断言、不 skip、不改为绿色；这反驳本机条件下的 API/设计假设，不是 ACL 绕过证据，也不是当前产品新增接口漏洞。

其余 API 检查均通过：相对重开同一写根、两掩码空/大文件逐块写/flush/定位/完整读回/EOF/hash、普通 HANDLE 分享拒绝、重复创建碰撞且字节/ID不变、目录重命名拒绝、checked close、立即重占用、junction no-follow 属性拒绝、sentinel 不变。**当前 fixture 全部保留，不执行删除。** cleanup=`RETAINED_NO_DELETE` 与四项 child/handle closed=true 分别报告：文件保留不等于句柄仍占用；句柄释放不授权递归删除。

完整已知 native 序列结束时 experimentFinished=true 只表示实验流程结束，passed 仍为 false。意外 native outcome（例如 IDENTITY_CHANGED）被固定错误 `NATIVE_NORMAL_OUTCOME_REJECTED` 拒绝：exit2、experimentFinished=false，不进入 junction 阶段，不把已填正面行当成完整结果。报告仍保留实际已观察的局部行和关闭状态。

## 失败 → 根因 → 修正 → 实际再验证

初稿的 generic 掩码省略显式 SYNCHRONIZE，在同步 NtCreateFile 重占用时返回 `0xC000000D` / 3221225485 (STATUS_INVALID_PARAMETER)，后续用例未完成。按照 [NtCreateFile 同步选项要求](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) 加入显式 SYNCHRONIZE 后重建和重跑通过；这是测试配置缺陷，specific 最小掩码从未扩大。specific flush 在本机成功，但不据此忽略 [FlushFileBuffers 文档的 GENERIC_WRITE 前提](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)，不承诺其他 Windows 环境或断电恢复。

首次 import 检查把 Node 加载器 realpathSync 也替换为抛错，导致模块执行前失败；属于测试方法问题，后来改为监测模块实际创建/删除、child 和 addon 加载。普通 import 的新 Node/真实 Electron 结果见下。

协调方对旧冻结稿独立运行后发现**已确认的工具安全缺陷**：checkOwned 只确认根 ID/范围/全树无 reparse，随后 fs.rmSync(recursive:true) 会删除未登记普通 child。协调方在自己生成的 target parent 注入 root-review-unknown-child.bin，真实旧 rm 删除它，harness 仍报 REMOVED_VERIFIED_OWN_FIXTURE；无用户文件，但违反未知对象保留门。详见 [独立审查](2026-10-04-upgrade-write-permissions-independent-review.md)，该文 hash `3F5BDA4E66745AC596ADE77C716BD22EB1AAA03BCECAF4392C08D50BFF5A67A9`，修复计划 hash `BEAD8FBFDBADCD588AE0B59F236C1DF9AF26295FB153909CF2817060E0045C7C` 均实际核对，保持只读。旧记录中的“根身份/no-reparse后删除已验证 fixture”结论撤回；它不足以证明全部子项归属。

修正没有用枚举后 recursive rm 替代旧检查。CLI 删除全部 checkOwned/noReparse/recursive rm/unlink 与失败清理回退，正常和失败都默认保留。唯一新 native 修改是 junction 阶段打开固定 `junction-data`，normal 仍为 `data`：同一次 mkdtemp 内分别准备固定目录，在任何 native 运行前建立 junction，正常 target tree 原封保留，完全消除“先删除正常材料才能安装 junction”的需求。binding/build/ignore 无需改动，维持前稿 hash；因为 native 一行改动，只重建隔离新 target。

顺带补终态门：child phase 必须对应当前请求；runtime/version 必须等于当前目标与已安装版本；每阶段 container 完整 ID 必须等于本轮首次记录；normal 仅接受完整正常序列的 EXPERIMENT_COMPLETED+denied=true，或已知 API 假设失败 READ_ONLY_CREATE_ASSUMPTION_FAILED+denied=false。意外失败一律部分结果，不生成 experimentFinished=true；junction 仅接受 REPARSE_REJECTED。

## 隔离与资源边界

仅 Windows 固定本地 NTFS，复用已安装 desktop node-gyp、N-API 和 Windows SDK bcrypt.lib（平台 SHA256，不新增 npm 依赖）。实际卷 HANDLE 逐组件 RootDirectory no-follow，属性/完整卷序列号及128位 ID检查，保留所有祖先、父目录、read root 到 write root/targets 关闭；write root 相对同父重开，不通过绝对路径、DuplicateHandle、ReOpenFile 或 CRT fd 桥接。目录分享读写、不分享删除，payload share=0；所有实际 OS HANDLE CloseHandle 与 CNG hash/provider close 返回均检查，不用 GC 正常清理。

每个原 CLI 一次 mkdtemp，prefix 仅限制测试目录，不是生产归属。固定 `data/source-sentinel.bin`、`external/external-sentinel.bin` 为本轮自有内容，native 不打开、不读入、不改写；harness 前后只读 hash。材料为 `data/upgrade-preservation/op-specific|op-generic/00000000.bin|00000001.bin`；negative parent 为独立 `junction-data/upgrade-preservation`，指向自有 external。连已确认 junction 本身也保留，没有通用删除接口。CLI 报 fixtureName（不报私人绝对路径）及实际容器 ID，供独立复验定位。

Build 300秒上限；每个 CLI 全程共用60秒 child deadline；ready 5秒，终止后 close 确认另限5秒。SIGINT/SIGTERM/deadline 只处理本轮 spawn PID；关闭未知和部分结果继续保留 fixture。同步实验在独立技术 child，无 BrowserWindow，无产品 GUI。超时/取消/CloseHandle 失败分支本轮仅静态检查，**未注入实测**；实际正常关闭与立即重占用有证据。

## 修正后的实际命令及 API 矩阵

从本 worktree 根运行：

```powershell
node --check packages/graph/scripts/windows-upgrade-write-probe.cjs
node --check packages/graph/scripts/build-windows-upgrade-write-probe.cjs
node packages/graph/scripts/build-windows-upgrade-write-probe.cjs
node packages/graph/scripts/windows-upgrade-write-probe.cjs --node
node packages/graph/scripts/windows-upgrade-write-probe.cjs --electron
```

两个 syntax check exit0；隔离构建 exit0/WRITE_PROBE_BUILD_OK，约6.96秒。两个原 CLI 均 exit1（必要 API 假设红门），不是测试方法失败。Node normal/junction=82/52ms，Electron=139/101ms。Electron 是既有真实 electron.exe、移除 ELECTRON_RUN_AS_NODE 的隐藏无窗口进程；实际结果 runtime=electron/version=44.4.3，不是从 GUI exe 空输出推断成功。

| 检查 | Node24.17.0 | Electron44.4.3 |
| --- | --- | --- |
| normalOutcomeAccepted | true，已知 API 假设失败终态 | 同左 |
| read-only 创建应拒绝 | **false：Nt=0/Info=2 实际成功** | **同左** |
| 同父相对重开写根 | Nt=0/Info=1，完整 ID 相同 | 同左 |
| parent 归属 | FILE_CREATED 实际 ID；随后同 ID FILE_OPEN | 同左 |
| 两个新 operation | FILE_CREATE Nt=0/Info=2 | 同左 |
| 重复 operation/payload | 6次 Nt=0xC0000035/3221225525 | 同左 |
| 另一普通 HANDLE 读/写/删除 | 12次 Nt=0xC0000043/3221225539 | 同左 |
| root/parent/两个 operation rename | 4次 false/Win32=32 | 同左 |
| 关闭后立即重占用 | 4次 Nt=0/Info=1，完整 ID 不变 | 同左 |
| 普通 OS close | 21次 true/Win32=0 | 同左 |
| CNG close | 24次、失败0 | 同左 |
| junction | 打开 Nt=0/Info=1，属性 REPARSE_REJECTED；9次OS close成功 | 同左 |
| sentinel 前后 | normal+junction 后 source/external hash不变 | 同左 |
| 总 payload | 6,291,490 bytes，小于8MiB | 同左 |
| resources | normal/junction childClosed、handlesClosed 四项true | 同左 |
| cleanup | **RETAINED_NO_DELETE** | **同左** |
| experimentFinished / passed / exit | true / false / 1 | 同左 |

目录 read/write mask `0x001000a1` / `0x001000a7`。文件 specific=READ_DATA|WRITE_DATA|READ_ATTRIBUTES|SYNCHRONIZE|DELETE (`0x00110083`)；generic=GENERIC_READ|GENERIC_WRITE|SYNCHRONIZE|DELETE (`0xc0110000`)。下表 Write为调用次数/总实际字节，Flush=BOOL/Win32，Seek=BOOL/Win32/位置，Read=总字节/精确EOF；所有创建 Nt=0/Info=2，逐块实际等于请求，WriteFile BOOL=true/Win32=0。大文件25次：24×131072+17；空文件一次0-byte WriteFile。collision后再次完整读回与hash/ID比较。

| Runtime | Mask | Size | Write | Flush | Seek | Read | Hash | collision 字节/ID不变 |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| node | specific | 0 | 1/0 | true/0 | true/0/0 | 0/true | same SHA256 | true |
| node | specific | 3145745 | 25/3145745 | true/0 | true/0/0 | 3145745/true | same SHA256 | true |
| node | generic | 0 | 1/0 | true/0 | true/0/0 | 0/true | same SHA256 | true |
| node | generic | 3145745 | 25/3145745 | true/0 | true/0/0 | 3145745/true | same SHA256 | true |
| electron | specific | 0 | 1/0 | true/0 | true/0/0 | 0/true | same SHA256 | true |
| electron | specific | 3145745 | 25/3145745 | true/0 | true/0/0 | 3145745/true | same SHA256 | true |
| electron | generic | 0 | 1/0 | true/0 | true/0/0 | 0/true | same SHA256 | true |
| electron | generic | 3145745 | 25/3145745 | true/0 | true/0/0 | 3145745/true | same SHA256 | true |

空文件 expected/read/collision hash 均 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；大文件均 `fe2aaf82bfa2ffec207a0c6fa7ce7d4af268d67e2672fdaec675f3f9b65d0854`。原 CLI JSON返回每块请求/实际/BOOL/Win32、Nt数值、flush/seek、完整身份、checked close；记录汇总相同成功行，不保存原始材料字节或重复长日志。

| Runtime | Object | volume serial:128-bit FileId | Attributes |
| --- | --- | --- | --- |
| node | containerBinding | `3056e6bb56e680c8:1af80000000088010000000000000000` | 16 |
| node | readRoot | `3056e6bb56e680c8:b443080000005f000000000000000000` | 16 |
| node | writeRootReopen | `3056e6bb56e680c8:b443080000005f000000000000000000` | 16 |
| node | parent | `3056e6bb56e680c8:6b440800000046000000000000000000` | 16 |
| node | operationCreate/specific | `3056e6bb56e680c8:6c440800000034000000000000000000` | 16 |
| node | targetIdentity/specific/0 | `3056e6bb56e680c8:0045080000002d000000000000000000` | 32 |
| node | targetIdentity/specific/3145745 | `3056e6bb56e680c8:0145080000002a000000000000000000` | 32 |
| node | operationCreate/generic | `3056e6bb56e680c8:02450800000020000000000000000000` | 16 |
| node | targetIdentity/generic/0 | `3056e6bb56e680c8:10450800000019000000000000000000` | 32 |
| node | targetIdentity/generic/3145745 | `3056e6bb56e680c8:1145080000000f000000000000000000` | 32 |
| electron | containerBinding | `3056e6bb56e680c8:1245080000000e000000000000000000` | 16 |
| electron | readRoot | `3056e6bb56e680c8:1945080000000e000000000000000000` | 16 |
| electron | writeRootReopen | `3056e6bb56e680c8:1945080000000e000000000000000000` | 16 |
| electron | parent | `3056e6bb56e680c8:21f6080000001c000000000000000000` | 16 |
| electron | operationCreate/specific | `3056e6bb56e680c8:2df6080000001e000000000000000000` | 16 |
| electron | targetIdentity/specific/0 | `3056e6bb56e680c8:2ef6080000001d000000000000000000` | 32 |
| electron | targetIdentity/specific/3145745 | `3056e6bb56e680c8:31f6080000001f000000000000000000` | 32 |
| electron | operationCreate/generic | `3056e6bb56e680c8:32f60800000020000000000000000000` | 16 |
| electron | targetIdentity/generic/0 | `3056e6bb56e680c8:39f6080000001f000000000000000000` | 32 |
| electron | targetIdentity/generic/3145745 | `3056e6bb56e680c8:3ef6080000001e000000000000000000` | 32 |

目录属性16，payload属性32。最新普通 fixtureName分别 `project-xray-write-probe-JkpkW0` / `project-xray-write-probe-95aa1O`，文件保留；额外验证 app 位于本轮 Node fixture 内，同样保留。

## 两个有针对性的回归

未知普通 child 是**真实文件系统注入**：独立 Node-e wrapper在真实normal child结果已确认closed后、junction执行前，向本轮 target parent创建固定root-review-unknown-child.bin，不属于native生成/归属列表；前后核对Node bigint stat的dev/ino/birthtimeNs/size以及完整SHA256。该Node元数据标识不是完整128位FILE_ID_INFO，也没有用于删除授权；根容器仍核对native完整ID。文件35 bytes，hash `79e449f58c83bfe544f1dbe43e19a3e19e5ab51baaa5675b580d223f41007f45`。两个runtime均内容/标识保持、deleteCalls=0、cleanup=RETAINED_NO_DELETE，原实验exit1与四项资源closed=true不变；wrapper断言自身exit0。没有把“缺失”改为预期。

终态回归是**边界故障注入**，不声称真实OS身份已改变：真实normal实验完整完成且关闭后，wrapper只把传回JSON的outcome改为IDENTITY_CHANGED，保留所有正面行。两个runtime均拒绝：原run exit2、failure=NATIVE_NORMAL_OUTCOME_REJECTED、normalOutcomeAccepted=false、experimentFinished=false、junction未启动；文件保留、normal句柄已关闭。wrapper断言自身exit0。

以下为实际执行的限定wrapper与命令，未新增仓库测试脚本：

```powershell
$probeRegression = @'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const runtime = process.argv[1], test = process.argv[2];
let injected = false, file, before, report, deletes = 0;
const realSpawn = cp.spawn, originalWrite = process.stdout.write.bind(process.stdout);
function check(ok) { if (!ok) throw Error('FIX_REGRESSION_FAILED'); }
function fingerprint(p) { const s = fs.statSync(p, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), birthtimeNs: String(s.birthtimeNs), size: String(s.size), hash: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }; }
for (const name of ['rmSync','unlinkSync','rmdirSync','renameSync']) fs[name] = () => { deletes++; throw Error('FORBIDDEN_DELETE'); };
cp.spawn = (exe, args, options) => {
  const child = realSpawn(exe, args, options);
  if (args.at(-1) === 'normal') {
    const emit = child.stdout.emit.bind(child.stdout); let pending = '';
    child.stdout.emit = (event, ...values) => {
      if (event !== 'data') return emit(event, ...values);
      pending += values[0].toString('utf8');
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        let line = pending.slice(0,end); pending = pending.slice(end+1);
        if (line.startsWith('WRITE_PROBE_CHILD_RESULT ')) {
          const data = JSON.parse(line.slice('WRITE_PROBE_CHILD_RESULT '.length));
          check(data.phase === 'normal' && data.probe.closed === true);
          if (test === 'unknown') {
            file = path.join(args[2], 'data/upgrade-preservation/root-review-unknown-child.bin');
            fs.writeFileSync(file, 'self-owned unknown-child regression', { flag: 'wx' });
            before = fingerprint(file);
          } else {
            check(test === 'outcome');
            data.probe.outcome = 'IDENTITY_CHANGED';
            line = 'WRITE_PROBE_CHILD_RESULT ' + JSON.stringify(data);
          }
          injected = true;
        }
        emit('data', Buffer.from(line+'\n'));
      }
      return true;
    };
  }
  return child;
};
process.stdout.write = (text, ...rest) => {
  if (String(text).startsWith('{"scope"')) { report = JSON.parse(String(text)); return true; }
  return originalWrite(text, ...rest);
};
(async () => {
  await require('./packages/graph/scripts/windows-upgrade-write-probe.cjs').run(runtime);
  check(injected && deletes === 0 && report.cleanup === 'RETAINED_NO_DELETE' && report.passed === false);
  if (test === 'unknown') {
    check(JSON.stringify(before) === JSON.stringify(fingerprint(file)));
    check(report.experimentFinished === true && report.verdict.readOnlyCreateDenied === false && process.exitCode === 1);
    check(Object.values(report.resources).every(x => x === true));
  } else {
    check(report.failure === 'NATIVE_NORMAL_OUTCOME_REJECTED' && report.experimentFinished === false && process.exitCode === 2);
    check(report.verdict.normalOutcomeAccepted === false && report.junction === undefined);
    check(report.resources.normalHandlesClosed === true && report.resources.junctionHandlesClosed === null);
  }
  originalWrite(JSON.stringify({ test, runtime: report.normal.runtime, version: report.normal.version, injected, unknownUnchanged: test === 'unknown' ? true : null,
    unknownIdentity: before, deletes, originalExit: process.exitCode, cleanup: report.cleanup, experimentFinished: report.experimentFinished, failure: report.failure,
    resources: report.resources, fixtureName: report.fixtureName })+'\n');
  process.exitCode = 0;
})().catch(() => { originalWrite('FIX_REGRESSION_FAILED\n'); process.exitCode = 3; });
'@
node -e $probeRegression -- --node unknown
node -e $probeRegression -- --node outcome
node -e $probeRegression -- --electron unknown
node -e $probeRegression -- --electron outcome
```

| 回归 | Runtime | wrapper exit | original run exit | 结果 |
| --- | --- | --- | --- | --- |
| unknown child | Node | 0 | 1 | 内容/标识保留、0删除 |
| unknown child | Electron | 0 | 1 | 同左 |
| unexpected outcome | Node | 0 | 2 | 固定拒绝、partial、junction未启动 |
| unexpected outcome | Electron | 0 | 2 | 同左 |

未知文件Node inode分别8162774325196389 / 5629499534803064，dev均1457946824，birthtimeNs分别1791070592401875600 / 1791070594156911600；前后相同。四个回归fixtureName分别project-xray-write-probe-dnNC7j / Qnvcy5 / rDhmjq / QcjWqH（后三个保留相同完整prefix），均保留，不将验证材料删除。

## 普通 Node / Electron 应用 import

在本轮已保留Node fixture（核实际容器ID）写一个自有独立import-app.cjs，以它作为**另一应用入口**分别spawn真实Node和真实Electron；require两个新CLI/build模块前，拦截创建/删除/rename、spawn与.node加载。两应用均exit0，runtime/version分别node24.17.0 / electron44.4.3，effects=0；不是只重入原CLI argv模拟other app。app脚本为自有验证材料，不是导入用户项目代码；没有新增仓库文件或删除材料。

实际命令：

```powershell
$probeImportVerification = @'
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), cp=require('node:child_process');
const root=path.join(fs.realpathSync(os.tmpdir()), "project-xray-write-probe-JkpkW0");
const probe=require('./packages/graph/native/upgrade-write-probe/build/Release/windows_upgrade_write_probe.node');
function check(ok){if(!ok) throw Error('IMPORT_VERIFICATION_FAILED');}
function identity(){const x=JSON.parse(probe.run(root,'identify'));check(x.closed&&x.outcome==='EXPERIMENT_COMPLETED');return x.rows.find(r=>r.test==='containerBinding').id;}
check(identity()==="3056e6bb56e680c8:1af80000000088010000000000000000");
const script=path.join(root,'import-app.cjs');
const source = `const fs=require('node:fs'), cp=require('node:child_process'), Module=require('node:module');
let effects=0;
for(const key of ['mkdtempSync','mkdirSync','writeFileSync','rmSync','unlinkSync','rmdirSync','renameSync']) fs[key]=()=>{effects++;throw Error('IMPORT_EFFECT');};
for(const key of ['spawn','spawnSync']) cp[key]=()=>{effects++;throw Error('IMPORT_EFFECT');};
Module._extensions['.node']=()=>{effects++;throw Error('IMPORT_ADDON_EFFECT');};
require(process.argv[2]);require(process.argv[3]);
if(effects) throw Error('IMPORT_EFFECT');
process.stdout.write(JSON.stringify({runtime:process.versions.electron?'electron':'node',version:process.versions.electron||process.versions.node,effects})+'\\n');
if(process.versions.electron)require('electron').app.exit(0);
`;
fs.writeFileSync(script, source, {flag:'wx'});
const targets=[path.resolve('packages/graph/scripts/windows-upgrade-write-probe.cjs'),path.resolve('packages/graph/scripts/build-windows-upgrade-write-probe.cjs')];
for(const exe of [process.execPath,path.resolve('apps/desktop/node_modules/electron/dist/electron.exe')]){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=cp.spawnSync(exe,[script,...targets],{env,windowsHide:true,timeout:60000,encoding:'utf8'});
 check(result.status===0&&!result.error);
 const report=JSON.parse(result.stdout.trim());check(report.effects===0);
 console.log(JSON.stringify({test:'ordinary-app-import',...report,exit:result.status}));
}
check(identity()==="3056e6bb56e680c8:1af80000000088010000000000000000");
console.log('IMPORT_APP_RETAINED_NO_DELETE');
'@
node -e $probeImportVerification
```

该命令使用本轮保留fixtureName和ID，重跑普通CLI会生成新唯一fixture；独立审查者应使用其当前运行得到的fixtureName/完整ID，不能把旧nonce当生产认证。原命令应用脚本flag=wx防覆盖，已经运行过的固定app文件不重复覆盖。

## 冻结范围和 hash

| 文件（相对packages/graph） | 当前SHA256 |
| --- | --- |
| native/upgrade-write-probe/windows_upgrade_write_probe.cc | 3AA35588D1075D49CE69AD3FC225471E2A92F7328EEE844A83E5CD24C5F5553D |
| native/upgrade-write-probe/binding.gyp | 6AA1A2762428C731A16BDCE835B1D0EE8B226729396E36B7FACC29FB381342D3 |
| scripts/build-windows-upgrade-write-probe.cjs | 08BD8A617B55CC5419395B31C991C327AE53880671B2718205A8E66DDC60CA61 |
| scripts/windows-upgrade-write-probe.cjs | 223388BD7CB3FA0ADBCA7EC68EEF91601F2661AF17DD1C4944EF4536185252D1 |

本记录hash在最终交付给出。唯一既有ignore行仍 `/packages/graph/native/upgrade-write-probe/build/`，整ignore hash `DF68758939E2FE9F238A5644FCEB90ED53923E0289ACE2C95B28A8392E0416E1`。binding/build/ignore与上轮冻结值完全一致。native仅固定junction子目录选择一行改变；CLI/本记录其余修正如上。没有修改S1a、core/UI/AGENTS/package/lock、两旧设计或只读root审查/计划，没有Git收尾、整应用/旧target构建或旧suite复跑。

## 限制与规则评估

ACL拒绝未实验；真实file symlink既有EPERM门未验，junction不能替代。取消/timeout及close失败仅静态检查；没有生产writer/source-loan、manifest/marker、材料重开/恢复、SQLite/启动/GUI、安装升级卸载、签名、干净Windows或外发实验。后续仍需具体计划。

**AGENTS新增0条**，按范围冻结。保留只读RootDirectory不能推定创建拒绝的既有候选；另仅向root提出待独立确认候选：未知普通child与reparse同样不能由根ID/全树无reparse证明本轮归属；工具默认保留，清理必须按本次真实创建HANDLE与完整ID逐项处置，不能枚举后recursive rm。这与既有路径竞态规则相关，但清理门应由root去重整合，不在本worktree写公共规则。依据是协调方真实删除反例与本轮未知文件保留回归；过程/规则不替代独立验收。
