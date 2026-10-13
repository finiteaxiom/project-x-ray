# 4B-M11 artifact copy re-verification

## Goal and boundary

Add an internal operation that re-reads a ready M10 private copy through its original M9-owned HANDLE. It must prove exact length, EOF, SHA-256, target metadata, and live owner references on every call. It must leave the borrowed M4 source and M8 directory open and unchanged, revoke ready state after an exact-owner failure, and retain the existing close and retry path.

This slice does not add ASAR parsing or reader orchestration. Its DTO reports `snapshotStatus=incomplete` and `signatureStatus=not-evaluated`; it does not claim parser, build, signature, or runtime evidence.

## Baseline and implementation

Before editing, all 442 dispatch-baseline files matched their saved SHA-256 values and raw copies. The five assigned paths were absent. M4, M8, M9, and M10 dependency hashes matched both the dispatch receipt and the main checkout. The baseline files remained byte-identical at final reconciliation.

The new PowerShell module resolves the exact registered M10 owner and the matching live M9 entry, captures the complete target metadata, digests, counters, object references, and target handle, then seeks only that target handle and computes an independent bounded SHA-256 readback. It checks M4 source and M8 directory stability before and after the read, then checks the full target metadata and both owner ledgers again. Failure revokes M10 and M9 ready state without removing entries or closing borrowed sessions. The result contains only fixed status codes, bounded counts, hashes/proofs, and the incomplete/not-evaluated markers.

The existing `Get-XRayPrivateCopyOutputFileEntry` helper enforces a zero-length output, which is correct during M10's construction phase but rejects the completed nonempty artifact. M11 therefore checks the exact M9 session entry and uses M9's fixed metadata validator with the captured completed length; it does not change the frozen M10 helper.

The Windows fixture covers ordinary, empty, Unicode, multiblock, and 33,554,433-byte material; repeated verification; clone and released-owner rejection; ready-state revocation for identity, metadata, source, directory, ledger, read, count, EOF, seek, and digest failures; and M10 close retry after an unconfirmed release. Its hash-mismatch fault changes only bytes in the fixture's read buffer, not the target file. The fixture reports source read/seek counts so the independent HANDLE window can verify M11 never reads or seeks the borrowed source.

## Feedback and validation

The first pure test run found that PowerShell converted a null `[string]` parameter into an empty string in the success DTO. The DTO builder now accepts those optional values as `[object]`, preserving actual nulls. The suite then passed, including a bounded-size rejection test that confirms unsafe counts are not echoed.

The first independent review ran the original pure and HANDLE files: 39 of 40 tests passed, with desktop noEmit passing. The HANDLE fixture's `owner-reference-change` injection could not find a session because its script-scoped session variable was never assigned; the root's temporary diagnostic binding reached the intended owner-reference marker, confirming a fixture defect. The fixture now binds the exact session returned by M10, and the HANDLE test remains unchanged.

The review also reproduced an M9 ownership mismatch through the actual pure helper and registries. M10's `outputFileSession` was redirected to a separately registered M9 session while its saved M9 entry/state remained unchanged. The verifier correctly rejected before any read or seek, but it had replaced its captured `fileState` with the foreign entry's state, so failure handling revoked the foreign owner. The verifier now captures the M10-stored M9 entry and state first, confirms that exact session/entry/state tuple in the live M9 registry, and records whether that pairing was confirmed. Failure revokes the captured M10 state; it revokes M9 only after the tuple was confirmed, and only through the captured M9 state object. It never follows a live entry's replacement state. If the tuple is already mismatched, the foreign and original M9 states remain untouched, while M10 becomes rejected and its existing Close path reports unconfirmed rather than reconstructing a binding.

Pure regressions exercise the foreign-session mismatch, the live M9 entry changing state after capture, and the existing exact-owner failure/Close path. The foreign mismatch rejects with zero reads/seeks, keeps both M9 states ready, and preserves M10 Close's unconfirmed result. A post-capture replacement remains ready while only the captured M9 state and M10 owner are revoked.

- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-copy-reverification.test.ts` — passed, 20 tests. These tests use synthetic ledgers and a managed-memory read stub; they do not exercise file HANDLEs or native APIs.
- `pnpm --filter @project-xray/desktop typecheck` — passed (`tsc --noEmit`).
- Windows PowerShell 5.1.26100.9444 `Parser.ParseFile` over the production module and HANDLE fixture — passed.
- Final inventory reconciliation: 442 original files plus the five assigned files; all original and raw-baseline hashes match, with no extra or missing files.

After the review fixes, the pure suite passed 20 tests. Typecheck and PowerShell 5.1 AST parsing passed again. The HANDLE fixture and its tests were not executed in this development worktree. Actual M9 HANDLE reads, rename/delete behavior, native fault injection, the 2 GiB boundary, and post-fix independent acceptance remain unverified. Build, dist, Electron, GUI/API, and ASAR parser checks were outside this slice's validation gate.

## Rule review

No `AGENTS.md` rule was added or changed. The M10 helper's construction-only zero-length assumption is handled within the new slice, and the other observations are specific to this implementation or pending independent HANDLE validation.
