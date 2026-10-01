# Windows portable packaging boundary

## Goal and scope

Prepare the Windows x64 portable package so the Python analyzer worker cannot be found first inside ASAR, and add a structural check for the real `win-unpacked` output. This batch is limited to the root packaging manifest, the acceptance script registration and implementation, and Windows packaging documentation. It does not change analyzer or application business source.

The coordinator narrowed this batch to package layout checks plus their own portable executable operation. The structural script does not claim that Electron loaded SQLite or the native secure reader at runtime, or that Python analysis completed. Those remain runtime acceptance items.

## Changes

- Exclude `apps/desktop/dist/python-analyze.py` from the ASAR file set and copy it to `resources/python-analyze.py` with `extraResources`.
- Register `verify:win-portable`, which checks the configuration and the packaged ASAR, resource, and x64 native addon locations, then writes a JSON acceptance manifest.
- Document the build prerequisites, external Python/Git runtime requirements, per-user data location, and the structural script's limits in `docs/windows-portable.md`.

## Verification

Lightweight checks before packaging:

- `node --check apps/desktop/scripts/windows-portable-acceptance.cjs` — passed.
- `pnpm verify:win-portable -- --preflight` — passed; all 9 configuration/tooling and micro-ASAR checks passed.
- `git diff --check` — exit 0; Git emitted line-ending conversion notices, with no whitespace errors.

The coordinator then opened one packaging window. `pnpm dist:win` ran once and exited 0. Turbo built all 10 packages; electron-builder 26.15.3 packaged Electron 44.4.3 for Windows x64. The builder emitted advisory warnings for missing package description/author, the default Electron icon, the already-used `@electron/rebuild` dependency, and the large Monaco bundle. Its log also reported `signtool.exe` processing for the unpacked and portable executables. This batch did not change signing configuration, certificates, system settings, or security settings; Authenticode status was not separately checked.

The first structural run failed at `sqlite-addon-is-unpacked`. Inspection confirmed the packaged binary existed at `node_modules/better-sqlite3/prebuilds/win32-x64.node`; the checker had assumed a `better_sqlite3.node` basename and failed to account for this package's platform-specific prebuild. The checker now recognizes the actual Windows x64 prebuild and the build-from-source Release layout.

The next structural run rejected the outer portable executable as not x64. PE-header inspection confirmed it is a valid x86 wrapper; the unpacked `Project X-Ray.exe` and both native addons are x64. The checker now validates the wrapper as a PE and records its machine separately, while keeping x64 assertions for the actual app and native addons.

After these acceptance-script-only fixes, `pnpm verify:win-portable -- --app-dir dist/win-unpacked` passed all 25 structural checks. It confirmed that ASAR contains the desktop/UI entries and no Python worker; `resources/python-analyze.py` is a physical copy matching source; and `secure_reader.node` plus `better-sqlite3/prebuilds/win32-x64.node` are x64 binaries. The manifest is `dist/Project-X-Ray-0.1.0-portable.acceptance.json`.

Artifact facts from the manifest:

- Portable executable: 112,186,156 bytes; SHA-256 `752a3a365563de76ad17575ac7ea5acac3ee81b091fb1a476fadc9474d9af7b3`.
- Unpacked app executable: x64; SHA-256 `cbb596755aa88d465afa3de3ac5a244c145a2d6eda1ccad70b968fbffd8066b2`.
- `resources/app.asar`: SHA-256 `e313cc0af404cc0cd6fa163e40b2534fc90cf3723e21cf4cdd3a0777ed13c985`.
- Python worker resource: SHA-256 `b8b349fcaa49e68d3c68030b5bdd91c00f9fd4a2664d637057b447c722a6c311`.

The structural checks do not launch Electron or execute a Python analysis. The coordinator will independently rerun the checks and operate the outer portable executable. No GUI, SQLite runtime, native-reader runtime, Python-result, or external-dependency degradation result is claimed by this batch.

## Rule review

No `AGENTS.md` rule was added. The confirmed issues were packaging-acceptance script assumptions and now have concrete regressions or artifact checks; this batch's authorized scope excludes repository-wide rule edits.

## Coordinator follow-up

The artifact hashes above describe the first packaging delivery. Subsequent real degradation acceptance found two product defects; after their fixes, the coordinator rebuilt the portable executable, reran 25 structural checks, and independently operated the new outer EXE. Current hashes, actual Python/Git recovery and snapshot results, and remaining limits are recorded in [Windows independent acceptance](2026-10-01-windows-independent-review.md). The earlier hashes and developer-only verification are retained as historical evidence.
