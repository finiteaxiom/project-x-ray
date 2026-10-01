# Clean Windows acceptance kit preparation

## Goal and scope

Prepare a transfer kit under the existing ignored `dist/windows-clean-acceptance-kit` path for a later clean-Windows acceptance run. The kit contains the already accepted portable executable only if its SHA-256 matches the coordinator-provided value, a self-authored minimal TypeScript/Python sample, and an operational checklist. This work does not perform clean-machine or GUI acceptance.

## Baseline and evidence

- The checkout was at `cc76d243935c833d1437322744a66de7bb5504c7`; the working tree was clean at the start of this preparation.
- `dist/windows-clean-acceptance-kit` did not exist and is ignored by the repository's `dist/` rule.
- The source executable `dist/Project-X-Ray-0.1.0-portable.exe` is 112,190,975 bytes and has SHA-256 `f3c7967fc3d36360292890acce4a994c51b65e32d9b50d121bd84b2872aeb591`, matching the required value. The older dated executable did not match and was not copied.
- `docs/windows-portable.md` says Python and Git are external tools, the app should be fully restarted after PATH changes, and indexing should then be rerun. It also states that user data is stored under the per-user app-data location.
- Contract/source inspection confirmed the fixed diagnostics `PYTHON_ENVIRONMENT_UNAVAILABLE` and `GIT_COMPARISON_FAILED`; the Overview renders failed files with safe messages and Python PATH/restart/reindex guidance.

## Changes made

- Copied only the hash-matching executable into the ignored transfer-kit directory.
- Added a controlled fixture with `src/checkout.ts` (two functions and one static call) and `src/report.py` (one function). Neither file was executed or imported. The fixture has no Git metadata, package scripts, dependencies, secrets, or personal paths.
- Added the acceptance checklist and SHA-256 inventory for the package contents.
- Added this development record. No source code, `AGENTS.md`, or other development records were changed.

## Verification performed

- `git rev-parse HEAD`: returned the required base revision.
- `git status --short`: empty before preparation.
- `git check-ignore -v dist/windows-clean-acceptance-kit`: confirmed the destination is ignored by `dist/`.
- `Get-FileHash -Algorithm SHA256` over existing `dist/Project-X-Ray-0.1.0-portable*.exe`: the current portable executable matched the required SHA-256; the older dated executable did not.
- Recomputed every entry in `dist/windows-clean-acceptance-kit/SHA256SUMS.txt` after writing the package: all five listed files matched. The checksum index itself has SHA-256 `aac0564ddb24bc5b4dcee7fded921259562d38a3dc895f81ac8742db534c9e97`; it is not self-listed.
- Read the portable-app documentation and inspected the applicable diagnostic contract/UI source to make the checklist's diagnostic names and recovery steps specific.
- No build, test, installation, executable launch, sample execution, Git mutation, or OS/security change was performed.

## Issues and diagnosis

The initial scoped `rg` command included a root `src` directory that does not exist in this repository; it reported that path error while still returning matches from the existing `apps`, `packages`, and `docs` paths. This was a search-scope mismatch only and did not affect project files. No product or test failure was reproduced.

## Not verified

- No clean Windows environment was available for app launch, GUI navigation, missing-tool checks, persistence, or Python/Git recovery. Those acceptance steps remain for the coordinator's separate environment.
- The sample is intentionally not a Git repository. Missing-Git diagnostics can be observed by invoking a Git action against it, but positive Git-comparison recovery requires a disposable repository prepared in the separate environment.

## Rule assessment

No `AGENTS.md` rule was added or revised. Existing rules already require controlled inputs, safe diagnostics, external-environment verification, and a development record. This preparation produced no newly confirmed general engineering issue; the clean-machine behaviors remain unverified, so no new rule is warranted this round.

## Coordinator review

The coordinator independently reviewed the fixture and checklist, recomputed all five inventory entries, and verified all five hashes again directly from the six-entry transfer archive. The archive is `dist/Project-X-Ray-windows-clean-acceptance.zip`, SHA-256 `3b58d5e0490f2d5336cbaa923d60ec9acb21d2b394b1858ffb09e2376b47dd73`. Clean-machine interaction is still unverified because the user confirmed no separate environment is available. Current environment, permission retry and actual display-scaling results are tracked in the [coordinator acceptance record](2026-10-01-windows-environment-display-acceptance.md).
