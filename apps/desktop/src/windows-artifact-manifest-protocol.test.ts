import { describe, expect, it, vi } from "vitest";

type ProtocolErrorLike = Error & { code?: string };
type FileObservation = {
  rootId: "portable-exe" | "app-staging";
  path: string;
  bytes: number;
  sha256: string;
  classification: "portable-exe" | "app-file";
  peStatus: "pe" | "non-pe" | "unknown";
  machine: string | null;
};
type AuthObservation = {
  rootId: FileObservation["rootId"];
  path: string;
  fileSha256: string;
  captureStatus: "captured" | "not-captured" | "not-applicable";
  rawStatus: string | null;
  signer: null | {
    certificateSha256: string;
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    codeSigningEku: string[];
  };
};
type Observation = {
  schemaVersion: 1;
  observationKind: "synthetic" | "caller-supplied";
  sourceCommit: string | null;
  files: FileObservation[];
  scan: { status: "complete" | "incomplete" | "failed"; enumeratedFileCount: number; listedBytes: number; issues: string[] };
  structure: { status: "passed" | "failed" | "not-evaluated"; issues: string[] };
  authenticode: AuthObservation[];
  publisherPolicy: null | { policyId: string; allowedCertificateSha256: string[] };
};
type ManifestFile = FileObservation & {
  authenticode: { captureStatus: string; rawStatus: string | null; assessment: string; signer: AuthObservation["signer"] };
  publisherTrust: { status: string; policyId: string | null };
};
type Manifest = {
  schemaVersion: number;
  observationKind: "synthetic" | "caller-supplied";
  evidenceBoundary: string;
  sourceDeclaration: { kind: string; commit: string | null };
  scan: { observedStatus: string; status: string; enumeratedFileCount: number; listedBytes: number; issues: string[] };
  structure: { observedStatus: string; status: string; issues: string[] };
  signatureCoverage: { status: string; applicablePeCount: number; capturedPeCount: number; unknownPeKindCount: number; issues: string[] };
  publisherPolicy: null | { policyId: string; policySha256: string; allowedCertificateSha256: string[] };
  publisherPolicyEvaluation: { status: string; policyId: string | null; applicableValidPeCount: number; evaluatedCount: number; issues: string[] };
  files: ManifestFile[];
  releaseDecision: string;
  buildAssociation: string;
  runtimeWiring: string;
  exitCode: number;
};
type Protocol = {
  PROTOCOL_VERSION: number;
  LIMITS: Readonly<{
    maxFiles: number;
    maxArrayLength: number;
    maxInputNodes: number;
    maxInputDepth: number;
    maxInputCharacters: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxDepth: number;
    maxPathUtf8Bytes: number;
    maxComponentCodeUnits: number;
    maxSignerFieldCharacters: number;
    maxEkuCount: number;
    maxEkuCharacters: number;
    maxSignerJsonBytes: number;
    maxPolicyCertificates: number;
    maxIssueCount: number;
    maxReportBytes: number;
  }>;
  EXIT_CODES: Readonly<{ success: number; failed: number; incomplete: number; invalidInput: number; internalError: number }>;
  ProtocolError: new (code: string) => ProtocolErrorLike;
  parseObservation(input: unknown): Observation;
  deriveManifest(input: unknown): Manifest;
  deriveExitCode(input: unknown): number;
  serializeManifest(input: unknown): string;
  parseManifest(input: string): Manifest;
};

function signer(certificateSha256 = "c".repeat(64)): NonNullable<AuthObservation["signer"]> {
  return {
    certificateSha256,
    subject: "CN=Fixture Publisher, O=Project X-Ray",
    issuer: "CN=Fixture Test CA",
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2027-01-01T00:00:00.000Z",
    codeSigningEku: ["1.3.6.1.5.5.7.3.3"],
  };
}

