# Electron interaction acceptance matrix

This is a prepared matrix, not a report of completed Electron or provider acceptance. Run it only after the explanation/consent UI and backend contract are integrated into a real Windows Electron build.

## Test channels

- **Local UI/offline:** operate the actual Electron UI with networking disabled. Confirms that indexing, graph queries, and existing local explanation behavior remain available; it does not test a model provider.
- **Local protocol substitute:** a deterministic, local-only provider substitute may return delayed, refused, incomplete, malformed, or deliberately mis-cited responses. Clearly label all such results as test data. They cannot establish OpenAI compatibility, remote privacy, or production credential behavior.
- **User-operated privacy/credential controls:** the computer-use skill does not permit automated changes to app security/privacy settings or automated responses to those permission prompts. The user must manually grant/revoke per-project sharing and enter/delete any real credential. Do not use database edits or test flags to claim GUI consent acceptance.
- **Real remote:** a separate, explicitly user-approved check with an available account/key and project selection. No API key is currently available, so do not make a remote request or mark this channel passed.

## Scenarios

| ID | Scenario and action | Channel | Expected result | Prepared status |
| --- | --- | --- | --- | --- |
| E-01 | Start with networking unavailable and no provider configuration. Import alpha and use local indexing/search/explanation paths. | Local UI/offline | Core index and graph navigation work without a provider. No remote request is attempted; any local result is labeled as deterministic/local. | Prepared; not run in this batch. |
| E-02 | Attempt an explanation before provider configuration or per-project sharing approval. | Local UI/offline, then local protocol substitute if needed | No code/metadata leaves the device. The user sees an unavailable/consent-required state and can still use local evidence. | Prepared; not run. |
| E-03 | Manually grant sharing for alpha, start a delayed substitute response, then manually revoke sharing before it returns. | User-operated control + local protocol substitute | Revocation prevents the late result from being presented, persisted, or navigated as current. The assistant must not click through the privacy decision. | Manual user action required; not run. |
| E-04 | Start a delayed alpha explanation, switch to beta, then release the alpha response. | Local protocol substitute in real Electron UI | The alpha response is discarded or remains confined to alpha; beta never displays alpha's text, snapshot, evidence IDs, or source range. | Prepared; not run. |
| E-05 | Start a delayed explanation, change the cited source or the project's evidence-scope configuration, then release the response. | Local protocol substitute in real Electron UI | A result bound to the old source/configuration revision is rejected. The old explanation cannot be presented as current for the new snapshot. | Prepared; not run. |
| E-06 | Return a citation that exactly matches an evidence ID and range in the current evidence bundle; activate its navigation control. | Local protocol substitute in real Electron UI | The UI resolves the evidence against the same repository and snapshot and opens the exact source file and half-open range. The citation does not create or upgrade a graph fact. | Prepared; not run. |
| E-07 | Return an unknown evidence ID, another project's ID, an old snapshot ID, a path/range mismatch, or a range outside the supplied evidence. | Local protocol substitute | Reject the invalid citation/result safely; do not navigate to it or present its claim as supported/verified. Include no raw response or source dump in diagnostics. | Prepared; not run. |
| E-08 | Return a refusal, incomplete response, invalid structured payload, and a response with a conclusion but no citation, one case at a time. | Local protocol substitute | None is treated as a complete explanation. Do not keep partial unsupported claims as successful output; show a safe failure/refusal state and allow only an explicit bounded retry where applicable. | Prepared; not run. |
| E-09 | Cancel an in-flight explanation, then release the substitute response; separately, explicitly retry a transient failure. | Local protocol substitute in real Electron UI | Cancelled/late output cannot update the UI or persistence. A user retry is bounded and does not create an automatic paid retry loop or duplicate result. | Prepared; not run. |
| E-10 | Manually enter/delete a credential using the future settings UI and restart the app. | User-operated control; local credential substitute only until a user provides a real key | Credential lifecycle is confined to Windows OS credential storage; it is absent from SQLite, logs, renderer storage, and repository files. Do not inspect unrelated credentials or environment contents. | User action required; real-key lifecycle not run. |
| E-11 | Use an actual remote provider after separate project consent and credential setup. | Real remote | Verify the fixed provider endpoint/response contract and user-approved minimal evidence transfer. Report separately from every substitute result. | Not run: no API key is available and no project data is approved for remote transmission. |

## Result recording

For each future run, record the build/commit under review, test channel, scenario, result, and safe snapshot/evidence identifiers. Do not copy API keys, source excerpts, raw provider responses, or private absolute paths into this matrix. A local protocol substitute and a real remote call are distinct evidence classes and must have separate outcomes.
