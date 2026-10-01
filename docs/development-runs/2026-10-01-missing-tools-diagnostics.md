# Overview missing-tools diagnostics

## Goal and scope

Show the existing per-file indexing failures in Overview's index-health panel, including a safe relative path, fixed safe reason, and applicable diagnostic code. When Python is unavailable, provide a concrete PATH, application restart, and reindex instruction. Limit changes to `apps/ui/src/App.tsx`, its `App.test.tsx`, and this development record; preserve the frozen portable packaging batch and coordinator-owned files.

## Reproduction and confirmed cause

During the coordinator's portable-app check with child-process PATH restricted, indexing produced partial health and an SQLite snapshot with `analysis.py` marked `PYTHON_ENVIRONMENT_UNAVAILABLE`; no Python function facts were indexed. Overview displayed “部分索引” but omitted all `health.failedFiles` entries. Source inspection confirmed the Overview rendered counts, ignored rules, and limitations without reading `failedFiles`.

Added a focused UI regression with one Python environment failure and ran it before the UI fix:

- `pnpm --filter @project-xray/ui exec vitest run src/App.test.tsx -t "Overview shows the safe Python environment failure and a reindex instruction"` — failed because the expected failure-file heading was absent. This reproduced the UI omission.

## Changes

- Overview now shows the number of failed files in the always-visible index-health summary and lists normalized failure paths, fixed contract messages, safe diagnostic codes, and valid detail codes inside the expanded health details.
- Failure records pass through the contracts package's `diagnosticFailureSchema`; the UI never renders stored `reason` text. Invalid legacy codes and absolute paths render as the contract's redacted diagnostic and `<项目>`.
- `PYTHON_ENVIRONMENT_UNAVAILABLE` instructs the user to make `python.exe` available on `PATH`, check `python --version` from a new terminal, exit and restart Project X-Ray so it inherits the changed PATH, then reindex with the existing “更新索引” action.
- Added App regressions for Python environment failure, an existing TypeScript analysis failure, no failed files, and unsafe legacy diagnostic/path redaction.

No analysis, IPC, snapshot identity, default ignore rule, or dependency behavior changed.

## Feedback closure and verification

- First post-fix run of the four new tests had three assertion failures because Testing Library did not match message text across adjacent inline `<code>` elements. The rendered content was present; this was a test-query defect. Assertions were changed to inspect complete rendered text content.
- `pnpm --filter @project-xray/ui exec vitest run src/App.test.tsx -t "Overview"` — 4 passed.
- `pnpm --filter @project-xray/ui exec vitest run src/App.test.tsx` — 35 passed.
- `pnpm --filter @project-xray/ui typecheck` — passed.
- `git diff --check -- apps/ui/src/App.tsx apps/ui/src/App.test.tsx` — passed.

The limited-PATH portable GUI case has not been rerun after this UI change. No build, `dist`, or GUI action was run in this batch; the coordinator retains the actual portable verification and Git closeout.

## Rule review

No `AGENTS.md` rule was added. This is a confirmed Overview presentation omission; the existing diagnostic normalization contract and UI regression cover its prevention without a new repository-wide rule.
