# AI 接线：终止失败的独立源码与端口模型审查

2026-10-04；root；原四批第一批。实际 main `c479ac4dfc25da752e47af5ed8a4937dfd79c73a`，两个当前实施任务仍在原范围运行；本轮不测试其活动 Python/SQL/lifecycle 实现。

## 材料与有限证明范围

只读 Sol 已冻结 explanation-broker/policy/remote-credential-policy 及桌面接线和旧退回记录，核 main 对应接受的 graph、contracts。Sol 当前正在改 application/graph 的增量入口，故没有运行它的整包测试/构建；root 使用 main 已接受 GraphStore 和 Sol 冻结 contracts/broker 的精确源码，在主 checkout 临时脚本中建立真实内存 SQLite authority。测试别名只定位这两个明确源码包，未注入生产 provider、native 凭据或 HTTP。

受控 ReviewPort 是 EventEmitter 模型：activate-context 回复严格关联实际 command 的 protocol/request/committed context；terminate 在第一次被调用时明确 reject，同时 alive 保持 true。只处理该命令，未配置凭据、发送项目、生成解释、启动真实 Worker 或 GUI。因此这证明 broker 对其公开端口契约的失败处理，不能声称真实 Node/Electron terminate 拒绝已发生或测得其概率。

冻结审查源 SHA256：

| Sol 文件 | SHA256 |
| --- | --- |
| apps/desktop/src/explanation-broker.ts | 468B5B199E609651D4C54A8C50823DAF30E10CD178CB6FDFE48A9D6A85A8E362 |
| apps/desktop/src/explanation-policy.ts | 4D698DB7A009B57220B58BE100ECFC2485E6DCF6127FA0A02FC87FB3D6F0F12C |
| apps/desktop/src/remote-credential-policy.ts | 139465B22BC55F373FC5237E85D5AF99E0B78549DE53328054D165DDA2ED38E0 |
| packages/contracts/src/remote-explanation-desktop.ts | 5A6E2D4E5999F9AD3749D4FC13558DF0CFF60B16D5F61D81EBCAF6ECA5933BB3 |

## 两条复现路径与根因

命令 `pnpm exec tsx --tsconfig .broker-stop-review.json .broker-stop-review.mts`，Windows Node 24.17.0，最终 exit0。

1. session(1) 成功→close() terminate 拒绝→再次 session(1)。输出 closeRejected=true、originalPortStillAlive=true、restartAccepted=true、workersCreated=2、originalHandleDetached=true。
2. 新独立 authority/session→首端口 emit error→等待 broker 的 stopping promise→provider-state request。输出 originalPortStillAlive=true、providerStateAccepted=true、workersCreated=2、originalHandleDetached=true。这条路径覆盖 fault 的 stop 拒绝被 catch 吞下、finally 清 stopping 后自动重开。

根因确认到源码：stop 在 await terminate 前将 this.worker=null；拒绝后丢失端口引用。close 的 finally 或 fault 的 catch/finally 清 stopping；下一 session 的 stop 没有端口可等待，就能继续 recoverInterrupted/创建新 worker。它违背“旧 worker 尚可能发布时不能恢复占用”的现有设计要求。实验无活跃 task/lease，因此没有声称已观察旧发布、数据库损坏、错误 lease 删除或实际外发。

预期：终止未确认时保留精确旧端口/代际和关闭 gate，不允许新 worker、上下文授权或 recovery/补偿；只能在该端口 termination 成功或可信 exit 已确认后恢复。拒绝 Promise、迟到 exit、重复 close/fault 和并发 session 应明确区分，不能无限等待，也不能把旧端口换掉后假装终止成功。

临时脚本首跑因 Windows ESM 的盘符 import 不是 file URL 而在加载阶段失败；修正固定 import 为 file URL 后两次 exit0。这是审查工具加载错误，非产品红测，不作为工程经验。模型端口最终均显式置为可终止、terminate 与 broker close 后关闭内存 DB；临时两文件精确移除，不递归清理。

## 后续与验收边界

形成第一批必要修正队列，待原 Sol 3G-S1 稳定交付后派发，不抢占当前任务，不让 Luna 修改同批 broker。预计仅冻结 broker/test-support 的终止失败模型回归与对应开发记录；具体修改计划见 `docs/plans/2026-10-04-explanation-stop-failure-fix.md`。真实 Node/Electron 生命周期仍需独立技术检查，GUI和真实远程质量继续未验；旧接线整体不提交。

本轮独立已验证：冻结源码及上述两条受控端口失败路径。已实现产品修复：0。真实 GUI：0。未验：实际 OS 终止失败、带真实 task/lease 的负例、修复及正常 Node worker 终态、GUI/发送取消 IPC。无 AGENTS 新规则：已有关闭/恢复门覆盖要求，修复尚未验，模型不能扩展为 OS 经验。
