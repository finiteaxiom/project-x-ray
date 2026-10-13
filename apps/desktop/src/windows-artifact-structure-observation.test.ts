import { describe, expect, it } from "vitest";

type Structure = { status: "passed" | "failed" | "not-evaluated"; issues: string[] };
type CaptureInput = {
  schemaVersion: 1;
  profileId: string;
  capture: { asar: "complete" | "incomplete"; unpacked: "complete" | "incomplete"; extraResources: "complete" | "incomplete" };
  asarEntries: AsarEntry[];
  unpackedFiles: string[];
  extraResourceFiles: string[];
};
type AsarEntry = { path: string; file: boolean | null; unpacked: boolean | null };
type ObservationResult = {
  structure: Structure;
  metadata: {
    profileId: string | null;
    captureStatus: "complete" | "incomplete";
    counts: { asarEntries: number; unpackedFiles: number; extraResourceFiles: number };
    checks: {
      requiredAsarEntriesPresent: number | null;
      requiredAsarEntriesTotal: number;
      uiJavaScriptAssetPresent: boolean | null;
      uiStylesheetPresent: boolean | null;
      pythonAsarAbsent: boolean | null;
      mappedUnpackedNativeFiles: number | null;
      sqliteMapped: boolean | null;
      pythonResourceMapped: boolean | null;
    };
  };
};
type ObserverModule = {
  PROFILE_ID: string;
  LIMITS: Readonly<{ maxEntriesPerList: number; maxObjectKeys: number }>;
  StructureObservationError: new (code: string) => Error & { code: string };
  observeArtifactStructure(input: unknown): ObservationResult;
};
type ManifestProtocol = {
  deriveManifest(input: unknown): {
    evidenceBoundary: string;
    structure: { observedStatus: string; status: string; issues: string[] };
    signatureCoverage: { status: string; applicablePeCount: number; capturedPeCount: number; issues: string[]; unknownPeKindCount: number };
    releaseDecision: string;
    buildAssociation: string;
    runtimeWiring: string;
    exitCode: number;
  };
};

function observer(): ObserverModule {
  return require("../scripts/windows-artifact-structure-observation.cjs") as ObserverModule;
}

function asarEntry(path: string, unpacked = false, file: boolean | null = true): AsarEntry {
  return { path, file, unpacked };
}

