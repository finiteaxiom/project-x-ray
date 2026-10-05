# 2D-L5：语义结果持久化契约实施

2026-10-05；原第二批下一必要依赖，root派原开发GPT-6 Luna/Max，仅main。S3-A2已独立接受并提交49b484663286a4a57d22cdd8564126c163587b14；后续仍须graph结果存储、应用发布/补偿与统一停止恢复，不第五批。开发不Git，保留main所有既有改动。

## 实际缺口与范围

现有contracts/ownership-semantics.ts有strict模型response，ownership-semantic-task.ts有完整captured identity/任务元数据；没有将二者绑定的持久结果DTO或摘要验证器。graph17只有任务元数据、零结果表；Q3 actual body/exact prepared已接受。已接受共享任务设计第6/7节要求source append及global completed闭合，未来结果store必须有严格边界，不能把裸模型response或caller hash当发布结果。L5实现这项必要契约，不另做宽泛设计或准备语料。

仅新增packages/contracts/src/ownership-semantic-result.ts及.test.ts；contracts/index.ts仅追加单export；自有docs/development-runs/2026-10-05-ownership-semantic-result-contract.md。禁止改已有task/response/package/policy schema、版本、评分或其它contracts、graph/application/LLM/UI/desktop/native/包锁、AGENTS/公共计划/记录。没有SQL迁移/真实HTTP/凭据/用户授权或GUI，不执行导入项目代码。

## 精确契约

独立result version1.0.0。strict envelope仅version、identity（原严格L3）、createdAt（首次任务T1）、completedAt、bindingHash、responseDigest、response（原strict OwnershipSemanticResponse）。时间沿用remoteTimeSchema，以原ownershipSemanticTaskRecordSchema的completed/null-code规则验证完整UTC小数秒次序，不改L3或使用Date.parse截断。该envelope是结果候选材料，不代表global已经completed。

response.assessmentPackageId必须等于identity.assessmentPackageId，response.version保持原1.0.0；criterionId唯一，各criteria的evidenceIds/limitationIds/answerRanges去重仅验证而不重排/猜补；保留原序列、中文/emoji/引号/反斜杠及源码范围。不能加入score/passed/mastery/confidence/verified/正文、答案、rubric、key、source片段或caller许可字段。

canonical response UTF-8预算仍256KiB；完整envelope UTF-8上限272KiB（留16KiB任务身份/时间及固定摘要空间），独立常量，不放宽远程请求64KiB、response256KiB或本地答案上限。严格拒绝超限、非良构Unicode、未知字段/undefined/非有限数、符号字段、访问器、非枚举业务字段、稀疏数组、循环及不受支持的对象。不得调用getter/toJSON；跨JSON/IPC后只有plain DTO，不添加Node-only imports破坏shared契约。

bindingHash算法必须与已验graph内部semanticBindingHash精确一致：SHA256(canonical完整identity仅去掉taskId、ownerSessionId、contextHandle、contextEpoch)，保留全部其它字段和actual完整bodyDigest。responseDigest算法明确固定SHA256(canonical response)；不将容器hash替代内部摘要。算法与字段写源码注释/记录；hash不代表签名、原题认证、当前性、用户许可或模型质量。

提供小型pure async builder与validator：builder从严格identity/两时间/response构建两个实际摘要，不接受caller摘要；validator完整捕获并校验envelope后独立重算两摘要，错误返回固定有界枚举/文案，不回显输入。第一次await前捕获参与摘要和关联判断的完整private plain JSON，之后仅用捕获；不能structuredClone掩盖未知/非枚举/稀疏字段。不重复发送、读取原题/SQLite、验证真实provider或持有权威prepared WeakMap。返回私有不可变DTO，原输入不改。

本层只有结构/内部关联和摘要检查，无法证明response满足当次rubric允许证据、答案UTF-16边界/完整路径或可信题目：这些仍由实际validatePreparedOwnershipSemanticResponse(exact prepared)及应用全门执行。没有该真实验证与global/source闭合，L5通过不能开发布/读取许可；不靠关键词或response schema新增评分。

## 最小充分回归与交付

正常中文/emoji各verdict的真实现有schema材料与完整canonical字节；时间亚毫秒倒退/等值小数位；packageId错配；未知score/passed/key/identity字段；坏digest/修改bodyDigest/response后旧摘要拒绝；重算摘要的合法但自造材料只能成为结构DTO，明确不具权威。四临时身份字段变化binding不变，其余全部字段及bodyDigest变化binding改变，和graph算法做独立规范投影测试（contracts不导入graph）。builder/validator在首digest受控等待期间输入被替换后使用原捕获、正确原输入不变；getters零执行、符号/隐藏/undefined/稀疏/循环/非良构Unicode/预算拒绝；返回递归不可变。预算测试必须核最终canonical UTF-8和转义，不能只用字符串长度。

运行本新契约及ownership-semantics/task/policy现有适用contracts回归，contracts noEmit；新文件反馈闭环说明真实失败/修正与未验证项，不盲改快照/超时。AGENTS冻结，候选经验去重可0只放自身记录。实施前核实际目录/Git/未提交来源，保存本次所有旧文件字节清单及index原副本；交付精确patch、源/test/export/记录hash及其它原文件不变清单，冻结后root独立审查。不能把这项纯结果契约称为结果已持久化/发布、模型质量或GUI完成。
