# 4B-P：纯产物清单协议独立验收

2026-10-04 02:58，协调方。主目录f647b79，仅本轮三个新文件：协议 A6D9153DFC8D8B7C46B8D843DCDAA8D03E1F7B6501F32808930DAB1A07D830B6、测试 EEA2CF6A41698AAA7316C39A7B6108F0B9F7E404993F0471D7896E3CCC561322、开发记录40843B580D0A217A7342C1186840AAF7433140E3C779F8C258A454DBE1AB562A。真实hash与交付一致，原聊天idle后才执行验证。

root完整读查协议、测试、记录及派发计划。仅crypto/util内建导入；getter/Proxy/非plain/别名拒绝、有限树/数组/字符与文件容量、严格字段、规范相对路径、Windows冲突、文件/SHA/Auth关联、深冻结、code-point排序、规范JSON重建比较。raw签名/覆盖/显式policy信任与状态独立，不完整优先3；64/70固定映射。输入都是未认证观察，synthetic标识及固定release/build/runtime边界保持，不会获取发布权限。

实际root命令：node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-manifest-protocol.test.ts --fileParallelism=false，22项通过、265ms；node --check apps/desktop/scripts/windows-artifact-manifest-protocol.cjs exit0；pnpm --filter @project-xray/desktop exec tsc -p tsconfig.json --noEmit exit0。没有native预构建、真实artifact或GUI。

额外独立自有ignored探针 .benchmarks/artifact-protocol-review-20261004/probe.cjs，SHA256 411B8CEC126308F4A27EA074DC2741799C2B0033EAA9A6262749184C65FE880D，git check-ignore确认；不导入开发test helpers，不读dist/候选/用户数据，直接调用真实公开纯协议。node执行exit0，94组检查通过：3 scan×3 structure×8 raw状态共72往返；policy匹配/不匹配与不完整组合；枚举/字节/已知issue矛盾、缺signer、未知PE；身份/路径/字段/来源错误64；篡改输出推导/固定边界拒绝；getter与Proxy未执行；最大5000文件、每signer16个自有EKU，4,534,648字节规范报告完整往返。额外极值控制实验先验证5000文件往返，没有失败，不编造产品修正。

接受范围仅严格协议与合成内存回归，不是扫描器、实际文件哈希/Authenticode/ASAR、发布来源关联/生产接线/安装升级/签名/干净Windows/GUI。无provider调用、外发、密钥或安全控件操作。本轮AGENTS新增0，已有证据边界与严格校验规则覆盖；开发记录的首次TS测试类型失败如实保留，不改写产品缺陷。后续reader必须有明确实际句柄/同对象签名/资源/离线边界计划后再派发。
