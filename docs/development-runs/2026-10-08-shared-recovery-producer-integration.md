# S3-C 真实生产者接线：方案当轮记录

2026-10-08。只交付一次具体实施方案，不实施产品源码。范围仅本记录及 docs/plans/2026-10-08-shared-recovery-producer-integration.md；原377全部冻结。

## 检查与基线

开始前逐项核上一guard交付manifest SHA256 0DB42B90FF8F6675E4EAD8EC97ABA369BF7905AA9173984E736BCB605A6BD408，377/377当前字节匹配并复制原始前像。只读Git HEAD455d4ad50830ee2495b70927e51caf830a4efbb8、codex/llm-explanations，旧183项status记录保持，不reset/提交。main a8194ef4/0dfa0317及两目录922独立接受来自本轮已读root最新S3-C/H记录，未自行重跑测试/查询远程目标。

读取本checkout AGENTS、共享任务设计第6节、2026-10-06恢复实施方案（含派发后设计纠错）、实际broker/policy/main/worker/runtime、RemoteExplanationApplication、OwnershipSemanticApplication、原生capability/lifecycle/held locator、semantic reservation ledger/graph委派及实际L5 body/WeakMap准备；主目录S3-C/H独立审查记录只读。

## 源码判断与方案选择

确认现broker只有结构worker端口和单项retiring，terminate普通Promise/exited后仍旧feature恢复；main policy、worker policy、worker application是不同实例/连接。root的ownedTasks只在同步admit前后读取实际authority，postMessage/RPC不能替代它。B2 prepare/reserve在Worker生成前，start/cancel/read局部计数不涵盖全用途。B2 ledger publish多个真实await后的实际append不能由外层operation单独阻断。这些是当前源码接缝判断，没有执行新运行反例，不声称本轮已验证生产缺陷。

方案选定两阶段真正执行Worker在prepare前由原root.create登记；保留原native全域证明/SQL/source算法，不新增“空资源证明”。同一实际application authority内同步reserve产生准确owner/task/T1，全部异步操作/同步提交门覆盖，两用途完整离线端到端后才接desktop。单participant正常停止只加窄内部端口、不签全域证明。拟必要7个source及对应测试、实际graph同步门理由和逐步调用顺序在方案列出；root派发前不实施。

后续desktop由一个后台协调宿主持同一实际XRayApplication与root，子执行Worker不写DB，main broker只路由/监督；修正旧方案未落地的对象与连接假设，不把child summary收养为ownedTasks或凭据授权。原source安全重开、未知旧执行域、真实HTTP/OS凭据/GUI与Windows父子退出绑定均留明示未验门。未造第二套数据库互斥或另一个恢复算法。

## 本轮验证与规则判断

实际命令仅Get-Content/rg源码与设计、git rev-parse HEAD/branch/status（只读）、rg文件清单及Python原字节SHA256审计/文档补丁重构。没有执行vitest/noEmit/build/native/dist/Electron/GUI/HTTP/凭据或导入项目代码，没有主目录写入、Git提交/推送/合并。无新运行失败，不编造实现反馈闭环。

最终冻结before377→after379：旧0修改、新2文档、全部377原字节保持；准确before/after/unchanged清单及两文件hash、new file mode100644和/dev/null patch在新交付，逐hunk独立重构一致。旧交付不覆盖。AGENTS新增/修订0：本轮为源码设计，没有新运行复现实验，现有native/异步身份/SQL及凭据边界规则保持。等待root审查后具体实施，四批内必要接缝，不第五批。