function fixture(): CaptureInput {
  return {
    schemaVersion: 1,
    profileId: "project-xray-windows-x64-electron-builder-v1",
    capture: { asar: "complete", unpacked: "complete", extraResources: "complete" },
    asarEntries: [
      asarEntry("apps/desktop/dist/main.js"),
      asarEntry("apps/desktop/dist/preload.js"),
      asarEntry("apps/desktop/dist/analysis-worker.js"),
      asarEntry("apps/desktop/dist/explanation-worker.js"),
      asarEntry("apps/desktop/dist/remote-execution-worker.js"),
      asarEntry("apps/ui/dist/index.html"),
      asarEntry("apps/ui/dist/assets/index-a1b2.js"),
      asarEntry("apps/ui/dist/assets/index-c3d4.css"),
      asarEntry("apps/desktop/dist/native/secure_reader.node", true),
      asarEntry("apps/desktop/dist/native/windows_credentials.node", true),
      asarEntry("node_modules/better-sqlite3/build/Release/better_sqlite3.node", true),
    ],
    unpackedFiles: [
      "apps/desktop/dist/native/secure_reader.node",
      "apps/desktop/dist/native/windows_credentials.node",
      "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ],
    extraResourceFiles: ["python-analyze.py"],
  };
}

function manifestObservation(structure: Structure): Record<string, unknown> {
  const portable = {
    rootId: "portable-exe",
    path: "Project-X-Ray-1.0-portable.exe",
    bytes: 10,
    sha256: "a".repeat(64),
    classification: "portable-exe",
    peStatus: "pe",
    machine: "8664",
  };
  const metadata = {
    rootId: "app-staging",
    path: "resources/metadata.txt",
    bytes: 20,
    sha256: "b".repeat(64),
    classification: "app-file",
    peStatus: "non-pe",
    machine: null,
  };
  return {
    schemaVersion: 1,
    observationKind: "synthetic",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    files: [portable, metadata],
    scan: { status: "complete", enumeratedFileCount: 2, listedBytes: 30, issues: [] },
    structure,
    authenticode: [
      { rootId: portable.rootId, path: portable.path, fileSha256: portable.sha256, captureStatus: "not-captured", rawStatus: null, signer: null },
      { rootId: metadata.rootId, path: metadata.path, fileSha256: metadata.sha256, captureStatus: "not-applicable", rawStatus: null, signer: null },
    ],
    publisherPolicy: null,
  };
}

function expectIssue(result: ObservationResult, issue: string): void {
  expect(result.structure.status).toBe("failed");
  expect(result.structure.issues).toContain(issue);
  const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as ManifestProtocol;
  const manifest = protocol.deriveManifest(manifestObservation(result.structure));
  expect(manifest.structure.status).toBe("failed");
  expect(manifest.structure.issues).toContain(issue);
}

describe("Windows artifact structure observation", () => {
  it("accepts the explicit Windows x64 profile and keeps only v1 structure fields", () => {
    const result = observer().observeArtifactStructure(fixture());
    expect(result.structure).toEqual({ status: "passed", issues: [] });
    expect(Object.keys(result.structure).sort()).toEqual(["issues", "status"]);
    expect(result.metadata).toEqual({
      profileId: observer().PROFILE_ID,
      captureStatus: "complete",
      counts: { asarEntries: 11, unpackedFiles: 3, extraResourceFiles: 1 },
      checks: {
        requiredAsarEntriesPresent: 6,
        requiredAsarEntriesTotal: 6,
        uiJavaScriptAssetPresent: true,
        uiStylesheetPresent: true,
        pythonAsarAbsent: true,
        mappedUnpackedNativeFiles: 2,
        sqliteMapped: true,
        pythonResourceMapped: true,
      },
    });
  });

  it("checks the actual manifest pure entry while retaining caller and signature uncertainty", () => {
    const result = observer().observeArtifactStructure(fixture());
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as ManifestProtocol;
    const manifest = protocol.deriveManifest(manifestObservation(result.structure));
    expect(manifest.evidenceBoundary).toBe("caller-observation-unverified");
    expect(manifest.structure).toEqual({ observedStatus: "passed", status: "passed", issues: [] });
    expect(manifest.signatureCoverage).toMatchObject({ status: "incomplete", applicablePeCount: 1, capturedPeCount: 0, unknownPeKindCount: 0 });
    expect(manifest.signatureCoverage.issues).toContain("capture-not-complete");
    expect(manifest.releaseDecision).toBe("not-evaluated");
    expect(manifest.buildAssociation).toBe("not-established");
    expect(manifest.runtimeWiring).toBe("not-assessed");
    expect(manifest.exitCode).toBe(3);
  });

  it("rejects physical native files when their ASAR file/unpacked records are missing", () => {
    const input = fixture();
    input.asarEntries = input.asarEntries.filter(entry => !entry.path.toLowerCase().endsWith(".node"));
    const result = observer().observeArtifactStructure(input);
    expectIssue(result, "missing-required-entry");
    expect(result.structure.issues).toContain("native-unclassified");
    expect(result.metadata.checks.mappedUnpackedNativeFiles).toBe(0);
  });

  it("rejects a physically present native file whose ASAR record says it is packed", () => {
    const input = fixture();
    const reader = input.asarEntries.find(entry => entry.path === "apps/desktop/dist/native/secure_reader.node");
    if (!reader) throw new Error("secure-reader ASAR fixture missing");
    reader.unpacked = false;
    const result = observer().observeArtifactStructure(input);
    expectIssue(result, "native-unclassified");
    expect(result.structure.issues).toContain("missing-required-entry");
    expect(result.metadata.checks.mappedUnpackedNativeFiles).toBe(1);
  });

  it("rejects SQLite ASAR-to-physical path mismatches", () => {
    const input = fixture();
    input.asarEntries = input.asarEntries.filter(entry => !entry.path.includes("better-sqlite3"));
    input.asarEntries.push(asarEntry("other/node_modules/better-sqlite3/build/Release/better_sqlite3.node", true));
    const result = observer().observeArtifactStructure(input);
    expectIssue(result, "native-unclassified");
    expect(result.structure.issues).toContain("missing-required-entry");
    expect(result.metadata.checks.sqliteMapped).toBe(false);
  });

  it("returns not-evaluated when ASAR file/unpacked metadata is unknown", () => {
    const input = fixture();
    const main = input.asarEntries.find(entry => entry.path === "apps/desktop/dist/main.js");
    if (!main) throw new Error("main ASAR fixture missing");
    main.unpacked = null;
    const result = observer().observeArtifactStructure(input);
    expect(result.structure).toEqual({ status: "not-evaluated", issues: ["profile-incomplete"] });
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as ManifestProtocol;
    expect(protocol.deriveManifest(manifestObservation(result.structure)).structure.status).not.toBe("passed");
  });

  it("fails closed when a required entry is present only under a different path", () => {
    const input = fixture();
    input.asarEntries = input.asarEntries.filter(entry => entry.path !== "apps/desktop/dist/main.js");
    input.asarEntries.push(asarEntry("elsewhere/main.js"));
    expectIssue(observer().observeArtifactStructure(input), "missing-required-entry");
  });

  it("requires the configured Python resource location and rejects the ASAR copy", () => {
    const input = fixture();
    input.asarEntries.push(asarEntry("apps/desktop/dist/python-analyze.py"));
    input.extraResourceFiles = ["nested/python-analyze.py"];
    const result = observer().observeArtifactStructure(input);
    expectIssue(result, "python-worker-location-mismatch");
    expect(result.structure.issues).toContain("unexpected-entry");
  });

  it("requires the exact secure-reader and credentials unpacked mappings", () => {
    const input = fixture();
    input.unpackedFiles = input.unpackedFiles.filter(path => path !== "apps/desktop/dist/native/secure_reader.node");
    input.unpackedFiles.push("apps/desktop/native/secure_reader.node");
    const result = observer().observeArtifactStructure(input);
    expectIssue(result, "missing-required-entry");
    expect(result.structure.issues).toContain("native-unclassified");
  });

  it("accepts only the production credentials target path and excludes test binaries", () => {
    const input = fixture();
    input.unpackedFiles = input.unpackedFiles.filter(path => path !== "apps/desktop/dist/native/windows_credentials.node");
    input.unpackedFiles.push("apps/desktop/dist/native/windows_credentials_test.node");
    const result = observer().observeArtifactStructure(input);
    expectIssue(result, "missing-required-entry");
    expect(result.structure.issues).toContain("native-unclassified");
    expect(result.metadata.checks.mappedUnpackedNativeFiles).toBe(1);
  });

  it.each([
    "node_modules/better-sqlite3/prebuilds/win32-x64.node",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ".pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/build/release/better_sqlite3.node",
  ])("maps only a supported SQLite package path: %s", sqlitePath => {
    const input = fixture();
    const defaultSqlite = "node_modules/better-sqlite3/build/Release/better_sqlite3.node";
    input.asarEntries = input.asarEntries.filter(entry => entry.path !== defaultSqlite);
    input.unpackedFiles = input.unpackedFiles.filter(path => path !== defaultSqlite);
    input.asarEntries.push(asarEntry(sqlitePath, true));
    input.unpackedFiles.push(sqlitePath);
    const result = observer().observeArtifactStructure(input);
    expect(result.structure).toEqual({ status: "passed", issues: [] });
    expect(result.metadata.checks.sqliteMapped).toBe(true);
  });

  it("rejects unmatched and duplicate SQLite/native variants instead of matching by basename", () => {
    const unmatched = fixture();
    unmatched.asarEntries = unmatched.asarEntries.filter(entry => !entry.path.includes("better-sqlite3"));
    unmatched.unpackedFiles = unmatched.unpackedFiles.filter(path => !path.includes("better-sqlite3"));
    unmatched.asarEntries.push(asarEntry("other-package/better_sqlite3.node", true));
    unmatched.unpackedFiles.push("other-package/better_sqlite3.node");
    const unmatchedResult = observer().observeArtifactStructure(unmatched);
    expectIssue(unmatchedResult, "missing-required-entry");
    expect(unmatchedResult.structure.issues).toContain("native-unclassified");

    const duplicate = fixture();
    duplicate.unpackedFiles.push(".pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/prebuilds/win32-x64.node");
    expectIssue(observer().observeArtifactStructure(duplicate), "native-unclassified");
  });

  it("excludes test native variants even when the production target is also present", () => {
    const input = fixture();
    input.unpackedFiles.push("apps/desktop/dist/native/windows_credentials_test.node");
    expectIssue(observer().observeArtifactStructure(input), "native-unclassified");
  });

  it("returns not-evaluated for incomplete captures and unsupported profiles", () => {
    const incomplete = fixture();
    incomplete.capture.unpacked = "incomplete";
    const incompleteResult = observer().observeArtifactStructure(incomplete);
    expect(incompleteResult.structure).toEqual({ status: "not-evaluated", issues: ["profile-incomplete"] });
    const protocol = require("../scripts/windows-artifact-manifest-protocol.cjs") as ManifestProtocol;
    expect(protocol.deriveManifest(manifestObservation(incompleteResult.structure)).structure.status).not.toBe("passed");

    const unsupported = fixture();
    unsupported.profileId = "another-profile";
    const unsupportedResult = observer().observeArtifactStructure(unsupported);
    expect(unsupportedResult.structure).toEqual({ status: "not-evaluated", issues: ["profile-unsupported"] });
    expect(unsupportedResult.metadata.profileId).toBeNull();
    expect(protocol.deriveManifest(manifestObservation(unsupportedResult.structure)).structure.status).not.toBe("passed");
  });

  it.each([
    "../apps/desktop/dist/main.js",
    "apps\\desktop\\dist\\main.js",
    "C:/apps/desktop/dist/main.js",
    "apps//desktop/dist/main.js",
  ])("rejects non-canonical or escaping path input: %s", invalidPath => {
    const input = fixture();
    input.asarEntries.push(asarEntry(invalidPath));
    expect(() => observer().observeArtifactStructure(input)).toThrowError(/invalid-relative-path/u);
  });

  it("rejects duplicate and Windows case-ambiguous entries without normalizing them", () => {
    const duplicate = fixture();
    duplicate.asarEntries.push(asarEntry("apps/desktop/dist/main.js"));
    expect(() => observer().observeArtifactStructure(duplicate)).toThrowError(/duplicate-path/u);

    const ambiguous = fixture();
    ambiguous.asarEntries.push(asarEntry("apps/Desktop/dist/main.js"));
    expect(() => observer().observeArtifactStructure(ambiguous)).toThrowError(/ambiguous-case-path/u);
  });

  it("copies plain input, rejects accessors and proxies, and bounds capture size", () => {
    const input = fixture();
    const result = observer().observeArtifactStructure(input);
    input.asarEntries.pop();
    expect(result.metadata.counts.asarEntries).toBe(11);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.structure.issues)).toBe(true);

    let getterCalls = 0;
    const withGetter = fixture();
    Object.defineProperty(withGetter.asarEntries, "0", { enumerable: true, get: () => { getterCalls += 1; return "apps/desktop/dist/main.js"; } });
    expect(() => observer().observeArtifactStructure(withGetter)).toThrowError(/array-hole-or-accessor/u);
    expect(getterCalls).toBe(0);
    expect(() => observer().observeArtifactStructure(new Proxy(fixture(), { get: () => { throw new Error("proxy trap must not run"); } }))).toThrowError(/non-plain-data/u);

    const tooMany = fixture();
    tooMany.asarEntries = Array.from({ length: observer().LIMITS.maxEntriesPerList + 1 }, (_, index) => asarEntry(`generated/${index}.js`));
    expect(() => observer().observeArtifactStructure(tooMany)).toThrowError(/invalid-array/u);

    const tooManyFields = Object.assign(fixture(), Object.fromEntries(Array.from({ length: observer().LIMITS.maxObjectKeys + 1 }, (_, index) => [`extra-${index}`, true])));
    expect(() => observer().observeArtifactStructure(tooManyFields)).toThrowError(/object-field-limit-exceeded/u);

    const tooLongPath = fixture();
    tooLongPath.asarEntries.push(asarEntry(`${"a".repeat(200)}/${"b".repeat(200)}/${"c".repeat(120)}/entry.js`));
    expect(() => observer().observeArtifactStructure(tooLongPath)).toThrowError(/invalid-relative-path/u);
  });
});
