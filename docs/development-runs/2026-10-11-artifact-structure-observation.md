# Windows artifact structure observation (4B-A)

## Goal and boundary

Add a pure CommonJS observer for bounded caller-captured ASAR entry names and physical unpacked/extra-resource path lists. Keep the supported profile explicit and Windows x64 only. The observer reports only the existing v1 structure status and issue vocabulary plus bounded counts/check flags; it does not scan, open, parse, execute, hash, or authenticate artifacts.

Only these three formal files were added:

- `apps/desktop/scripts/windows-artifact-structure-observation.cjs`
- `apps/desktop/src/windows-artifact-structure-observation.test.ts`
- `docs/development-runs/2026-10-11-artifact-structure-observation.md`

## Baseline evidence

- HEAD remained `79417e0974af9ad5da637aa19361a91cb152b486` (detached).
- `.benchmarks/long-lived-staff/baseline.json` SHA-256 matched the supplied `965DF736243A478EBFD309BCDAD002A88FA0E9C8C89FA22956E135DA692025B6`.
- The baseline listed 494 paths. Before implementation, all 494 working files and all 494 byte copies under `.benchmarks/long-lived-staff/files/` matched their listed SHA-256 values; there were zero mismatches.
- All three target paths were absent from the 494-path baseline and absent from the checkout before implementation.

## Implementation

- The capture schema requires explicit `profileId`, independent complete/incomplete claims for ASAR, unpacked files, and extra resources, plus three bounded lists. Each ASAR entry is now `{ path, file, unpacked }`; `file` and `unpacked` must be explicit booleans to evaluate the profile. A `null` metadata value makes the structure `not-evaluated` with `profile-incomplete`. Capture copies own data fields only, rejects accessors, proxies, aliases/cycles, symbols, unknown object fields, unsafe values, ambiguous Windows case variants, duplicate paths, escapes, invalid separators, and oversized lists/paths.
- Profile `project-xray-windows-x64-electron-builder-v1` reflects the current `tsup` entry list, Vite UI output, root electron-builder settings, and the existing copy scripts. It requires `main.js`, `preload.js`, `analysis-worker.js`, `explanation-worker.js`, `remote-execution-worker.js`, `apps/ui/dist/index.html`, and at least one UI JavaScript bundle and stylesheet under `apps/ui/dist/assets/`.
- The profile requires Python only at `resources/python-analyze.py` and rejects it under the desktop `dist/` ASAR entries. Runtime JavaScript/UI entries must be files marked packed; `secure_reader.node`, `windows_credentials.node`, and the SQLite addon must be files marked unpacked and have an exact matching physical path. Unknown native files, including credential test variants, produce `native-unclassified`. SQLite recognizes only the known `better-sqlite3` package-relative paths already used by the portable acceptance script, and requires exactly one ASAR candidate paired with the same physical path. Native traversal uses path maps/sets for exact pairing rather than repeated list scans.
- Unsupported profiles and incomplete capture return `not-evaluated`; neither can return `passed`. Structural findings use only v1 issue codes. The integration fixture passes the returned `structure` object to the existing manifest `deriveManifest` entry and confirms caller evidence remains unverified and signature coverage remains incomplete.

## Feedback loop

The first targeted Vitest run had 4 failures in the new test file while the existing manifest test passed. Inspection confirmed test-construction defects, not product defects:

1. The manifest expectation omitted the existing `capture-not-complete` signature issue and `unknownPeKindCount`; the assertion now checks those fields.
2. The SQLite parameterized fixture filtered out required ASAR entries and retained the default SQLite row before appending an alternate row. It now replaces only that SQLite row, preserving the rest of the fixture.

After those corrections the targeted tests passed. Root's independent review then found a product defect using `.benchmarks/desktop-main-integration/structure-root-mapping-probe.cjs` in the main checkout: the structure result incorrectly passed when all three ASAR native entries were removed but their physical files remained, and when the SQLite ASAR path differed from its physical path. The cause was confirmed in the first contract: it carried ASAR names and physical names separately, with no file/unpacked metadata or exact cross-list pairing. The observer now requires per-entry ASAR metadata and exact path correspondence; tests reproduce both counterexamples plus a same-path-but-packed native entry and unknown metadata. This was a product defect, not a caller or test defect.

After updating the capture fixture to the explicit ASAR record contract, one follow-up test run had one test-only failure: the path-size case still appended a string instead of an ASAR record. The thrown shape error confirmed the stale fixture; it now uses the record helper. The other 43 tests in that run passed. Final results are recorded below.

## Validation

- `& .\node_modules\.bin\vitest.cmd run apps/desktop/src/windows-artifact-structure-observation.test.ts apps/desktop/src/windows-artifact-manifest-protocol.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'` — passed, 2 files and 44 tests.
- `node --check apps/desktop/scripts/windows-artifact-structure-observation.cjs` — passed.
- Initial `& .\node_modules\.bin\tsc.cmd -p apps/desktop/tsconfig.json --noEmit --pretty false` did not pass (exit 2, 218 diagnostics; zero diagnostics named the new test file). At that point the dependency view lacked workspace package links and desktop `electron`/`zod` links. After the coordinator supplied the desktop dependency junction for read-only runtime use, `& .\node_modules\.bin\tsc.cmd --noEmit -p apps/desktop/tsconfig.json` passed (exit 0). No install, build, or dependency change was made.
- No ASAR parser, filesystem scan, subprocess, native code, packaging, dist, Electron, GUI, API, credential, or Git write operation was run.

## Limits and rule assessment

The status is derived only from caller-provided path lists, ASAR file/unpacked metadata, and capture-state claims. It does not prove those lists are complete, tied to a file handle or build, sourced from the declared commit, or representative of runtime loading. A mapped credentials path does not attest the binary's production variant. It does not establish file identity, hashes, PE architecture, signatures, reader completeness, or runtime compatibility; the manifest continues to state `caller-observation-unverified`, signature coverage `incomplete`, and release decision `not-evaluated` in the fixture.

No `AGENTS.md` rule was added. The root review defect is addressed by the local ASAR-to-physical pairing contract; the test failures were fixture mistakes, and the temporary noEmit blocker was resolved by the coordinator's read-only dependency junction. No broader engineering rule was justified. The checkout remains frozen for independent review; no Git integration or collection was performed.

## Root-review baseline reconciliation

The root's 497-entry pre-correction snapshot and its 497 raw file copies were checked against the final checkout. All 497 copies matched their recorded baseline hashes; exactly the three authorized files above differ from that baseline, and the other 494 files remain byte-identical. `.benchmarks/long-lived-staff/after.json` records the final 497-file hashes, and `increment.patch` contains the three-file delta from the root snapshot. `git apply --reverse --check` passed without modifying files.
