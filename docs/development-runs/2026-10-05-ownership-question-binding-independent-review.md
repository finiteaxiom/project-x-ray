# 2D-Q1 原题绑定独立审查

2026-10-05，协调方，仅原第二批。当前结论：两个独立复现缺陷修正后，Q1后台原题绑定已独立接受并精确集成主目录。两目录各259项、四包类型及两份原始探针通过。首冻结失败证据保留如下；GUI、Q2当前性、语义任务和真实模型仍未验收。实际Git回执见最新协调记录。

## 实际目录与范围

主 checkout HEAD `59abba29f1fd59a97d444c79a16a17a842617541`，仅三份既有协调文档未提交。5170 HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`，全部旧WIP保留。原Q1计划SHA `725A003371DB4F77EA6DFBFDAAD8332017361C00E6522C53B7599431F7B2933B`。

root读取原字节磁盘备份、323文件编辑前清单及13文件冻结清单，逐项重新SHA256：八个授权既有文件变化、315个原文件不变，无原文件缺失；13个交付hash全匹配。精确patchSHA `C0E58B4332CD9477F8A32DCACF3ACB75626ACA6F3044184ED44AF4C5C6753DAE`；`git apply --reverse --check`成功。该patch/manifest是含旧WIP的实际编辑前→后差异，不是HEAD整批差异。AGENTS、A1/S2、旧broker/cache/desktop/UI及包锁等保持。

首冻结关键hash：application/index `44845F411186198967C2A5A6E6FA83866D92D5D35CD2318F3225155C93CE73B6`，binding-store `30178BE62F305845AFB0BC728F9A9E81CC7A2D518809559CFDB025CA4AAD13FF`，capsule-store `245FB402D53D6C417FCD8D398D5FC9300B5A54F2F8935525EBC9454E766D5F0F`。后续修订不能把这些首轮结果直接称为修正版验证。

## 首轮独立检查

核对同一compiled generator提取、原对象join/Map/count/评分版本、有限材料投影、private issuance/receipt、settings→source事务、三行写入及读回、历史无回填、迁移15角色边界。未发现可据此跳过端到端门的理由。

在明确冻结源码上实际运行：

```powershell
./node_modules/.bin/vitest.CMD run packages/contracts/src/ownership-question-binding.test.ts packages/contracts/src/ownership-capsule.test.ts packages/ownership/src/index.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/index.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/ownership-capsule.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

退出0，九文件245/245，44.53秒。实际contracts、ownership、graph、application四条`tsc.CMD --noEmit -p packages/<包>/tsconfig.json`均退出0。是本轮独立回归，不是完整四批或GUI通过。

## 已复现缺陷一：发题请求跨首次等待未捕获

真实自有TS项目索引，request为project/count20，对照发行六题。独立临时`request-probe.ts`在`getSnapshotState`取得真实当前状态后暂停返回；开始`createOwnershipQuestions(request)`，期间caller将count改1，释放等待。实际仅发行一题，探针报告`controlCount=6, mutatedCount=1, callerMutationChangedIssuedRequest=true`。

根因确认：application/createOwnershipQuestions仍在await后读取原input；已有完整数据捕获只用于提交/题目。预期在首次await前捕获原request，后续只用私有捕获，嵌套scope/concept/身份同样覆盖，访问器等不能被执行。公开20限制与内部count100兼容不能混淆。此为产品缺陷，非夹具/环境问题。

## 已复现缺陷二：历史截点可包含本次答题

真实entry索引→首次发题→本地评分保存，原binding为verified-generator，原cut0、对应attempt真实rowid1。独立临时`history-probe.ts`只操作自有SQLite材料：将完整原题加`retryOfQuestionId=自身questionId`，cut改1，retryWitness及有序matching投影使用自身真实attempt及完整hash；questionFingerprint、rubricHash、capsuleHash及SQL列全部正确重算。实际load仍返回verified-generator，探针报告`ownAttemptRowid=1, forgedHistoryCut=1, selfRetryAccepted=true`。

根因确认：生成器全输出与摘要检查缺少可观察的时间顺序约束；重建把本次答题当成自己的发题历史。本次答题不可能参与其发行。预期save/read核cut严格早于对应真实attempt行，拒self/later cut且固定失败、零改行；正常后追加倒序completedAt不应进入旧cut。该检查不提升为人工整体重写数据库的防篡改日志保证。

两个原探针用本checkout现有`tsx.CMD`执行，退出0，隔离临时项目和数据库保留，未写生产源码或执行夹具项目代码。实际命令形式：`./node_modules/.bin/tsx.CMD (Join-Path $auditDir 'request-probe.ts')`及`history-probe.ts`；auditDir仅本轮自有临时材料，不在记录中暴露用户路径。

## 修正派发与验收状态

