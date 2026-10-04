# 第一批：worker 终止失败隔离修正

2026-10-04；root；有实际源码与端口模型复现依据，属于原四批第一批。2026-10-05权限恢复，3G-S1已冻结并独立复验，root已向原Sol发送本计划具体恢复指令，实际新回合active。本计划不授权自动展开新任务。

依据 [独立审查](../development-runs/2026-10-04-explanation-stop-failure-review.md)：stop 将 worker 清空后 terminate 拒绝，close/fault 清 stopping，下一 session/provider-state 创建新端口而原端口模型仍存活。只有端口契约路径已复现，实际 OS 拒绝未验，不改写为外发或数据损坏。

仅 Sol5170 的 `apps/desktop/src/explanation-broker.ts`、`src/explanation-broker.test.ts`、必要的 `src/remote-explanation.test-support.ts`、新增 `docs/development-runs/2026-10-04-explanation-stop-failure-fix.md`。main/preload/UI/policy/credential/contracts/application/graph/native/package/lock 保持冻结；如需接线额外修改先说明具体必要性。开发不 Git 收尾，不改 root 公共队列。没有新依赖/产品能力。

修复目标：stop 保留未确认终止的精确端口与代际；成功 termination/可信同端口 exit 前不 recoverInterrupted、不补偿/释放，不创建新 worker、不打开授权 gate。fault/close 的失败不得通过清 promise 擦除“不确定仍存活”状态。失败可有明确固定错误/人工重试路径，但不得无限自动重试。允许可靠确认后恢复，不能永久破坏正常可恢复关闭。

回归用现有真实隔离 SQL fixture 和显式受控端口，覆盖 close terminate 拒绝、fault 拒绝被吞路径、provider-state/activate/context/session 重试、并发 session/close/fault、拒绝后迟到 exit、旧端口迟到 reply/阶段、重复 exit/termination、终止成功与 cleanup BUSY。拒绝期间断言零新 worker、零 recovery/补偿/lease-release；有真实持久 task/lease 时它们不能因未知终止被提前释放，completed 历史/旧源码保持。不伪造生产 provider、凭据或请求。

实现前先运行两条定向红测，修复后与原 broker/policy/runtime/credential 定向回归和类型检查一并验证。测试模型不能冒充 OS failure；真实正常 Worker termination 成功/exit 顺序的技术入口在 root 唯一窗口后安排。无 GUI/真实 HTTP/production 凭据，不重型 build/native/dist/Electron，必要技术构建需提前协调。

明确稳定交付：冻结上述范围、实际 diff/hash、红测→根因→修改→复验、未验范围和规则判断。依赖 3G-S1 稳定且 SQL 接口未改变既有端口后再派，四批内闭环；GUI/完整发送取消 IPC、生产质量仍开放，不提前整体提交旧接线，四批收尾停止开发并讨论规划。
