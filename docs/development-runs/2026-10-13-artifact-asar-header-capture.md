# M13 ASAR header capture development record

## Goal and scope

Add the internal, bounded ASAR size/header pickle capture from the original M10-owned output HANDLE. The endpoint accepts only the registered M10 session, confirms the exact M10-saved M9 session/entry/state tuple before M9 revocation is allowed, calls the existing M11 full re-read and EOF/hash verification before and after the range capture, and returns exact byte arrays only on complete success. The archive remains `incomplete` and signature status remains `not-evaluated`.

This slice does not parse or publish ASAR JSON, inspect packed or unpacked members, bind a build source, verify signatures, or establish runtime behavior. The coordinator-gated real HANDLE test was added for later acceptance but was not run in this development window.

## Changes

- Added `apps/desktop/scripts/windows-artifact-asar-header-capture.ps1`. It captures the complete owner references and scalar bindings before live M9 pairing, seeks only the captured target HANDLE to zero, reads the exact eight-byte prefix, validates the declared header against the 12-byte minimum, four-byte alignment, 8 MiB header limit, and 2 GiB archive limit before allocating the header array, then reads in fixed chunks through M9's native port. Every failure returns empty byte arrays and fixed diagnostic fields. Only the captured M10 state is revoked on an unpaired failure; the captured M9 state is revoked only after exact pairing succeeds.
- Added `apps/desktop/scripts/test-fixtures/windows-artifact-asar-header-capture-probe.ps1` and `apps/desktop/src/windows-artifact-asar-header-capture.test.ts` for synthetic sessions, managed-memory native-call stubs, malformed bounds, read faults, before/after M11 rejection, owner replacement, byte-array type and equality, and close retry.
- Added `apps/desktop/src/windows-artifact-asar-header-capture-handle.test.ts` as a coordinator-gated real Windows HANDLE test over a self-created source archive and private M10 copy.

## Feedback loop

The first pure regression run had 28 passing tests and two failures: negative and oversized captured archive lengths left the saved M9 state ready. The cause was confirmed in the new endpoint: it rejected the captured length before confirming the saved M9 tuple against the live registry. The owner tuple and scalar snapshot now precede live pairing, while captured-length validation follows exact pairing. This lets the endpoint revoke the exact M9 state for a confirmed owner failure and still preserves both original and foreign M9 states on a mismatched tuple. The targeted suite passed after the correction.

The worktree did not contain the dispatch receipt at its same-named `.benchmarks` path; the dispatch receipt in the main checkout supplied the 450-file baseline and dependency map. This was an artifact-location issue, not a product or test failure.

## Verification

- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-asar-header-capture.test.ts` — passed, 1 file and 33 tests. The pure probe used synthetic state and a managed-memory stub; it did not open a HANDLE or call native APIs.
- `pnpm --filter @project-xray/desktop typecheck` — passed (`tsc -p tsconfig.json --noEmit`).
- Windows PowerShell 5.1 `System.Management.Automation.Language.Parser.ParseFile` on the production module and pure probe — passed.
- The HANDLE test, native/API paths, build, dist, Electron, full desktop suite, and actual 2 GiB archive were not run, as required for this development window.

## Baseline and handoff

The dispatch receipt recorded 450 original paths and five authorized additions. Before editing, the original paths matched the receipt hashes and raw copies; the five authorized target paths were absent. After implementation, all 450 original files still match both the receipt hashes and raw copies. The final inventory contains 455 files, with no missing or extra paths, and all five authorized additions are present. The source M10/M11/M12 dependencies matched the dispatch hashes. No Git action was performed. This checkout is frozen for independent review; local validation is not HANDLE or UI acceptance.

## Rule review

No `AGENTS.md` rule was added or revised. The confirmed ordering defect was corrected in this implementation, and the existing verified M11 owner-pairing rule already requires the same captured-tuple behavior. The added tests provide a focused regression for that boundary without implying real HANDLE acceptance.

## Independent review follow-up

The independent review found that the first HANDLE fixture's hand-built `{}` header is rejected by M12 as `invalid-header-shape`; it showed bounded reads but not producer compatibility. No new production defect was found. The authorized follow-up changed only this HANDLE test and this record. It left the M13 endpoint, pure probe/test, and original 450 files frozen.

The HANDLE test now creates empty and Unicode ASARs with the installed `@electron/asar` 3.4.1 producer, and builds large owned pickle fixtures with that package's `lib/pickle.js` producer. Successful M13 byte ranges are passed directly from the private binary test packet to M12 in memory; the packet is never printed or converted to text. The cases cover a valid empty tree, a Unicode path, a header crossing 1 MiB, exactly 8 MiB, a malformed size prefix, and a header over the cap. A source-contract assertion checks that prefix and length validation precede the managed header allocation.

The real M13 path cases also exercise fixed target-read, owner-recheck, metadata, borrowed-source, borrowed-directory, and before/after M11 observation faults; a foreign live M9 tuple; late in-memory M9 state replacement; held rename/delete denial followed by deletion after close; and M10 close retry. The injected failures change only returned observations or test-owned registry state. They are marked as fixture observation/state faults and do not simulate concurrent writes to the source or target files.

Follow-up validation was limited to `pnpm --dir apps/desktop typecheck` and Windows PowerShell 5.1 `Parser.ParseInput` on the embedded test script; both passed. The HANDLE test, M12 preflight, and all Vitest suites were not run in this developer window. This is authored coverage awaiting the coordinator's Windows HANDLE rerun, not M13 acceptance.

The final inventory still matches the independent receipt's 455 paths with no missing or extra files. Only the two authorized old paths in this follow-up differ from the receipt; the other 453 match both the receipt hashes and frozen raw snapshot. No Git action was performed.

No new engineering rule was added: the review identified an acceptance-coverage gap, and the new real HANDLE cases still require coordinator execution before they establish a verified engineering finding.

## Extended coordinator rerun follow-up

The coordinator's extended run reported 50 cases: 34 passed and all 16 HANDLE scenarios returned the fixed `M13_FIXTURE_OPERATION_FAILED` result. This is a test-fixture failure, not evidence of an M13 product failure. The receipt did not contain a stage or sanitized exception category, so the common runtime cause remains unconfirmed.

Static review confirmed that the HANDLE harness collapsed every caught PowerShell exception to that generic code. The fixture now records a fixed stage and an allowlisted error category (`argument`, `io`, `access-denied`, `invalid-operation`, `method-invocation`, `powershell-runtime`, `native-call`, `other`, or `none`) in its private packet. JavaScript producer, child-process, and M12 exceptions are also reduced to fixed stage/category errors. No exception text, filesystem path, source content, or captured range is included in diagnostics.

The safety review found that recursive removal of the temp-root by path prefix did not prove ownership of every member. That cleanup is removed, along with the path-based target delete after the M9 HANDLE closes. The test leaves its generated temp materials in place, retains the held rename/delete denial checks, and reports M10/M9, M4 source, M8 output directory, application directory, and portable-input release proofs separately. If a held rename unexpectedly succeeds, the test leaves the moved fixture in place rather than restoring it by path.

This follow-up is limited to the HANDLE test and this record. The pre-edit HEAD was `455d4ad50830ee2495b70927e51caf830a4efbb8`; the existing worktree had 275 modified/untracked status entries, all preserved. Before editing, the extended receipt and frozen snapshot matched all 455 paths byte-for-byte. The common runtime cause still needs a coordinator run using the new fixed diagnostics; this developer window does not run Vitest, HANDLE/native code, build, or Electron.

No engineering rule was added. The generic fixture failure is not yet a confirmed technical defect with a tested prevention action, and the cleanup correction is confined to this test harness.

After this follow-up, the final inventory again matches all 455 receipt paths with no missing or extra files. Exactly the two authorized paths differ from the receipt; the other 453 still match the frozen raw snapshot. Desktop typecheck and Windows PowerShell 5.1 AST parsing passed. No test, M12 preflight, HANDLE/native call, build, or Electron execution was performed. The fixture-cause diagnosis and independent HANDLE acceptance remain pending.

## Safe coordinator rerun and first-failure latch

The next coordinator run reported 50 cases: 38 passed and 12 HANDLE failures. All 12 carried category `powershell-runtime` and the reported stage `release-portable-input`; the M10/M9/source release proofs were false while the output-directory, application-directory, and portable-input proofs were true. Static review confirmed that `Set-M13FixtureFailure` stored the first category but reused a mutable stage variable that `finally` kept updating. Therefore `release-portable-input` was the last cleanup stage, not valid evidence of the first failure or a portable-input release defect. The underlying first runtime failure remains unconfirmed.

The test now stores a write-once `firstFailureStage` separately from `currentStage`; cleanup updates only the latter. It also carries a fixed error-code field. Exact matches against the finite M4–M13 fixed-code allowlist emit that code; all other exception messages emit `unknown`. Error categories remain enumerated. Release-state failures use the fixed `release-unconfirmed` category/code. The packet exposes both stages, category, and code without exception text, paths, source, or captured bytes.

This confirms a test-harness diagnostic defect only. No product failure is inferred from the overwritten stage or from the incomplete release flags. This developer follow-up used only static review, desktop `tsc --noEmit`, and Windows PowerShell 5.1 `Parser.ParseInput`; no Vitest, HANDLE/native, build, or Electron command was run. No AGENTS rule or public development record was changed.

The final static verification passed `pnpm --dir apps/desktop typecheck` and Windows PowerShell 5.1 parsing of the embedded script. A focused audit of the seven M4–M13 PowerShell modules found 133 fixed throw codes, all present in the fixture allowlist. The coordinator receipt and frozen raw snapshot each contain 455 paths; after this follow-up, the two authorized files differ from the original hashes and the other 453 match both hashes and raw copies, with no missing or unexpected receipt paths. No test, M12 preflight, HANDLE/native call, build, or Electron execution was performed. The actual first runtime failure and independent HANDLE acceptance remain pending.

## Producer close lifecycle follow-up

The coordinator's first-failure-latched rerun reported 50 cases: 38 passed and 12 failed in 22.76 seconds. All 12 failures had first stage `open-source-session`, category `powershell-runtime`, and fixed code `OPEN_REJECTED`; they occurred before M13 was entered. Four synchronous-pickle-material HANDLE cases passed. This is the observed fixture failure boundary, not a product failure.

Static review of the installed `@electron/asar` 3.4.1 source at `node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/disk.js` found that `writeFileListToStream` returns `out.end()` (line 88), `writeFilesystem` returns that result (lines 90–93), and `createFilesystemWriteStream` creates the output with `createWriteStream` (around line 200). `await createPackage` can therefore settle before the stream's close event. The old harness then synchronously started PowerShell in the same Node process, blocking its event loop. The 12 failing cases all used the package producer, while the four passing cases used synchronous pickle writes. Together these observations support a producer-stream lifecycle inference; they do not confirm it as the root cause until the coordinator reruns the updated fixture.

The package-produced archives now come from a bounded child launched with `process.execPath` that requires only the installed `@electron/asar` package. The parent waits for normal child exit without calling `process.exit`, then checks file type, size, modification time, and SHA-256 before M4 opens the source. After the PowerShell fixture exits, the test checks the source material's size and hash again. Child failures map to fixed categories; subprocess output and raw errors are not surfaced. Synchronous pickle fixtures and all existing M13 fault, owner, held-rename/delete, close-retry, and release assertions remain in place. Generated materials continue to be retained.

The first local `pnpm --dir apps/desktop typecheck` after this change failed with TS2339 because `spawnSync` exposes `child.error` as `Error`, which has no typed `code` property. The failure was in the test harness; using an `in` check narrowed the property safely. The rerun passed, as did Windows PowerShell 5.1 `Parser.ParseInput` on the embedded script. No Vitest, HANDLE/native, M12 preflight, build, or Electron command was run. Independent coordinator rerun is required to confirm or reject the lifecycle inference.

No engineering rule was added. The final receipt/raw audit found 455 paths in each inventory: these two authorized files differ from their frozen hashes, while the other 453 remain byte-identical. There were no missing or unexpected receipt paths.