已向原 Sol/medium 派两处明确复现、预期及原Q1文件边界，要求有意义回归、保存首备份/失败证据、修后精确patch/hash重新冻结。原修正回合 `01a10963-9f0a-7b90-ad9e-efe07f3c06fd` active/inProgress，实际cursor `7e07c337-f6c9-490f-bd90-c31368d0efe4:64`；Luna原冻结idle `1ac033a7-c1ee-48ae-9e61-2317590f341e:36`。root停止读取/测试修正中的文件，等待稳定切片再独立复验。

已实现：首份Q1本地源码，仍有已确认缺陷。独立代码/回归已验证：首冻结245项、四包类型、范围和两额外失败探针。真实GUI已验证：0。Q1接受/主目录集成、Q2/barrier、语义任务/发送/模型质量及其他批次门仍未验；本轮无Git写入、重型/native/Electron/GUI、网络/秘密扫描或导入代码执行。

AGENTS新增/修订0：首轮尚未闭环接受，不提前把修正假设沉淀为经验；已有首次等待完整捕获规则适用。后续可在独立修后证据下评估截点经验并查重。原四批收尾暂停自动任务和派发，不启动第五批；四批内仍有可推进本地工作。

集成准备限制：root只读`git apply --check`首冻结patch到main，application/index、contracts/index、graph/index、capsule-store.test四处旧上下文不匹配，未写任何源码。两checkout原barrel/缓存/迁移范围差异须在修正版接受后逐hunk适配，不能整份复制或以此为产品缺陷。首冻结patch和manifest另在root自有临时审查目录保存，避免修正版交付覆盖首轮失败证据。此检查不是集成成功或验收。


## 修正版独立复验与主目录精确集成

原Sol修正回合 completed/idle，实际cursor `7e07c337-f6c9-490f-bd90-c31368d0efe4:75`，Luna保持idle :36。修正版精确原→后patch SHA `3178994E12A83EEBBDBD32FD2CE9C1F27D3B1B2A76CC4A353EF4F46AB16AFEF9`，reverse check通过。独立再次核原323清单：仅八授权旧文件变化，315不变、零缺失；13冻结hash全部相同。首patch/manifest及两个原失败探针保留，没有用修后结果覆盖首轮失败。

源码闭环：发题首次await前完整私有捕获request，保留内部count100与公开count20边界；访问器、隐藏/symbol字段、循环/非有限值拒绝。binding保存及历史读取均从实际SQL核对应attempt真实rowid，要求cut严格小于rowid，含ordering engine不支持分支也不能跳过；坏时间顺序固定失败，不改历史。原评分、题目/评分版本、Map行为、三行原子和旧记录不回填保持。

root在修正版Sol运行上文相同九文件命令：259/259，49.54秒；contracts、ownership、graph、application四包noEmit均退出0。额外运行两份原始真实索引探针：request对照6/修改后仍6，callerMutationChangedIssuedRequest=false；self-cut重算全部摘要后从原verified-generator变为固定“所有权原题绑定失败”，selfCutAccepted=false。不是修改探针断言或报告替代复现。

主目录先备份365个现存文件及八授权原文件实际字节。完整patch有四处旧上下文不匹配，因此逐块集成53个Q1编辑块，全部计算预像并核冻结hash后才写入。两次无写入dry-run揭示重复片段匹配和旧activation上下文，修正为唯一上下文匹配及明确适配。主application保留原currentActivation赋值，graph不引入Sol旧parseCache迁移，contracts仅单export，capsule test保留原1–11并加15，而Sol原1–12并加15；原main index.test及其他cache/旧接线全保持，未整份覆盖文件。集成后365清单仅八授权源文件变化，357不变、零缺失（协调记录更新另列）。

root在主目录实际运行相同九文件命令259/259，48.31秒；同四包noEmit退出0；原探针仅调整导入根路径，逻辑保持，均同样通过。git diff --check通过。Q1精确13文件（12源码/test与开发记录）加本独立记录及准确协调文档/一条公共经验可收尾；不纳入Sol旧WIP。

已实现：可信新发题→原确定性评分→attempt/capsule/binding三行原子→重开完整生成核验。独立代码/回归已验证：两目录各259、四包类型、原始探针、原副本及精确集成。真实GUI已验证：0。当前性Q2、语义任务/发送/模型质量、其余四批门仍未验；认证不等于当前或项目外发许可。无重型/native/Electron/GUI、网络、秘密扫描或导入代码执行。四批仍有本地工作，完成后暂停派发/自动任务讨论，不启动第五批。

AGENTS新增1条：实际SQL历史截点必须早于对应提交，保存与重开都核验；来源为上述真实self-cut失败→修正→原探针复验及新增回归。首次await完整捕获已有规则覆盖，不新增重复经验。摘要不能证明时间顺序或整体防篡改。
