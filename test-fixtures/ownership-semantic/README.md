# Ownership semantic acceptance fixtures

This directory is a static preparation corpus for a future, evidence-constrained semantic rubric. It is not a product contract, an accepted rubric, a model-quality result, or a score implementation. The examples reuse `test-fixtures/ownership-training`; they add no source code or product capability.

`golden-cases.json` records two separate views for each answer:

- `currentOfflineBehavior` describes the current deterministic submission, citation, structure, and semantic status based on `packages/contracts/src/index.ts` and `packages/ownership/src/index.ts`.
- `futureSemanticRequirement` is a review proposal only. It describes what a future evidence-constrained semantic evaluation should distinguish. It does not establish accepted score levels or rules.

The current implementation checks structured answers and required evidence. `gradeAnswer()` leaves free-text semantics as `not-evaluated`; text wording and length do not add points. The submission schema requires at least one citation. A missing citation is therefore an invalid submission before `gradeAnswer()` and must not be represented as a normal gradeable answer.

## Source and identity binding

All paths in the JSON are relative to `test-fixtures/ownership-training`. Every range uses the contract's one-based line numbers and zero-based, end-exclusive columns. The `excerpt` is included for a read-only range check.

The corpus stores stable case and source-range labels, but no repository, snapshot, question, graph-node, or evidence identifiers. Structured answers use symbol labels and range references as static-fixture notation, not as the current submission wire shape. A future fixture loader must import the existing project first, bind identities from that import, and translate these labels to the current contract fields.

`evidenceBindingPolicy` defines the static selection rule: prefer an exact path/range match; allow a containing or overlapping evidence span only after filtering by expected edge kind, endpoint or target symbol, role, and confidence. Range overlap alone must never pick evidence. If the fully filtered selector has no unique match, leave the case unresolved and report why; do not guess or insert an identifier. Cases contrasting snapshots require two actual snapshot identities produced by the loader.

`contextRangeIds` are available to understand a claim but are not required scoring citations. `scoringEvidenceBindings` identifies the required relation. For variable-flow cases, bind `write`, `read`, and `return` separately to current `WRITES`, `READS`, and `RETURNS` evidence targeting the named variable. The read and return anchors may be the same range; materialize two citation objects with their distinct current evidence IDs and use the corresponding `citationIndex` in each role. Do not require call or import citations for these variable-flow scores.

The `token.strip()` range records a source-level call expression whose current `CALLS` confidence is `unknown`. It is context only. The source shows that the expression result is assigned to `cleaned` and then returned; it does not prove the argument type, method target, or whether the result equals the input. Keep the unknown confidence and do not claim a particular runtime behavior as verified.

## Coverage

The cases cover correct structure with a wrong explanation, a correct explanation with no citation or a non-supporting citation, equivalent wording, reversed call direction, a static path overstated as guaranteed runtime behavior, a variable-role misunderstanding, cross-snapshot rejection, duplicate citations, and prompt injection inside answer text. `notEvaluatedOperationalScenarios` separately records the expected `not-evaluated` behavior for cancellation, no model, and invalid evaluator output.

Prompt-injection text is ordinary untrusted answer data. It is included for evaluation design only; it must never be interpreted as an instruction by a fixture loader or evaluator.

## Read-only validation

The preparation check is limited to JSON parsing and checking unique case IDs plus each referenced source file, symbol, line/column range, excerpt, and static evidence selector. It does not run the fixture, import it into the product, call a model, or evaluate a score. Passing these checks establishes only that the static references are reviewable; an independent reviewer still needs to confirm that each selector resolves to the intended current snapshot evidence.
