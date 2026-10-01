# Golden expectations

These expectations constrain source facts, provenance, and uncertainty. They do not prescribe LLM wording or treat an LLM sentence as a `verified` graph fact. Read project/repository/snapshot/evidence identifiers from the indexed fixture at run time; never hard-code IDs from another import.

TypeScript and JavaScript evidence uses one-based lines and zero-based, half-open columns as emitted by `spanOf`. The source substring named in each row is the navigation target.

## `project-alpha/src/dashboard.ts`

| Source | Expected fact | Exact source range | Required confidence / limit |
| --- | --- | --- | --- |
| `buildOverview` calls the top-level `describeState` | A resolved in-project `CALLS` edge from the outer `buildOverview` symbol to the top-level `describeState` symbol | Line 20, `describeState(state)`, `[16,36)` | The call edge and expression evidence are expected `verified` for this statically resolved relation; they do not prove that the function ran. |
| `buildOverview` calls `renderDashboard` | A resolved in-project `CALLS` edge from `buildOverview` to `renderDashboard` | Line 21, `renderDashboard(state, mode, handlers)`, `[21,59)` | The call edge and expression evidence are expected `verified`; nested calls in `renderDashboard` remain conditional or dynamic as specified below. |
| The nested `describeState` is distinct from the top-level function | Two function symbols with the same simple name but different lexical scope; `renderDashboard`'s calls target its nested function, while line 20 targets the top-level function | Nested declaration at line 6; calls at line 11 `[11,31)` and line 16 `[9,30)`; top-level call at line 20 `[16,36)` | The resolved call edges are expected `verified`. Do not merge the symbols or cite one function's body as evidence for the other. The existing analyzer convention qualifies nested symbols by their enclosing function. |
| `renderDashboard` has a conditional branch | The call on line 11 is syntactically present under `mode === "panel"` | Line 10 condition; line 11 call | The statically resolved call edge is expected `verified`. It cannot establish that the condition is true or the call occurs at runtime. |
| The selected handler is dynamic | `selected()` has no statically resolved project function target | Line 15, `selected()`, `[17,27)` | Keep the target unresolved/`unknown`; do not invent a concrete handler or make it part of a `verified` call path. |

## Other source files

- `project-alpha/src/legacy.js`: `buildTicketLabel` calls `formatTicket` at line 6, `[9,28)`. The call target is expected to resolve to the function in this same file with `verified` call/expression evidence. This is the minimal plain-JavaScript navigation example.
- `project-alpha/src/summary.py`: `format_summary` is a function in the current project. The quoted comment is untrusted text; it creates no graph fact, instruction, permission, or confidence upgrade.
- `project-beta/src/dashboard.ts`: it has `describeState` and `buildOverview` at the same relative path and names as alpha, but belongs to a different imported project and has different source. `describeState(state)` is at line 6, `[9,29)` and is expected to resolve within beta with `verified` call/expression evidence. A result/citation from alpha cannot be reused as beta evidence.

## Insufficient evidence and freshness

- With alpha imported, a query such as `violet spacecraft policy` has no matching symbol in the fixture. The expected result has no explanation steps and no claim about such a policy; record the actual empty-evidence response, not a fabricated explanation.
- After generating an explanation for alpha, change one expression in `project-alpha/src/dashboard.ts` in the acceptance copy and let the app detect staleness. The old explanation and its citations are not current evidence for the changed workspace. Reindex, read the newly returned snapshot/evidence identifiers, and only then request or navigate using the new result.
- Import beta separately and repeat a same-name query. Its repository/snapshot identity and source evidence must come from beta's actual import. Do not assume snapshot IDs, evidence IDs, or stable node IDs in advance.

All model-generated descriptions, ordering, labels, and summaries are at most `inferred`. Only analyzer-produced source facts retain their existing provenance and confidence. Neither this document nor a protocol substitute is a golden transcript of model prose.
