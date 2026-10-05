# 2D-L5 结果契约独立验收

2026-10-05，root协调方，仅原第二批。主checkout HEAD开工为49b484663286a4a57d22cdd8564126c163587b14。依据AGENTS、当前队列及L5明确计划检查原Luna冻结交付；未把开发自测作为本轮验收。没有电脑操作、HTTP、凭据访问、原生构建或导入项目代码执行。

## 差异与源码

394项实施前字节清单逐项核对，391项不变、零缺失；三项变化为contracts/index单export及root两公共记录追加派发回执。新增result.ts/test及开发记录分别核SHA256。源E9AB87EEC083CDAB98A421D2433BA73A96071752D72AC7CC60A1E3B510861CF1，测试8A1E27FF7B4CC15CF7A05978D21E4F3F268ABED5FEC2044F246520EEEFB9460C；index42C2A1F66567627461EAD62D0998FA012EAD6D12A09F9A6E620A623C642FB12F；开发记录5A9AE4CEDF9ED33CC0D7FC9B9E26258E7208020857DCEE493CF4F81F567EA304。root其它待提交文档属于A2准确Git回执及本批计划，不纳入Luna源码范围。

独立检查严格envelope仅八字段，完整identity沿用L3、response沿用原schema。builder不收caller摘要，validator重算完整canonical response与去掉四临时身份字段后的binding，保留实际bodyDigest。首次await前属性描述符私有捕获，getter/toJSON零调用，拒绝静默丢失字段与非法JSON，返回递归冻结。完整小数秒时间经原task record规则比较；数组唯一但不重排；固定错误不回显材料。只有validator认证关联/时间/摘要，裸schema.parse只认证结构，后续store必须使用完整验证器。

## 本轮实际检查

- `./node_modules/.bin/vitest.CMD run packages/contracts/src/ownership-semantic-result.test.ts packages/contracts/src/ownership-semantics.test.ts packages/contracts/src/ownership-semantic-task.test.ts packages/contracts/src/ownership-semantic-policy.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：4文件109/109，exit0，1.86秒。
- `./node_modules/.bin/tsc.CMD --noEmit -p packages/contracts/tsconfig.json`：exit0。
- `./node_modules/.bin/tsx.CMD .benchmarks/l5-independent/probe.ts`：root自有16组实际索引→真实题目→答题→已保存package→Q3完整body/exact prepared→L5构建及重验。四题型×两数据库布局×空/非空排除规则，独立Node SHA256与A2 semanticBindingHash一致，中文/emoji/转义保持。最终探针直接读取真实ignore revision后复跑16组全部通过。自有SQL元数据不代表用户GUI授权；无OS密钥/HTTP。
- 候选修改bodyDigest保留旧摘要拒绝；重算自造证据候选可通过DTO自洽检查，但实际exact prepared validator拒绝。明确证明DTO不能代替当次rubric/答案范围验证。所有原SQL表行、成绩、capsule/题目材料与不可变源码保持；feature/semantic任务、registry、lease均零行。

root只读搜索两次猜测不存在的graph文件名、一次PowerShell rg通配路径错误，后按rg --files实际文件改正；不属于产品缺陷。开发测试首次类型推宽及修正见自身记录。本轮未发现需修产品缺陷，不虚构失败闭环。

当前strict response字段上限使合法材料不能触达256KiB response及272KiB envelope超限分支。已核最终canonical UTF-8计量、常量与非法大材料结构拒绝，不声称实测穿过这两分支。原时间与预算实现保持，不为覆盖率放宽schema。

## 结论与边界

仅纯结果契约独立接受。SQL持久结果、权威T1/真实原题认证、完整当前性、跨库completed发布/补偿、共享实际停止恢复、模型兼容/质量、IPC/GUI仍未验。候选identity由探针从实际材料组合，既非生产签发也非实际发送任务。真实GUI0，不能将本切片当整链完成。

AGENTS新增/修订0；首次await捕获、完整正文摘要与非权威自洽已有规则覆盖。自有探针/材料留在忽略目录，零递归删除。Git只收尾本已验契约及准确计划/记录，实际SHA在执行后另记。四批仍有必要本地结果store/发布工作，继续原双聊天，收尾或仅外部门后暂停automation与派发，不第五批。
