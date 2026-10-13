# M10 artifact private copy development record

## Goal and scope

Implement the bounded M10 copy from an already-held, unconsumed M4 source session into an M9-created private output file. The operation streams through a fixed 1 MiB buffer, enforces the 2 GiB maximum, hashes bytes while reading the source, writes through the same M9 target HANDLE, then rewinds only that target HANDLE for independent readback, hash comparison, and EOF verification. M10 retains the M9 owner entry for explicit close or retry and never closes the borrowed M4 source or M8 directory.

The public result keeps snapshot status `incomplete` and signature status `not-evaluated`. The M4 boundary has no owner registry, so this remains a trusted internal caller port; matching metadata binds the held object but does not prove caller authorization provenance. This slice does not establish ASAR/JSON validity, full reader or manifest status, signature coverage, runtime behavior, or the actual 2 GiB boundary.

## Changes

- Added `apps/desktop/scripts/windows-artifact-private-copy.ps1` with bounded chunking, exact M4 session and metadata checks, same-HANDLE source streaming and target readback, fixed summaries, private session ownership, and explicit M9 close retry.
- Added `apps/desktop/src/windows-artifact-private-copy.test.ts` for pure numeric, metadata-conversion, identity-proof, and exact-owner-reference regressions.
- Added `apps/desktop/scripts/test-fixtures/windows-artifact-private-copy-probe.ps1` with isolated fixture modes for normal and faulted HANDLE flows, collision preservation, ACL evidence, and release checks.
- Added `apps/desktop/src/windows-artifact-private-copy-handle.test.ts` for the later coordinator-only Windows HANDLE acceptance window. It was not executed in this development window.

## Feedback loop

Review of the first implementation found four issues before final validation: a dependency-presence probe referenced a nonexistent function; the source SHA-256 finalization expression was invalid PowerShell; failed M9 create sessions were passed through a ready-only validator before their owner entry was retained; and source size violations were combined with metadata mismatch classification. These were corrected. Later review also found that thrown M4 read errors needed a fixed source-read code, and M8 directory drift needed its own changed code. Target metadata failures map to `PRIVATE_COPY_TARGET_CHANGED` so identity drift stays distinct from general M9 creation failures.

The first AST shell invocation itself failed because PowerShell parsed `$file:` as an invalid variable reference. No source file was parsed by that invocation. The command was corrected and rerun using Windows PowerShell 5.1. Two initial inventory probes also produced false extra/missing counts: one included ignored build outputs and the worktree `.git` pointer, and one failed to normalize Windows path separators. The final scoped inventory excludes those control/ignored files and normalizes separators before comparison.

## Verification

- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-private-copy.test.ts --maxWorkers=1 --no-file-parallelism --no-cache` — passed, 1 file and 4 tests.
- `pnpm --filter @project-xray/desktop typecheck` — passed (`tsc -p tsconfig.json --noEmit`).
- Windows PowerShell 5.1 `System.Management.Automation.Language.Parser.ParseFile` on the production module and HANDLE fixture — passed for both files.
- The HANDLE test and fixture were not run. No M4 source HANDLE flow, M8/M9 native operation, ACL query, target mutation attempt, or Windows copy acceptance was performed here. The pure numeric test covers the declared 2 GiB arithmetic boundary only; copying an actual 2 GiB source remains unverified.

## 2026-10-13 independent review follow-up

The coordinator's independent run of the original two files reported 24 passing and 1 failing test out of 25; desktop noEmit passed. The failure occurred in `collision-link` during `prepare-collision`, before copy was attempted. The coordinator's temporary diagnostic reversed only the `FILE_STANDARD_INFO.DeletePending` comparison and then reached the expected collision rejection with the prior and subsequent identity proof and content hash equal and the borrowed M4/M8 sessions held. That diagnostic was not acceptance of the original suite. The coordinator's review record remains in the main checkout and was not copied here.

The confirmed defect was in the fixture's identity sampler: it rejected `DeletePending = false`, and it did not itself prove that the opened HANDLE was the no-follow reparse object. The fixture now requires M4 metadata to reject the held object as `REPARSE_REJECTED`, requires `DeletePending = false`, checks the actual directory flag against the requested type, then samples and validates the full volume serial and 128-bit file ID. The collision test now requires a successful fixture DTO, `attempted = true`, `created = false`, source still unconsumed, equal nonempty before/after identity proofs and content hashes, successful output-session release, and held source/M8 sessions.

Focused verification after this correction: the selected pure PowerShell helper regression passed (1 passed, 21 skipped); it extracted the fixture helper and supplied stubbed metadata and FileInformation values, with no HANDLE or native API calls. Desktop noEmit passed. Windows PowerShell 5.1 AST parsing of the fixture passed. The real HANDLE fixture and suite remain unrun in this worktree.

The initial M10 delivery reconciled its 437-item input and five additions. For the 2026-10-13 narrow follow-up, the main-checkout receipt's `afterSol` map and complete raw backup each contain 442 items. All 442 paths remain present; the current inventory has no extra or missing paths. Exactly the three authorized fixture, HANDLE test, and development-record paths differ from that frozen map; the other 439 are byte-identical, and all raw backup files still match the receipt. The receipt records the root window as not accepted and not integrated.

## Rule review

No `AGENTS.md` rule was added or revised. This is a confirmed fixture test defect with a narrowly applicable correction; existing rules already require preserving reparse and identity assertions, and this worktree still has no independent HANDLE evidence for a broader engineering rule.
