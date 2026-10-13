# 4B-M9 首次独立审查

已读实际计划/AGENTS/队列及开发记录。work tree 2冻结完整437；原432与派发SHA及raw一一一致、恰五新；source快照见ignored m9-initial-independent.json。本轮开发未运行HANDLE，root在稳定冻结后唯一窗口执行正式两文件：30项13通过17失败，17.42s。无GUI/Git/清理或主目录集成。

确认接口缺陷：已验M8 Assert-XRayOutputMetadata返回仅volume/fileId/directory，New-XRayPrivateArtifactOutputDirectory将该投影保存createdIdentity。M9 Assert-XRayOutputFileBorrowedDirectory将actual与saved均交给要求attributes/length/links/creation的完整metadata校验，saved必定拒绝。root普通自有fixture实际返回OUTPUT_FILE_METADATA_REJECTED、nativeCallCount0、createdfalse/readyfalse、原M8仍held、最终释放成功。因此写入/hash/ACL/fault到达不能从本轮早拒绝推断通过。

源码还需后续真实门：只读公开session/私有owner账本、固定FILE_CREATE/WriteFile等native参数、32MiB输入捕获、实际ACL与EOF/hash、借用不关闭和真实失败释放。identity-mismatch夹具另有FIXTURE_OPERATION_FAILED，当前未定位，不猜测。先修已确认接线错配，再独立执行原套件；保留所有测试与到达marker，不放宽metadata或修改M8填字段。sidecar阶段不证明ASARcopy、完整reader/manifest、签名、持久化、runtime或GUI/API。

限定修复仅新output-file.ps1、新pure测试与自有记录：saved目录身份按M8准确投影验证并比对，actual完整metadata仍来自实际HANDLE且严格校验；错身份/owner/closed/reparse继续拒绝。加入真正调用目录借用校验的纯契约回归，测试stub仅模拟已知投影而不能称Windows验收。原432、fixture/HANDLE测试冻结；若修复后剩余fixture有新明确复现再派，不整轮扩修改。开发只纯/类型/AST、禁止任何HANDLE/native/fixture/reader/build/dist/Electron。root命令全部结束，437不变、窗口closed，材料保留；经验0，既有契约与来源检查规则覆盖。


## 2026-10-12 身份契约修复独立复验

冻结437逐项raw/hash核验，原432与派发一致，恰module/pure测试/开发记录三旧修改，其余434与首次root冻结完全一致。saved严格三字段M8投影，actual继续完整M4 HANDLE metadata，未改M8或放宽实际身份门。root唯一窗口原两文件31项30通过1失败，18.99s；desktop noEmit通过。正常Unicode/空文件/精确32MiB读回、超限native0、已有file/dir/link内容与ACL、其余故障marker、借用保持及close重试均通过原断言；这些只证明各原断言覆盖的内容，不替代完整reader。

剩余实际夹具缺陷已定位：identity-mismatch wrapper对所有非目录Get-XRayHandleMetadata计数，包括M4 portable和M8输入复核，计数到2便伪造fileId。原夹具root重现fixtureFailureStage=new-output-directory、attemptedfalse、M9 native0、faultReachedtrue，而M8 INPUT_SESSION_INVALID。因此marker并不证明M9文件身份复核被到达。限定fixture按本次M9已创建HANDLE/明确阶段注入，准备M8时保持真实metadata；directory-identity-mismatch当前额外加入attributes/length/links/creation七字段，被严格三字段shape早拒绝，应只改合法projection的fileId并确保确为错ID。

源码另确认close-failure夹具覆盖了第一次unconfirmed结果而只返回retry结果，原测试不能证明第一次ready撤销/未释放/账本保持；限定保留首次DTO并加严格断言。已有目标保存字段未包含完整volume/fileId，按原计划补自有fixture目标前后身份取样（仅只读M4 HANDLE、不跟随link），不能把内容ACL相同当ID已验。这些是原M9验收缺口，生产module/纯测试及原432冻结。

本轮M9整体未接受、未集成；root命令结束且437不变，唯一窗口closed。后续只派fixture/HANDLE测试/自有记录三旧，开发纯/type/AST禁止HANDLE，冻结后root执行原套件并核严格marker。ASAR安全副本、sidecar JSON/父进程重开、完整manifest/reader、签名、运行、GUI/API未验，无Git/清理/新增规则（现有来源及反馈规则覆盖）。


## 2026-10-12 夹具修复与主目录本地门接受

冻结437完整raw/hash核对，恰fixture/HANDLE测试/自有记录三旧，其余434及原432不变，production module/pure保持上一轮修复。已逐项审查实际新差异：故障只对本次NtCreateFile获得且WriteFile完成全量的普通文件HANDLE复核注入；directory错ID是合法三字段投影；首次CloseHandle失败DTO保存并核未释放/ready撤销/owner账本1项，再retry实际释放；既有file/dir/junction本体及外部目录/marker通过M4 no-follow实际HANDLE前后完整volume/128bitID取样，配合内容/ACL不变。夹具仅自有材料，junction自身被reparse拒绝后才用同HANDLE固定ID/类型API观测，不跟随目标。

root唯一窗口原两文件34/34通过（21.45s），desktop noEmit通过。另root临时适配原ordinary夹具，在精确本次M9已登记HANDLE/full identity确定后，仅尝试该自有文件改名/删除：持有期均拒绝、实际identity/length不变、文件释放成功、M8保持held。材料保留；只证明该运行时受限打开/权限组合，非普遍ACL或抵御管理员证明。

精确主目录536→541仅五新，旧536全部raw/hash保持，依赖M4/M8字节匹配；主目录M8/M9四文件57/57通过（32.32s）、desktop noEmit通过，双目录源像保持。收据ignored m9-fixture-independent.json、m9-main-exact-integration.json、m9-root-held-probe.json。接受仅内部0..32MiB private byte[]/排他普通文件创建/实际ACL/同HANDLE计数EOF独立hash/精确ledger释放本地技术门，仍incomplete/not-evaluated。开发自测不作为本次接受依据。

不证明sidecar JSON/schema、父进程重开、ASAR来源安全复制/解析、完整manifest/reader、签名、安装运行、真实GUI/API/干净Windows或持久化。无Git/清理、无AGENTS新增规则，窗口closed。仍存在原reader计划52–62行ASAR source HANDLE→私有副本的本地实现缺口，可继续四批内工作，不第五批。