function fixture(): Observation {
  const files: FileObservation[] = [
    {
      rootId: "portable-exe",
      path: "Project-X-Ray-1.0-portable.exe",
      bytes: 10,
      sha256: "a".repeat(64),
      classification: "portable-exe",
      peStatus: "pe",
      machine: "8664",
    },
    {
      rootId: "app-staging",
      path: "resources/metadata.txt",
      bytes: 20,
      sha256: "b".repeat(64),
      classification: "app-file",
      peStatus: "non-pe",
      machine: null,
    },
  ];
  const portableFile = files[0]!;
  const appFile = files[1]!;
  const authenticode: AuthObservation[] = [
    {
      rootId: "portable-exe",
      path: portableFile.path,
      fileSha256: portableFile.sha256,
      captureStatus: "captured",
      rawStatus: "Valid",
      signer: signer(),
    },
    {
      rootId: "app-staging",
      path: appFile.path,
      fileSha256: appFile.sha256,
      captureStatus: "not-applicable",
      rawStatus: null,
      signer: null,
    },
  ];
  return {
    schemaVersion: 1,
    observationKind: "synthetic",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    files,
    scan: { status: "complete", enumeratedFileCount: 2, listedBytes: 30, issues: [] },
    structure: { status: "passed", issues: [] },
    authenticode,
    publisherPolicy: null,
  };
}

function authFor(observation: Observation, rootId: FileObservation["rootId"]): AuthObservation {
  const row = observation.authenticode.find(item => item.rootId === rootId);
  if (!row) throw new Error("fixture auth row missing");
  return row;
}

function fileFor(manifest: Manifest, rootId: FileObservation["rootId"]): ManifestFile {
  const file = manifest.files.find(item => item.rootId === rootId);
  if (!file) throw new Error("manifest file missing");
  return file;
}

