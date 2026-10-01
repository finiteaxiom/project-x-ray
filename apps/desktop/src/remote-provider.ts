import { remoteHashSchema, remoteProviderSettingsSchema, remoteFailureCodeSchema, RemoteExplanationError, type RemoteProviderSettings } from "@project-xray/contracts";
import type { RemoteProviderPort } from "@project-xray/application";
import { OpenAIResponsesProvider, prepareOpenAIResponsesRequest, type PreparedEvidencePackage } from "@project-xray/llm";

function fixedFailure(error: unknown): RemoteExplanationError {
  try { if (error instanceof RemoteExplanationError && remoteFailureCodeSchema.safeParse(error.code).success) return new RemoteExplanationError(error.code); }
  catch { /* A hostile getter or exception text never crosses the application port. */ }
  return new RemoteExplanationError("PROVIDER_FAILED");
}
function request(prepared: PreparedEvidencePackage, rawSettings: RemoteProviderSettings) {
  const settings = remoteProviderSettingsSchema.parse(rawSettings);
  if (settings.model === null) throw new RemoteExplanationError("NOT_CONFIGURED");
  return { settings, wire: prepareOpenAIResponsesRequest({ prepared, model: settings.model, maxOutputTokens: settings.outputTokens }) };
}
/** Trusted composition port, also used with explicitly constructed llm transports in isolated tests. */
export class RemoteResponsesBridge implements RemoteProviderPort {
  constructor(private readonly provider: OpenAIResponsesProvider) {}
  bodyDigest(prepared: PreparedEvidencePackage, settings: RemoteProviderSettings): string {
    try { return request(prepared, settings).wire.bodyDigest; } catch (error) { throw fixedFailure(error); }
  }
  dispatch(input: Parameters<RemoteProviderPort["dispatch"]>[0]): Promise<unknown> {
    try {
      if (!input || typeof input !== "object" || Object.keys(input).some(key => !["prepared", "settings", "bodyDigest", "credential", "signal", "taskDeadline"].includes(key))) throw new RemoteExplanationError("POLICY_INVALID");
      const { settings, wire } = request(input.prepared, input.settings);
      if (settings.credentialStatus !== "configured") throw new RemoteExplanationError(settings.credentialStatus === "unavailable" ? "CREDENTIAL_UNAVAILABLE" : "NOT_CONFIGURED");
      if (remoteHashSchema.parse(input.bodyDigest) !== wire.bodyDigest) throw new RemoteExplanationError("CONTEXT_CHANGED");
      if (!(input.signal instanceof AbortSignal) || !Number.isFinite(input.taskDeadline)) throw new RemoteExplanationError("POLICY_INVALID");
      // generate executes its validation and starts fetch synchronously, before returning this Promise.
      // The llm layer rechecks the digest of the actual body it sends, with no async preflight or retry.
      return this.provider.generate({ prepared: wire.prepared, model: settings.model!, maxOutputTokens: settings.outputTokens, expectedBodyDigest: wire.bodyDigest,
        credential: input.credential, signal: input.signal, taskDeadline: input.taskDeadline }).then(result => result.narrative, error => { throw fixedFailure(error); });
    } catch (error) { throw fixedFailure(error); }
  }
}

/** Production composition is fixed: platform fetch and the official endpoint, with no runtime options. */
export function createProductionRemoteProvider(): RemoteProviderPort {
  if (arguments.length !== 0) throw new RemoteExplanationError("POLICY_INVALID");
  return new RemoteResponsesBridge(new OpenAIResponsesProvider());
}
