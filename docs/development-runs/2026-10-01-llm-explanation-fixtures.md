# LLM explanation fixture and acceptance-matrix preparation

## Goal and scope

Prepare a small, self-authored source fixture set with reviewable evidence expectations and a later real-Electron interaction matrix for the first V1 evidence-constrained explanation slice. Work is limited to new files under `test-fixtures/llm-explanations/` and this record. No application, contracts, desktop, UI, shared package, lockfile, coordination plan, AGENTS, or older development record was changed by this batch.

## Authorization and baseline

- Read the latest coordination-review thread directly with `read_thread`. Its latest user messages authorize planning/developing the first four long-running batches and say no API account/key is currently available, so local implementation and acceptance preparation should proceed. A separate latest user answer skips creating a clean Windows VM; this batch does not create one.
- Repository root and HEAD at start: the requested Project X-Ray checkout at `d222036d59472612278cadced8422e53c16d7455`.
- The target fixture directory did not exist before creation.
- The working tree already had an unrelated modified `docs/plans/2026-10-01-v1-long-development.md` and untracked `docs/development-runs/2026-10-01-v1-long-development-review.md`. They were read only as needed and left untouched. During this batch, coordination committed those two files as `4fa77307e9527bc88c07716e8016c0eeb91d0020`; this task did not perform that Git write.
- Coordination later accepted the independent design in docs-only commit `fde7b95184fc3425b95a75c1f730d13084cc762c`. It does not overlap this fixture/record scope and was not changed by this task.
- Current plan assigns this 1B slice to fixture/matrix preparation and forbids business code, shared dependencies, and plan changes. Its later baseline text and existing coordinator edits were preserved.

## Existing evidence reviewed

- `explainFeature` requires a current snapshot and current policy, returns no steps when no symbol matches, and otherwise builds a bounded static call explanation with unresolved side edges and truncation uncertainty. Its summary explicitly distinguishes a candidate path from a proven entry point or runtime trace.
- Existing application tests cover source staleness, rejected stale explanation requests, unknown side calls at separate locations, unresolved edges, and graph-query truncation.
- The TypeScript analyzer's existing tests prove that same-named nested functions receive distinct symbols and call evidence, and that a dynamic `target()` call remains an `unknown` unresolved target.
- Existing feature-explanation UI tests cover exact current-snapshot evidence navigation, stale async response rejection, safe retry, zero-step responses, and duplicate navigation control. The current UI opens evidence by looking up the returned evidence ID for the active repository/snapshot; it does not accept arbitrary source ranges as proof.
- Existing contracts represent explanations with repository/snapshot references, step node/evidence IDs, and `verified`/`inferred`/`unknown` confidence. The user contract and plan continue to treat LLM narrative as secondary, inferred output.

## Files added

- `test-fixtures/llm-explanations/project-alpha/src/dashboard.ts`: direct static calls, one conditional call, a dynamic indexed handler call, and same-named top-level/nested functions.
- `test-fixtures/llm-explanations/project-alpha/src/legacy.js`: a minimal JavaScript direct-call/navigation case.
- `test-fixtures/llm-explanations/project-alpha/src/summary.py`: a minimal Python function and one deliberately untrusted code comment.
- `test-fixtures/llm-explanations/project-beta/src/dashboard.ts`: same relative TypeScript path and symbol names as alpha, but distinct project source.
- `test-fixtures/llm-explanations/golden-expectations.md`: source locations, expected static relationships, unknown limits, insufficient-evidence case, and project/snapshot freshness rules. It contains no guessed snapshot/evidence IDs and no golden model prose.
- `test-fixtures/llm-explanations/electron-acceptance-matrix.md`: offline, consent, revoke, cross-project, stale-response, exact citation navigation, invalid citation/refusal/incomplete, cancellation/retry, restart/credential, and real-remote scenarios. UI security/privacy approval and real credential entry are explicitly user-operated gates; substitute and remote channels are separate.

All sample files are static only; they contain no executable test harness, dependency manifest, real secret, network URL, or generated artifact. No sample source was executed, imported, or sent to a provider.

## Verification performed

- Read the current plan, contracts, `explainFeature`, relevant application/UI navigation implementations, and existing analyzer/application/UI tests.
- Cross-checked the expected `verified`/`unknown` and nested-scope cases against existing analyzer tests and code. The listed source ranges are TypeScript parser call-expression ranges (`getStart` through `getEnd`, half-open columns), not guessed evidence IDs.
- Ran a PowerShell literal-range check using `(Get-Content <path>)[<line>-1]`, `IndexOf(<call text>, Ordinal)`, and `start + callText.Length`; after correction, all seven listed call-site ranges matched. A recursive inventory check found no dependency manifest or compiled artifact.
- Confirmed the requested target directory was absent, then created fixtures only under that root and the development record listed above.
- No automated tests, build, sample execution, fixture import/index, dependency installation, credential access, network/provider request, privacy-setting change, or Git write was performed. The coordinator owns Git closeout and independent real Electron acceptance.

At the final read-only Git check, HEAD was `fde7b95184fc3425b95a75c1f730d13084cc762c`; the only untracked paths were this development record and `test-fixtures/llm-explanations/`.

## Failures and diagnosis

The first static range check expected the beta call to end at column 28; measuring the exact source substring showed the correct half-open end is 29. The golden range was corrected and all seven source-range checks then passed. This was an authoring expectation miscount, not a product or test failure. An exploratory search also assumed a separate `packages/analyzer-javascript` path that does not exist; the repository handles `.js` with `TypeScriptAnalyzer` in `packages/analyzer-typescript`, confirmed from its supported-extension and `ScriptKind.JS` code. This was a search-path mismatch, not a product failure. The first working-tree check also found the two existing uncommitted coordinator documents noted above; they are unrelated and remain preserved.

## Not verified

- No actual provider request was made; the user has no API key. Remote compatibility, privacy transfer, and model response quality remain unverified.
- No real Electron interaction was run for this batch. The matrix is a prepared procedure; local protocol-substitute results, future GUI results, and real remote results must be reported separately.
- No fixture indexing/analyzer run was performed, so the gold locations are grounded in source and existing analyzer contracts but have not yet been confirmed against an imported SQLite snapshot. IDs remain intentionally runtime-derived.

## Rule assessment

协调方独立验收另见[本轮审查记录](2026-10-01-v1-long-development-review.md#1b-独立静态验证)：实际调用TS/Python分析器核对金标已通过；本开发线程上述“未运行分析器”描述仅限自身准备操作，不能覆盖协调方结果。SQLite持久化导入、Electron和真实远程仍未验收。

No `AGENTS.md` rule was added or revised. The existing evidence, untrusted-input, no-sample-execution, feedback-record, and engineering-experience gates already cover this work. Preparation alone surfaced no new confirmed general engineering issue.
