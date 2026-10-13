# 4B-P bounded PE header observation

## Goal and scope

Add a pure CommonJS observation module that can be consumed by a future reader without changing the accepted manifest protocol, existing reader, handle bridge, portable acceptance script, or shared worktree files. The module accepts an explicit file length and a copied DOS header capture, then issues only the bounded 24-byte range containing the PE signature and complete COFF header. A second call accepts only that exact issued range and a capture no longer than 24 bytes. The private request token binds the call to its issued offset and explicit length; the caller remains responsible for actually reading those bytes from the correct handle and range.

The result contains only finite observation fields: `peStatus`, the four-digit uppercase machine code or `null`, an `x64`/`x86`/`unknown` architecture label or `null`, and a fixed issue code or `null`. A valid PE signature with an unsupported machine code remains `pe` and preserves the code while labeling its architecture `unknown`. A mismatched DOS signature is `non-pe`; insufficient captures, invalid offsets, out-of-file ranges, and a mismatched PE signature are `unknown`.

The module performs no filesystem, child process, network, native, or candidate-code operations. It does not establish which handle produced a capture, that the file stayed stable between reads, source identity, execution eligibility, ABI compatibility, or Authenticode validity. Those claims remain outside this module and require evidence from the owning reader or other authorized layer.

## Baseline and preservation

- Checkout: detached `HEAD` `79417e0974af9ad5da637aa19361a91cb152b486`.
- The supplied `.benchmarks/long-lived-staff/baseline.json` SHA256 matched `965DF736243A478EBFD309BCDAD002A88FA0E9C8C89FA22956E135DA692025B6`.
- All 494 listed source copies and checkout files matched their baseline SHA256 before implementation. The pre-existing working image was preserved as the starting point; only this record, the module, and its test are task deliverables.
- `node_modules` resolves through the read-only junction to the main checkout. No dependency installation or build/native/dist/Electron operation was performed.

## Implementation and verification

The module keeps each read range in a private `WeakMap`, freezes the returned range/result, copies captures using typed-array intrinsic accessors, rejects proxies/accessor-shaped input, and caps copies at the DOS/PE header sizes. Known machine codes remain in the manifest's existing four-digit hexadecimal field format.

The first run of the targeted Vitest command had 30 passing tests and one failure in the new import-purity test. The test expected `fs.readFileSync` to have zero calls, but Node's CommonJS loader itself reads the module source once while requiring it. This was a test defect: the module had no extra file read. The assertion now permits only that one loader read of the module path.

After the correction, these commands passed:

- `pnpm exec vitest run apps/desktop/src/windows-artifact-pe-observation.test.ts apps/desktop/src/windows-artifact-manifest-protocol.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'` — 2 files and 31 tests passed.
- `pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit` — passed.
- `node --check apps/desktop/scripts/windows-artifact-pe-observation.cjs` — passed.

The post-run raw before/after SHA256 report is `.benchmarks/long-lived-staff/delivery/before-after-sha256.json`; all 494 baseline files remained byte-identical. The reconstructible three-file patch is `.benchmarks/long-lived-staff/delivery/increment.patch`.

## Failures and fixes

The initial import-purity assertion was reproducibly too strict because requiring a CommonJS file causes the loader to read that file. It now verifies the sole read targets the module itself, and the targeted suite passes. No product or environment failure was confirmed.

## Unverified limits

- The pure module is not wired into the frozen reader or manifest CLI in this batch; the reader remains responsible for same-handle reads, file identity, and file-length stability.
- No GUI, Electron, native, build, distribution, or candidate artifact execution was performed.
- Independent root review and integration acceptance remain pending.

## Engineering rules

No `AGENTS.md` change is proposed. This batch adds a narrowly scoped pure module, and the captured-input bounds and evidence limits are already covered by existing repository rules; no new generally applicable failure has been demonstrated.
