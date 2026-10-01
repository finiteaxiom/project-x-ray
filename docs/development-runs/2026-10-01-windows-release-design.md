# Windows release acceptance design

## Goal and scope

Create a reviewable V1 Windows x64 release and install acceptance design. This was a documentation-only 4A preparation task. The authorized outputs were `docs/plans/windows-release-acceptance.md` and this record. No source, package manifest, lockfile, script, existing plan, or `AGENTS.md` was changed.

The scope excludes builds, installs/uninstalls, sample repository code execution, Windows security-setting changes, certificate purchase, public binary upload, auto-update, and Git writes. The user has already chosen to skip clean-Windows acceptance; the design preserves that as unverified rather than asking to prepare an ISO/VM.

## Evidence reviewed

- Confirmed checkout: `D:\Projects\Project X-Ray`; starting and ending HEAD: `00651a5f933f47f03000c0f579b75c73609304f1`; initial worktree was clean.
- Read repository `AGENTS.md` and followed the V1, local-first, no destructive install test, exact-scope, evidence, and development-record requirements.
- Read `package.json`, `apps/desktop/src/main.ts`, `apps/desktop/scripts/windows-portable-acceptance.cjs`, `packages/graph/src/index.ts`, `docs/windows-portable.md`, `docs/plans/2026-10-01-v1-long-development.md`, and ADR-0007.
- The root manifest configures `portable` x64 only, app ID `com.projectxray.desktop`, product `Project X-Ray`, version `0.1.0`, Electron `44.4.3`, and electron-builder `^26.15.3`; `pnpm-lock.yaml` resolves electron-builder `26.15.3`. There is no NSIS target or explicit signing configuration in the inspected manifest.
- The existing `verify:win-portable` script checks package layout and hashes. It does not launch the app, perform installation/migration, or check Authenticode. Its `--preflight` path creates and removes a micro-ASAR, so it was not run.
- `main.ts` derives the app database, per-project databases, and cache from Electron `userData`. `XRAY_E2E_USER_DATA` is a runtime override; the inspected production manifest does not define a separate test identity.
- `GraphStore` currently records migrations through version 9 in this checkout. It enables WAL. Existing legacy snapshots without immutable source are represented as partial. Migration fixtures and backup/restore behavior were not exercised. The separate-worktree 1C-2A implementation is in progress and plans migration 10; that change is not integrated here. Recheck the source and migration ordering when it is integrated.
- ADR-0007 specifies Windows Credential Manager design, but the inspected main checkout has no `CredWriteW`/`CredReadW`/`CredDeleteW` desktop implementation. 1C-2B remains the separate pending desktop/native credential integration; this record does not claim credentials are wired.
- Read the existing [Windows independent acceptance record](2026-10-01-windows-independent-review.md) to bound the historical portable GUI evidence: it used isolated `userData` and controlled fixtures, and it does not validate installer or production database compatibility.
- Official documentation was checked for Electron `userData` behavior, electron-builder NSIS install modes and Windows code signing, and Microsoft's `Get-AuthenticodeSignature` command and `SignatureStatus` enum. These are linked in the design document.

## Changes

- Added `docs/plans/windows-release-acceptance.md`, separating observed current behavior from proposed packaging and acceptance steps.
- Added this development record.
- The plan specifies explicit per-user NSIS configuration for a future implementation, distinct test app identity and `userData`, default data/credential retention, isolated SQLite migration fixtures, a portable/installer/manual interaction matrix, artifact hashes and Authenticode status, and the clean-Windows skipped boundary.
- The original portable/installer matrix wording was revised after review: both artifacts now share one isolated test identity and test `userData`; production path compatibility is limited to read-only source/config inspection or an isolated non-database-opening path check.
- Authenticode handling now records the returned status verbatim. Only `NotSigned` is called unsigned; invalid and unavailable statuses retain their actual failure or unverified classifications. `Valid` is not described as publisher trust.
- Migration wording now attributes in-progress separate-worktree schema version 10 to 1C-2A; the main checkout remains at version 9, and 1C-2B is described separately as pending credential integration.

## Verification and limits

- Read-only source/configuration, historical acceptance-record, official-documentation, and Git-state inspection only; the original starting HEAD and clean worktree are retained above. The existing portable GUI results are cited as historical evidence, not re-run in this documentation correction. No build, test, acceptance script, installation, app launch, Windows-setting change, database migration, credential operation, or Git write was run.
- This record does not verify that an NSIS installer can be built or installed, that data survives an upgrade/uninstall, that migration backups restore, that any artifact is signed, or that Credential Manager integration works.
- Clean Windows remains skipped by user decision. Actual Windows GUI acceptance and real artifact Authenticode results remain outstanding for the implementation/acceptance phase.
- Review identified three documentation consistency defects, not product/runtime failures. Corrections and the actual documentation checks are recorded below.

