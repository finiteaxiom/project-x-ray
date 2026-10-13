# M12 ASAR header 预检独立审查

## 当前结论

接受 M12 有界纯字节 header 预检与有限条目转换，已精确集成主目录。仅接受该纯本地能力，不接受原 HANDLE header 捕获、私有路径现有 parser 消费或完整 M2 reader。

## 来源、边界与源码审查

实际 work tree 2 完成 turn `01a13301-f951-7112-841d-95ead218fde2`、cursor `8d359a7f-715f-47f1-9e66-e99d6d25a383:14`。root独立枚举450文件，原447逐项与派发 hash 和完整 raw 相同，恰三新；HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8` 保持。M10/M11 两依赖逐字main一致；结构模块为main只读参考，未复制或新增依赖。安装 producer 三源码 hash 保持派发值，夹具入口固定已安装 asar3.4.1 pickle。

root审查实际生产转换及测试：类型/长度/SharedArrayBuffer/Proxy 拒绝在私有复制之前；声明长度在任何按其分配之前受到硬上限和实际材料长度约束；pickle布局/零padding与实际writer吻合。严格UTF8及scalar，有界JSON语法扫描在JSON.parse之前核每层解码后重复键；有限深度/节点/字符串。目录/文件/link与packed/unpacked字段互斥，offset规范整数、数据区范围及非空区间重叠门；目录标志输出仍为file=false/unpacked=false，不补造叶事实。own属性保留合法prototype名称；Windows路径/大小写冲突、条目/输出上限、安全固定错误及失败零部分输出保持。返回caller-bytes/header-only和incomplete/not-evaluated，未升级为verified源码事实。同步模块无候选执行、路径读取、解包或缓存。

## 独立实际回归与集成

- 5170：`pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-asar-header-preflight.test.ts`，26/26通过，350ms；desktop typecheck通过。
- 完整450 raw/hash冻结保存后，main556→559仅三新，旧556完整raw/hash保持，source450稳定。
- main：同定向套件26/26通过，341ms；desktop typecheck通过。测试后两个checkout源像重新核对保持。

来源原收据 `m12-asar-header-dispatch.json`；独立收据 `m12-independent.json`；精确集成收据 `m12-main-exact-integration.json`，均在忽略协调目录。数字只说明本次命令，不外推全套/GUI/实际生产归档验收。M11已接受门未重做；没有真实Windows HANDLE、native、build、dist、Electron或GUI操作，重型窗口closed。

## 限制与后续实际缺口

输入仍是caller字节，不是从已登记M10目标HANDLE捕获。私有路径parser消费、M11前后重新核验/缓存隔离仍未连接；packed内容、物理unpacked成员及来源身份均未验。sidecar父进程重开、完整manifest、安装签名运行、GUI/API/干净Windows等未验，四批仍未全部完成。本轮没有新增产品失败；开发记录中的测试类型/审计命令修正不伪装为产品修复。无新工程规则（既有有界输入、安全诊断及来源分层要求已覆盖），无Git提交/合并/推送，不第五批。员工保留冻结待命。