describe("Windows artifact manifest v1 pure protocol", () => {
  it("loads as a pure require surface and exports only the documented protocol API", () => {
    const resolved = require.resolve("../scripts/windows-artifact-manifest-protocol.cjs");
    delete require.cache[resolved];
    const on = vi.spyOn(process, "on");
    const once = vi.spyOn(process, "once");
    const exit = vi.spyOn(process, "exit");
    const beforeArgv = [...process.argv];
    try {
      const loaded = require(resolved) as Protocol;
      expect(Object.keys(loaded).sort()).toEqual([
        "EXIT_CODES", "LIMITS", "PROTOCOL_VERSION", "ProtocolError", "deriveExitCode", "deriveManifest",
        "parseManifest", "parseObservation", "serializeManifest",
      ]);
      expect(Object.isFrozen(loaded)).toBe(true);
      expect(loaded.PROTOCOL_VERSION).toBe(1);
      expect(process.argv).toEqual(beforeArgv);
      expect(on).not.toHaveBeenCalled();
      expect(once).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      delete require.cache[resolved];
    }
  });

  it("parses, derives, canonicalizes, reparses and freezes an unverified caller observation", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const input = fixture();
    const parsed = protocol.parseObservation(input);
    const originalFilePath = input.files[0]!.path;
    input.files[0]!.path = "caller-mutated-after-capture.txt";
    authFor(input, "portable-exe").signer!.subject = "caller-mutated-after-capture";
    expect(parsed.files.some(file => file.path === originalFilePath)).toBe(true);
    expect(authFor(parsed, "portable-exe").signer?.subject).toBe("CN=Fixture Publisher, O=Project X-Ray");
    const manifest = protocol.deriveManifest(parsed);
    const serialized = protocol.serializeManifest(manifest);
    const reparsed = protocol.parseManifest(serialized);
    expect(reparsed).toEqual(manifest);
    expect(protocol.serializeManifest(reparsed)).toBe(serialized);
    expect(manifest.evidenceBoundary).toBe("caller-observation-unverified");
    expect(manifest.observationKind).toBe("synthetic");
    expect(manifest.sourceDeclaration).toEqual({ kind: "operator-declared", commit: input.sourceCommit });
    expect(manifest.releaseDecision).toBe("not-evaluated");
    expect(manifest.buildAssociation).toBe("not-established");
    expect(manifest.runtimeWiring).toBe("not-assessed");
    expect(manifest.exitCode).toBe(0);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.files)).toBe(true);
    expect(Object.isFrozen(reparsed.files[0])).toBe(true);
    expect(serialized).not.toContain("dist\\");
  });

  it("sorts file, diagnosis and policy data deterministically without locale ordering", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const first = fixture();
    first.scan.issues = ["file-changed", "enumeration-incomplete"];
    first.scan.status = "incomplete";
    first.structure.status = "failed";
    first.structure.issues = ["profile-incomplete", "native-unclassified"];
    first.files.reverse();
    first.authenticode.reverse();
    first.publisherPolicy = { policyId: "fixture-policy", allowedCertificateSha256: ["d".repeat(64), "c".repeat(64)] };
    const second = JSON.parse(JSON.stringify(first)) as Observation;
    second.files.reverse();
    second.authenticode.reverse();
    second.scan.issues.reverse();
    second.structure.issues.reverse();
    second.publisherPolicy!.allowedCertificateSha256.reverse();
    expect(protocol.serializeManifest(protocol.deriveManifest(first))).toBe(protocol.serializeManifest(protocol.deriveManifest(second)));
  });

  it("rejects accessors without invoking them, symbols, sparse arrays, proxies, aliases and unknown fields", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const withGetter = fixture();
    let getterCalls = 0;
    Object.defineProperty(withGetter.scan, "status", { enumerable: true, get: () => { getterCalls += 1; return "complete"; } });
    expect(() => protocol.parseObservation(withGetter)).toThrowError();
    expect(getterCalls).toBe(0);

    const withSymbol = fixture() as Observation & { [key: symbol]: unknown };
    withSymbol[Symbol("extra")] = true;
    expect(() => protocol.parseObservation(withSymbol)).toThrowError();

    const sparse = fixture();
    delete sparse.files[0];
    expect(() => protocol.parseObservation(sparse)).toThrowError();

    const proxy = new Proxy(fixture(), { get: () => { throw new Error("trap must not run"); } });
    expect(() => protocol.parseObservation(proxy)).toThrowError();

    const aliased = fixture();
    aliased.files[1] = aliased.files[0]!;
    expect(() => protocol.parseObservation(aliased)).toThrowError();

    const extra = { ...fixture(), surprise: true };
    expect(() => protocol.parseObservation(extra)).toThrowError();
    expect(protocol.deriveExitCode(extra)).toBe(64);
  });

  it("rejects Windows path escapes, ambiguous names and case-equivalent duplicates", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    for (const invalidPath of ["../escape.dll", "/absolute.dll", "C:/drive.dll", "a\\b.dll", "a//b.dll", "name.", "name ", "CON.txt", "folder/.."] ) {
      const input = fixture();
      const file = input.files.find(item => item.rootId === "app-staging")!;
      const auth = authFor(input, "app-staging");
      file.path = invalidPath;
      auth.path = invalidPath;
      expect(() => protocol.parseObservation(input), invalidPath).toThrowError();
    }

    const duplicate = fixture();
    const original = duplicate.files.find(item => item.rootId === "app-staging")!;
    const extraFile: FileObservation = { ...original, path: "Resources/METADATA.TXT", sha256: "d".repeat(64) };
    duplicate.files.push(extraFile);
    duplicate.authenticode.push({
      rootId: extraFile.rootId,
      path: extraFile.path,
      fileSha256: extraFile.sha256,
      captureStatus: "not-applicable",
      rawStatus: null,
      signer: null,
    });
    duplicate.scan.enumeratedFileCount += 1;
    duplicate.scan.listedBytes += extraFile.bytes;
    expect(() => protocol.parseObservation(duplicate)).toThrowError(/duplicate-windows-path/u);
  });

  it("rejects missing, duplicate, orphaned and hash-mismatched Authenticode associations", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const missing = fixture();
    missing.authenticode.pop();
    expect(() => protocol.parseObservation(missing)).toThrowError(/association-count/u);

    const duplicate = fixture();
    duplicate.authenticode[1] = { ...duplicate.authenticode[0]! };
    expect(() => protocol.parseObservation(duplicate)).toThrowError();

    const mismatch = fixture();
    authFor(mismatch, "portable-exe").fileSha256 = "f".repeat(64);
    expect(() => protocol.parseObservation(mismatch)).toThrowError(/hash-mismatch/u);

    const invalidSignerPeriod = fixture();
    authFor(invalidSignerPeriod, "portable-exe").signer!.validTo = "2025-01-01T00:00:00.000Z";
    expect(() => protocol.parseObservation(invalidSignerPeriod)).toThrowError(/validity-range/u);
  });

  it.each([
    ["Valid", "valid", 0, "complete"],
    ["NotSigned", "unsigned", 2, "complete"],
    ["HashMismatch", "failed", 2, "complete"],
    ["NotTrusted", "failed", 2, "complete"],
    ["UnknownError", "failed", 2, "complete"],
    ["NotSupportedFileFormat", "incomplete", 3, "incomplete"],
    ["Incompatible", "incomplete", 3, "incomplete"],
    ["FutureRawStatus", "incomplete", 3, "incomplete"],
  ] as const)("preserves raw Authenticode %s and derives %s without conflating coverage", (rawStatus, assessment, exitCode, coverage) => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const input = fixture();
    const raw = authFor(input, "portable-exe");
    raw.rawStatus = rawStatus;
    if (rawStatus === "NotSigned" || rawStatus === "UnknownError") raw.signer = null;
    const manifest = protocol.deriveManifest(input);
    const portable = fileFor(manifest, "portable-exe");
    expect(portable.authenticode.rawStatus).toBe(rawStatus);
    expect(portable.authenticode.assessment).toBe(assessment);
    expect(manifest.signatureCoverage.status).toBe(coverage);
    expect(manifest.exitCode).toBe(exitCode);
  });

  it("keeps NotSigned distinct from publisher trust and treats contradictory signer data as incomplete", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const input = fixture();
    input.publisherPolicy = { policyId: "fixture-policy", allowedCertificateSha256: ["c".repeat(64)] };
    const raw = authFor(input, "portable-exe");
    raw.rawStatus = "NotSigned";
    raw.signer = null;
    const manifest = protocol.deriveManifest(input);
    expect(fileFor(manifest, "portable-exe").authenticode.rawStatus).toBe("NotSigned");
    expect(fileFor(manifest, "portable-exe").authenticode.assessment).toBe("unsigned");
    expect(fileFor(manifest, "portable-exe").publisherTrust.status).toBe("not-evaluated");
    expect(manifest.publisherPolicyEvaluation.status).toBe("not-applicable");
    expect(manifest.exitCode).toBe(2);

    raw.signer = signer();
    const contradictory = protocol.deriveManifest(input);
    expect(contradictory.signatureCoverage.status).toBe("incomplete");
    expect(contradictory.exitCode).toBe(3);
  });

  it("evaluates only explicit publisher policies and never promotes Valid to trust", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const withoutPolicy = protocol.deriveManifest(fixture());
    expect(fileFor(withoutPolicy, "portable-exe").authenticode.assessment).toBe("valid");
    expect(fileFor(withoutPolicy, "portable-exe").publisherTrust.status).toBe("not-evaluated");
    expect(withoutPolicy.publisherPolicyEvaluation.status).toBe("not-evaluated");
    expect(withoutPolicy.exitCode).toBe(0);

    const callerSuppliedInput = fixture();
    callerSuppliedInput.observationKind = "caller-supplied";
    const callerSupplied = protocol.deriveManifest(callerSuppliedInput);
    expect(callerSupplied.observationKind).toBe("caller-supplied");
    expect(callerSupplied.evidenceBoundary).toBe("caller-observation-unverified");

    const matchedInput = fixture();
    matchedInput.publisherPolicy = { policyId: "fixture-policy", allowedCertificateSha256: ["c".repeat(64)] };
    const matched = protocol.deriveManifest(matchedInput);
    expect(fileFor(matched, "portable-exe").publisherTrust.status).toBe("matched");
    expect(matched.publisherPolicyEvaluation.status).toBe("complete");
    expect(matched.publisherPolicy?.policySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(matched.exitCode).toBe(0);

    const mismatchInput = fixture();
    mismatchInput.publisherPolicy = { policyId: "fixture-policy", allowedCertificateSha256: ["d".repeat(64)] };
    const mismatch = protocol.deriveManifest(mismatchInput);
    expect(fileFor(mismatch, "portable-exe").publisherTrust.status).toBe("mismatch");
    expect(mismatch.exitCode).toBe(2);
  });

  it("prioritizes incomplete scan or applicable signature coverage over known failures", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const incompleteScan = fixture();
    incompleteScan.scan.status = "incomplete";
    incompleteScan.structure.status = "failed";
    authFor(incompleteScan, "portable-exe").rawStatus = "NotSigned";
    authFor(incompleteScan, "portable-exe").signer = null;
    expect(protocol.deriveManifest(incompleteScan).exitCode).toBe(3);

    const incompleteSignature = fixture();
    incompleteSignature.structure.status = "failed";
    authFor(incompleteSignature, "portable-exe").captureStatus = "not-captured";
    authFor(incompleteSignature, "portable-exe").rawStatus = null;
    authFor(incompleteSignature, "portable-exe").signer = null;
    expect(protocol.deriveManifest(incompleteSignature).exitCode).toBe(3);

    const mismatchAndIncomplete = fixture();
    const portableAuth = authFor(mismatchAndIncomplete, "portable-exe");
    portableAuth.captureStatus = "not-captured";
    portableAuth.rawStatus = null;
    portableAuth.signer = null;
    const secondPe = mismatchAndIncomplete.files.find(file => file.rootId === "app-staging")!;
    secondPe.peStatus = "pe";
    secondPe.machine = "8664";
    const secondPeAuth = authFor(mismatchAndIncomplete, "app-staging");
    secondPeAuth.captureStatus = "captured";
    secondPeAuth.rawStatus = "Valid";
    secondPeAuth.signer = signer("d".repeat(64));
    mismatchAndIncomplete.publisherPolicy = { policyId: "fixture-policy", allowedCertificateSha256: ["c".repeat(64)] };
    const mixed = protocol.deriveManifest(mismatchAndIncomplete);
    expect(fileFor(mixed, "app-staging").publisherTrust.status).toBe("mismatch");
    expect(mixed.signatureCoverage.status).toBe("incomplete");
    expect(mixed.exitCode).toBe(3);

    const notEvaluatedStructure = fixture();
    notEvaluatedStructure.structure.status = "not-evaluated";
    expect(protocol.deriveManifest(notEvaluatedStructure).exitCode).toBe(3);
  });

  it("downgrades contradictory complete labels and passed-with-findings instead of trusting them", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const badScan = fixture();
    badScan.scan.enumeratedFileCount = 3;
    const scanManifest = protocol.deriveManifest(badScan);
    expect(scanManifest.scan.observedStatus).toBe("complete");
    expect(scanManifest.scan.status).toBe("incomplete");
    expect(scanManifest.exitCode).toBe(3);

    const badStructure = fixture();
    badStructure.structure.issues = ["native-unclassified"];
    const structureManifest = protocol.deriveManifest(badStructure);
    expect(structureManifest.structure.observedStatus).toBe("passed");
    expect(structureManifest.structure.status).toBe("failed");
    expect(structureManifest.exitCode).toBe(2);
  });

  it("turns capacity breaches into incomplete results without truncating a complete inventory", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const oversizedFile = fixture();
    const appFile = oversizedFile.files.find(file => file.rootId === "app-staging")!;
    oversizedFile.scan.listedBytes += protocol.LIMITS.maxFileBytes;
    appFile.bytes = protocol.LIMITS.maxFileBytes + 1;
    const manifest = protocol.deriveManifest(oversizedFile);
    expect(manifest.scan.status).toBe("incomplete");
    expect(manifest.scan.issues).toContain("file-size-limit-exceeded");
    expect(manifest.exitCode).toBe(3);

    const tooManyEntries = fixture();
    tooManyEntries.scan.enumeratedFileCount = protocol.LIMITS.maxFiles + 1;
    const countManifest = protocol.deriveManifest(tooManyEntries);
    expect(countManifest.scan.status).toBe("incomplete");
    expect(countManifest.scan.issues).toContain("file-count-limit-exceeded");
    expect(countManifest.exitCode).toBe(3);
  });

  it("maps no applicable PE signatures to not-applicable rather than missing capture", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const input = fixture();
    const portable = input.files.find(file => file.rootId === "portable-exe")!;
    const auth = authFor(input, "portable-exe");
    portable.peStatus = "non-pe";
    portable.machine = null;
    auth.captureStatus = "not-applicable";
    auth.rawStatus = null;
    auth.signer = null;
    const manifest = protocol.deriveManifest(input);
    expect(manifest.signatureCoverage.status).toBe("not-applicable");
    expect(fileFor(manifest, "portable-exe").authenticode.assessment).toBe("not-applicable");
    expect(manifest.structure.status).toBe("failed");
    expect(manifest.exitCode).toBe(2);
  });

  it("returns the fixed 64 mapping for invalid DTOs and rejects noncanonical or forged manifests", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const invalid = fixture();
    invalid.sourceCommit = "not-a-commit";
    expect(protocol.deriveExitCode(invalid)).toBe(64);

    const manifest = protocol.deriveManifest(fixture());
    expect(() => protocol.parseManifest(` ${protocol.serializeManifest(manifest)}`)).toThrowError(/canonical/u);
    const forged = { ...manifest, exitCode: 2 };
    expect(() => protocol.serializeManifest(forged)).toThrowError(/derived-state-mismatch/u);
  });

  it("maps unexpected implementation exceptions to fixed 70 without exposing exception text", () => {
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as Protocol;
    const originalSort = Array.prototype.sort;
    let code = 0;
    try {
      Array.prototype.sort = function () { throw new Error("private path and source text"); } as typeof Array.prototype.sort;
      code = protocol.deriveExitCode(fixture());
    } finally {
      Array.prototype.sort = originalSort;
    }
    expect(code).toBe(70);
  });
});