## Rule review

No `AGENTS.md` rule was added or changed. This task produced a design from inspected configuration and official packaging documentation, but did not reproduce a new engineering failure or validate a reusable implementation lesson. The existing rules and the future acceptance matrix already define the needed evidence boundaries.

## Design review correction (2026-10-01)

### Review, diagnosis, and revision

The independent design review identified three contradictions:

1. **Data isolation:** the original coexistence row called for launching portable and installer builds against the formal user data path, contradicting the test-only boundary. The plan now assigns both artifacts one isolated acceptance identity and one explicit test `userData`; they access the same disposable database sequentially for coexistence, upgrade, restart, and uninstall checks. Formal identity/path compatibility is limited to read-only code/configuration checks or a dedicated test build that reports the resolved path and exits before opening the database/broker. No production database access is allowed as compatibility evidence.
2. **Authenticode states:** the original text collapsed every non-valid result into `NotSigned`. Microsoft documents distinct `SignatureStatus` values including `UnknownError`, `HashMismatch`, `NotTrusted`, `NotSupportedFileFormat`, and `Incompatible`; `Valid` only means syntactically valid and does not imply trust. The plan now preserves the returned status verbatim, treats only `NotSigned` as unsigned, marks invalid statuses failed and unsupported/unavailable states unverified, and requires a separate publisher-trust assessment. Reference: [Microsoft SignatureStatus enum](https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.signaturestatus) and [Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature).
3. **Migration attribution:** the main checkout still has migration 9. Migration 10 is planned by 1C-2A in a separate worktree and is not present here; 1C-2B remains the later desktop/native credential integration. The plan and evidence summary now keep those states separate and require a source recheck after integration.

These are design consistency defects only; no product failure was observed or inferred. The historical portable acceptance record confirms that its real Electron/portable operations used isolated `userData` and controlled fixtures. Those artifact-specific tests remain the verified portable scope; installer behavior and actual formal-data compatibility remain untested. No production database was opened or modified for that historical acceptance.

### Documentation checks

- `git rev-parse HEAD` -> `00651a5f933f47f03000c0f579b75c73609304f1` (the original starting HEAD remains unchanged).
- `git status --short` -> ` M docs/development-runs/2026-10-01-v1-long-development-review.md`, ` M docs/plans/2026-10-01-v1-long-development.md`, `?? docs/development-runs/2026-10-01-windows-release-design.md`, and `?? docs/plans/windows-release-acceptance.md`.
- `Get-Content -LiteralPath docs/plans/windows-release-acceptance.md | Select-Object -Skip 35 -First 66` and `Get-Content -LiteralPath docs/development-runs/2026-10-01-windows-release-design.md | Select-Object -Skip 36 -First 35` -> revised identity/matrix and review/check sections read back.
- `rg -n -e '正式用户数据|同一正式身份|同一隔离|NotSigned|HashMismatch|NotTrusted|UnknownError|迁移版本 10|1C-2A|1C-2B|历史验收证据|正式路径兼容' docs/plans/windows-release-acceptance.md docs/development-runs/2026-10-01-windows-release-design.md` -> confirmed the revised identity, signature-state, migration ownership, and historical-evidence wording is present.
- `$files = @('docs/plans/windows-release-acceptance.md', 'docs/development-runs/2026-10-01-windows-release-design.md'); foreach ($file in $files) { $lines = Get-Content -LiteralPath $file; $bad = @($lines | Where-Object { $_ -match '[ \t]+$' }); if ($bad.Count -gt 0) { Write-Output "$file : trailing whitespace found"; exit 1 } else { Write-Output "$file : $($lines.Count) lines, no trailing whitespace" } }` -> final check reported plan 109 lines and record 65 lines; neither has trailing whitespace.
- A read-only `git diff --stat` / `git diff` of `docs/development-runs/2026-10-01-v1-long-development-review.md` and `docs/plans/2026-10-01-v1-long-development.md` showed coordinator recovery/status updates outside this task. Those two files appeared modified after the initial status check and were left untouched.
- Final `git status --short` includes those two out-of-scope modified documents and the two intended untracked deliverables; final HEAD remains `00651a5f933f47f03000c0f579b75c73609304f1`.
- No product tests, build, installer, app launch, migration, credential operation, or Git write was run.

The review found no new reusable engineering rule: there was no code or runtime defect, and the repository's existing data-isolation, evidence, and release-reporting rules already cover the correction. This round adds zero `AGENTS.md` rules.
