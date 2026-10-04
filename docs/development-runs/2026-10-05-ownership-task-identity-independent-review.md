# 2D-L2 内部语义任务身份独立验收

日期：2026-10-05。main 起点 `9edaea93128b06da60411096f91fd5d349313ff3`，原第二批。协调方在 Luna completed/idle、明确冻结后审查四文件；Sol 2D-S2 仍 active，未审查或测试其活动代码。

## 源码判断

新 `ownershipSemanticCapturedIdentitySchema` 仅包含计划 33 个必填字段和类型。hash/id/time/uuid/revision/model 复用已有有界 primitive，ignorePolicyHash 唯一允许 null；题目与确定性评分版本保留有界历史文本。独立 task/rubric/semantic scoring/limits 版本为 1.0.0；semanticProtocolVersion 由现有 purpose/version 组成，与实际已验 adapter 出站协议一致。policy provider/disclosure 复用已冻结常量。

旧 remoteCapturedIdentity、公开 prepare/start、feature purpose、评分和 SQL 均未改；barrel 仅一行 export。原题/attempt/rubric/config/context/body 字段使后续可信核验具备完整结构，但本 schema 不执行关联验证、当前性、用户动作或调度。不同合法摘要组合可以通过；不得把 parse 成功当原题绑定、数据库授权或签名。内部 taskId 不能通过公开入口。模块仅定义常量/schema/type，导入现有纯 contracts，无文件/网络/计时器/SQL 副作用。

## 独立验证

实际命令：

```text
node node_modules/vitest/vitest.mjs run packages/contracts/src/ownership-semantic-task.test.ts packages/contracts/src/ownership-semantic-policy.test.ts packages/contracts/src/ownership-semantics.test.ts packages/contracts/src/remote-explanation.test.ts packages/contracts/src/remote-explanation-desktop.test.ts packages/contracts/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
node_modules/.bin/tsc.CMD -p packages/contracts/tsconfig.json --noEmit
```

六文件 145/145，2.13 秒；contracts noEmit exit 0。核对逐字段缺失/错误类型、ID/model/历史文本限额、hash/UUID/时间、revision 上限/溢出/负值、固定 purpose/provider/version、完整旧新身份双向拒绝、公开入口/正文/凭据/endpoint 额外字段拒绝及合法不同摘要不冒充关联校验。实际 diff --check exit 0；该命令不代替源码和未跟踪文件审查。

三个源码 SHA256 与冻结交付一致：schema `284D416F39922D79DB097203E73B6E9068BCF366D6FB63036F1F6A47A0CF08FE`；test `21ACA9E5B424E2A9AEEB088C7E98EC351D5F61477356C194BAF195D8062C564F`；barrel `468826BB544391E0092608E64089FD11F7CB4303A5367D3F00EC5A4FF2E0D629`。

## 反馈与接受范围

独立检查未发现产品或测试缺陷。开发记录中初始 rg 通配符 OS error 123 为命令调用问题，纠正路径后完成检索；不增加工程规则。公共 AGENTS 新增 0：本轮纯 DTO 与既有有限契约/证据授权区分规则一致，没有未覆盖的可操作通用经验。

接受纯身份契约四文件及准确协调文档，可由协调方精确提交。已实现和独立代码/回归已验证如上；本轮真实 GUI=0。没有任务记录/状态机/结果、shared lease、dispatch、SQL 当前性/权威政策/实际原题核验、provider、IPC/UI 或模型质量验收。2D-S2 及原其他生产 WIP 保留，不纳入这个提交；原四批尚未完成，继续本地范围后按停止门暂停讨论。
