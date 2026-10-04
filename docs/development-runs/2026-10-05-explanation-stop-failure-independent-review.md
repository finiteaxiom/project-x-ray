# Worker终止失败隔离独立复验

2026-10-05；root；原四批第一批。Sol回合01a107a7-a766-7681-8ab4-71974deb0cb5已冻结，实际cursor7e07c337-f6c9-490f-bd90-c31368d0efe4:9，HEAD455d4ad50830ee2495b70927e51caf830a4efbb8。仅本批差异审查，不把该worktree全部旧接线改动视为交付。

## 来源及源码审查

开发方保存的三份原副本与已知冻结hash相同：broker468B5B199E609651D4C54A8C50823DAF30E10CD178CB6FDFE48A9D6A85A8E362、test466E9AA5AEFE95CBBC6DE39623051ECC273C89BDB8E5F3CB421ECA08C4823B6B、support13AFA5519AD5A2C9D978D3472EABEC702E4617ED88C1912EFC6AF770886BFBC7。root读取精确patch及源码，核新brokerAF23D5847EAACEFADF610F47B7C76C5CDF960644F6CF9385B781DF9B4B7CD16F、testD3BB69483379E51A798477C446AEB98428A8201A2CD9C20C5B1C54CF65A55C0D、support315A2EABE9CF08C465D99F69CFFEA9C8CCF438F6788CF3B364F06B1FFFAB155D；验证后hash保持。policy未变，未复制/提交整个旧接线。

独立核stopFlight与retiring的职责分离；拒绝不会清除精确端口/代际，未知存活挡session/context/RPC；可靠exit或terminate成功后才执行补偿/恢复。cleanup BUSY保留已结束但未恢复的端口记录；重复fault不自动重试，显式close有限重试。旧端口迟到exit/reply不作用新代际。support只把模型exit对齐为停止runtime，没有把拒绝改成可信退出。45项包含原回归、真实SQL dispatched lease、历史结果/旧源码及第二连接BUSY。

## root实际检查

- `pnpm exec vitest run apps/desktop/src/explanation-broker.test.ts apps/desktop/src/explanation-policy.test.ts apps/desktop/src/explanation-worker-runtime.test.ts apps/desktop/src/remote-credential-policy.test.ts --reporter=dot --maxWorkers=1`：4文件45项通过，6.76秒，exit0。
- `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json`：exit0。
- root唯一技术窗口、两开发均冻结时 `pnpm --filter @project-xray/desktop build`：exit0，正常tsup和Python/secure-reader/credentials复制完成，无native重编译、GUI或发布。产物explanation-worker SHA52807828D70D66A89FD611575BAA53551CD45A3C3B9EC3BC54D08A67209E42D1。
- root自有临时脚本调用冻结broker/policy源码及正常构建explanation-worker真实Node Worker：三轮session/provider-state/并发close；另一次外部实际terminate导致可信意外exit，再通过provider-state恢复。共5实际线程，每个exit一次，broker terminate次数[1,1,1,0,1]，十次恢复均观测活线程0，最终活线程0。Node24.17.0，命令exit0。只有bootstrap/state/结束路径，无task或凭据/HTTP命令，不能外推完整请求链。

临时脚本首次.ts在仓库外被tsx按CJS编译，top-level await加载失败，尚未创建线程或DB；改用同内容.mts后成功，这是审查工具格式问题，不是产品失败。自有材料位于Temp的xray-broker-lifecycle-review-08ebfbbd3af344aab7b3f65de2ebf355，保留不递归清理。数据库和线程已关闭，不依赖旧技术产物。

## 接受及未验边界

本次窄修的独立源码、45项适用回归和真实Node正常生命周期技术检查通过。实际OS terminate拒绝仍是模型而非系统复现；Electron完整main/preload、发送/取消IPC、GUI与真实服务仍开放。broker属于旧未整体接受接线，main没有对应模块及完整依赖，不能仅为提交窄修复制旧接线；本轮不提交Sol实现，不认为第一批完成。无新增AGENTS规则，现有终止确认/占用恢复规则覆盖；模型不是OS经验。
