# Q3 完整正文当前性接线独立验收

2026-10-05，root；原 Sol 回合 `01a10b67-8de0-74d2-8498-3f58d541708d` completed/idle、冻结后检查。主基线 `bc608aaa291c1bd0a8747646791ef740bd97c53d`，Sol HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`，保留其全部其他 WIP。限原第二批 [明确实施计划](../plans/2026-10-05-ownership-semantic-fullbody-currentness-implementation.md)。

## 实际范围与源码判断

root核冻结patch SHA256 `A0CF464DD1520CCCC8BBA9962013A8C2CB30783880B5752E4EF93CA84C2AA7F4`、manifest `798D879739AC9F4498DC9A4B09334E46C5476BA8AA18A1765202C56930C1FE3B`。Sol341原文件仅四授权源码/测试变化，其余337逐一保持、零缺失；五交付after hash实际一致。没有复制整个历史Git差异。

application只改固定adapter import和semanticPorts接线两行；七个GraphStore构造不变。graph仅窄结构类型，无LLM运行依赖。完整正文使用原Q2捕获的实际model/outputTokens，原内层摘要及requestBytes口径保持；bodyDigest/bodyBytes独立针对最终canonical UTF-8正文。固定L4结果与exact inner对象保留，私有canonical preimage、完整摘要/字节和原材料/设置在锁段重核。原一次receipt、作用域撤销、取消、超时和来源门未放宽；零任务或发送能力新增。

主目录三个可复制文件的before hash与Sol原副本完全相同，先保存386原文件字节及hash，再复制这三个文件和开发记录。application/index只替换上述两行，保留main缓存/activation等与Sol的基线差异。备份保留在root自有临时目录；没有递归删除或覆盖其他任务文件。AGENTS、LLM/contracts、旧S3-B与迁移均未改。

## 本轮独立执行

两个目录顺序执行开发记录中同一15文件vitest命令，单worker、no-file-parallelism、no-cache：Sol **530/530，60.69秒**；main **530/530，64.49秒**，均退出0。各目录graph/application/llm的`tsc.CMD --noEmit -p packages/<包>/tsconfig.json`三包均退出0。覆盖真实准备、原题认证/胶囊/评分、独立授权、共享占用/S3-B、原图/远程及L4正文回归，不运行无变化全仓检查。

root另编独立夹具 `.benchmarks/q3-independent/fixture.ts`、明确5170导入的`fixture-sol.ts`和各目录driver。实际执行：

```powershell
./node_modules/.bin/tsx.CMD .benchmarks/q3-independent/probe-sol.ts
./node_modules/.bin/tsx.CMD .benchmarks/q3-independent/probe-main.ts
```

各自四题型×两SQL布局×空/非空排除配置16门全部通过（Sol7.18秒、main8.44秒）。真实索引→可信出题/提交/确定性评分→实际SQL材料→固定完整构造→同步一次消费；另独立重构正文比较全部字节。完整body分别8417/8439/10906/12774字节；两布局/配置均正确，不外推性能收益。原内层摘要与完整body摘要不同且分别匹配，真实model/输出预算及store/stream/strict设置正确。实际旧validator接受exact inner引用，inner clone拒绝NOT_PREPARED；逃逸receipt及重复token拒绝。所有SQL表前后相同，原attempt/成绩/角色/胶囊/源码保持，task/registry/lease零，零HTTP。

原回归另覆盖inner合法outer超限拒绝而不裁剪；真实构造完成后延迟返回的caller更改/取消/超时/替换/close及provider model/预算/context改变后恢复拒绝。root源码核延期控制仍调用真实构造器，未伪造成功body。夹具草稿在首次执行前纠正题型variable-roles和五字段prepare purpose，属于审查夹具准备；没有产品失败，不编造修复循环。两目录本轮无回归失败。

## 接受边界与规则

接受Q3后台本地准备接线及精确main集成。已实现、独立代码/回归验证如上；真实GUI验证0。引用本身不是发送许可，未实现semantic持久任务/结果、传输、统一实际停止恢复、模型质量或真实API兼容。其他四批未验门保持，GUI暂缓不作为提交界面实现的豁免。

未访问生产凭据、用户授权控件或秘密环境，未发送用户数据，未执行索引项目代码，无native/build/dist/Electron重型窗口。AGENTS新增/修订0：已有完整正文预算/摘要、私有捕获与证据规则覆盖，无新的产品缺陷经验。四批仍有本地工作，继续原双聊天；四批收尾或仅剩外部条件后暂停automation及派发，讨论后续，不启动第五批。实际Git回执另记。
