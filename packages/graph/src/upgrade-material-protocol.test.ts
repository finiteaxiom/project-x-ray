import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRawMaterialDocuments, verifyRawMaterialDocuments, inspectCopiedRawDatabase, RawMaterialProtocolError } from "./upgrade-material-protocol.js";
import { inspectCopiedRecoverySet } from "./upgrade-recovery-format.js";

const volume = "1234567890abcdef", id = (n: number) => volume + ":" + n.toString(16).padStart(32, "0");
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  return { operationId: "own-operation", sourceRootIdentity: id(1), sourceProjectsIdentity: null as string | null, targetParentIdentity: id(2), targetOperationIdentity: id(3),
    members: [{ relativePath: "project-xray.sqlite", layoutSlot: "global-container", sourceIdentity: id(4), targetName: "00000000.bin", targetIdentity: id(5), bytes: 3, sha256: hash(Buffer.from("own")) }],
    absent: ["project-xray.sqlite-wal", "project-xray.sqlite-shm", "project-xray.sqlite-journal"] };
}
function rejected(input: unknown) { expect(() => createRawMaterialDocuments(input)).toThrow(RawMaterialProtocolError); }
function mutatedManifest(change: (value: Record<string, unknown>) => void) {
  const docs = createRawMaterialDocuments(fixture()), parsed = JSON.parse(docs.manifest.toString("utf8")) as Record<string, unknown>;
  change(parsed); return { manifest: Buffer.from(JSON.stringify(parsed)), marker: docs.marker };
}
describe("raw material documents, no producer or file authority", () => {
  it("produces deterministic canonical documents, complete four-kind presence, and explicit non-approval", () => {
    const input = fixture(), before = JSON.stringify(input), first = createRawMaterialDocuments(input), second = createRawMaterialDocuments({ ...input, absent: [...input.absent].reverse() });
    expect(first.manifest.equals(second.manifest)).toBe(true); expect(first.marker.equals(second.marker)).toBe(true); expect(JSON.stringify(input)).toBe(before);
    expect(verifyRawMaterialDocuments(first.manifest, first.marker)).toEqual({ status: "documents-consistent", operationId: "own-operation", manifestBytes: first.manifest.length, manifestSha256: hash(first.manifest), members: 1, materialBytes: 3, producerAuthentication: "not-established", rawPackageOpened: false, sqliteOpenApproved: false, restoreApproved: false, productionApproved: false });
  });
  it("pairs a real own SQLite byte hash with recovery-format precheck without opening any source file", () => {
    const db = new Database(":memory:"); let bytes: Buffer;
    try { db.exec("CREATE TABLE own(value TEXT); INSERT INTO own VALUES ('own fixture');"); bytes = db.serialize(); }
    finally { db.close(); }
    const input = fixture(); input.members[0]!.bytes = bytes.length; input.members[0]!.sha256 = hash(bytes);
    const docs = createRawMaterialDocuments(input), before = hash(bytes);
    expect(inspectCopiedRecoverySet({ main: bytes, wal: null, shm: null, journal: null })).toMatchObject({ status: "observed", sqliteOpenApproved: false });
    expect(verifyRawMaterialDocuments(docs.manifest, docs.marker)).toMatchObject({ materialBytes: bytes.length, rawPackageOpened: false, producerAuthentication: "not-established" });
    expect(hash(bytes)).toBe(before);
    const result = inspectCopiedRawDatabase({ ...docs, relativeMain: "project-xray.sqlite", payloads: [{ targetName: "00000000.bin", content: bytes }] });
    expect(result).toMatchObject({ status: "recovery-format-observed", source: "caller-bytes-unverified", producerAuthentication: "not-established", rawPackageOpened: false, sqliteOpenApproved: false, restoreApproved: false });
    expect(hash(bytes)).toBe(before);
    // Identity values in this protocol fixture are declarations, not physical HANDLE observations.
  });
  it("captures input before later mutations and distinguishes empty-present from absent", () => {
    const input = fixture(); input.members.push({ relativePath: "project-xray.sqlite-wal", layoutSlot: "global-container", sourceIdentity: id(6), targetName: "00000001.bin", targetIdentity: id(7), bytes: 0, sha256: hash(Buffer.alloc(0)) });
    input.absent = input.absent.filter(name => !name.endsWith("-wal"));
    const docs = createRawMaterialDocuments(input); input.members[0]!.sha256 = "0".repeat(64); input.absent.length = 0;
    expect(verifyRawMaterialDocuments(docs.manifest, docs.marker)).toMatchObject({ members: 2, materialBytes: 3 });
    expect(JSON.parse(docs.manifest.toString()).members[1].bytes).toBe(0);
  });
  it("records an empty projects directory distinctly and requires its identity for project members", () => {
    const input = fixture(); input.sourceProjectsIdentity = id(6);
    expect(JSON.parse(createRawMaterialDocuments(input).manifest.toString()).sourceProjectsIdentity).toBe(id(6));
    input.members.push({ relativePath: "projects/a.sqlite", layoutSlot: "project-file", sourceIdentity: id(7), targetName: "00000001.bin", targetIdentity: id(8), bytes: 1, sha256: "a".repeat(64) });
    input.absent.push("projects/a.sqlite-wal", "projects/a.sqlite-shm", "projects/a.sqlite-journal");
    expect(verifyRawMaterialDocuments(...Object.values(createRawMaterialDocuments(input)) as [Buffer, Buffer])).toMatchObject({ members: 2 });
    input.sourceProjectsIdentity = null; rejected(input);
  });
  it.each(["project-xray.sqlite-wal", "project-xray.sqlite-shm", "project-xray.sqlite-journal"])("rejects missing four-kind record %s", name => {
    const input = fixture(); input.absent = input.absent.filter(value => value !== name); rejected(input);
  });
  it("rejects absent main, orphan sidecar, duplicate/case aliases and present-absent overlap", () => {
    const empty = fixture(); empty.members = []; empty.absent.push("project-xray.sqlite"); rejected(empty);
    const orphan = fixture(); orphan.sourceProjectsIdentity = id(9); orphan.absent.push("projects/a.sqlite-wal", "projects/a.sqlite-shm", "projects/a.sqlite-journal", "projects/a.sqlite"); rejected(orphan);
    const duplicate = fixture(); duplicate.absent.push(duplicate.absent[0]!); rejected(duplicate);
    const overlap = fixture(); overlap.absent.push("project-xray.sqlite"); rejected(overlap);
    const caseAlias = fixture(); caseAlias.sourceProjectsIdentity = id(9);
    for (const [index, name] of ["projects/a.sqlite", "projects/A.sqlite"].entries()) caseAlias.members.push({ relativePath: name, layoutSlot: "project-file", sourceIdentity: id(10 + index * 2), targetIdentity: id(11 + index * 2), targetName: String(index + 1).padStart(8, "0") + ".bin", bytes: 0, sha256: "a".repeat(64) });
    rejected(caseAlias);
  });
  it.each(["../a.sqlite", "projects/../a.sqlite", "projects/a.sqlite-mj123", "C:/a.sqlite", "projects/CON.sqlite", "projects/a..sqlite", "projects/a .sqlite", "projects/a.sqlite:stream", "projects/a\u0000.sqlite", "projects/\ud800.sqlite"])("rejects unsafe name %s", name => {
    const input = fixture(); input.sourceProjectsIdentity = id(9); input.members[0]!.relativePath = name; rejected(input);
  });
  it.each(["sourceRootIdentity", "targetParentIdentity", "targetOperationIdentity", "sourceProjectsIdentity"])("rejects root/directory/member identity alias through %s", key => {
    const input = fixture(); Object.assign(input, { [key]: input.members[0]!.sourceIdentity }); rejected(input);
  });
  it("rejects target-source alias, cross-volume records, bad ordinal and wrong layout slot", () => {
    const alias = fixture(); alias.members[0]!.targetIdentity = alias.members[0]!.sourceIdentity; rejected(alias);
    const cross = fixture(); cross.members[0]!.sourceIdentity = "a".repeat(16) + ":" + "1".repeat(32); rejected(cross);
    const ordinal = fixture(); ordinal.members[0]!.targetName = "00000001.bin"; rejected(ordinal);
    const slot = fixture(); slot.members[0]!.layoutSlot = "project-file"; rejected(slot);
  });
  it.each([-1, 0.5, 10 * 1024 ** 3 + 1, Number.MAX_SAFE_INTEGER, NaN])("rejects invalid/beyond-two-pass-budget byte count %s", value => {
    const input = fixture(); input.members[0]!.bytes = value; rejected(input);
  });
  it("rejects sparse/over-limit arrays and cumulative material budget", () => {
    const sparse = fixture(); sparse.absent.length = 4; rejected(sparse);
    const large = fixture(); large.absent = new Array(40001).fill("project-xray.sqlite-wal"); rejected(large);
    const total = fixture(); total.members[0]!.bytes = 10 * 1024 ** 3;
    total.members.push({ relativePath: "project-xray.sqlite-wal", layoutSlot: "global-container", sourceIdentity: id(6), targetIdentity: id(7), targetName: "00000001.bin", bytes: 1, sha256: "a".repeat(64) }); total.absent = total.absent.filter(name => !name.endsWith("-wal")); rejected(total);
  });
  it("preserves a valid source set whose absent sidecars make its vector exceed 10k entries", () => {
    const input = fixture(); input.sourceProjectsIdentity = id(4);
    input.members = Array.from({ length: 3000 }, (_, index) => ({ relativePath: index === 0 ? "project-xray.sqlite" : `projects/project-${index}.sqlite`, layoutSlot: index === 0 ? "global-container" : "project-file", sourceIdentity: id(5 + index * 2), targetIdentity: id(6 + index * 2), targetName: String(index).padStart(8, "0") + ".bin", bytes: 0, sha256: hash(Buffer.alloc(0)) }));
    input.absent = input.members.flatMap(member => ["-wal", "-shm", "-journal"].map(suffix => member.relativePath + suffix));
    const docs = createRawMaterialDocuments(input);
    expect(verifyRawMaterialDocuments(docs.manifest, docs.marker)).toMatchObject({ members: 3000, materialBytes: 0 });
    expect(JSON.parse(docs.manifest.toString()).absent).toHaveLength(9000);
  });
  it("rejects an empty payload whose declared digest cannot match empty bytes", () => {
    const input = fixture(); input.members[0]!.bytes = 0; rejected(input);
    input.members[0]!.sha256 = hash(Buffer.alloc(0));
    expect(verifyRawMaterialDocuments(...Object.values(createRawMaterialDocuments(input)) as [Buffer, Buffer])).toMatchObject({ materialBytes: 0 });
  });
  it("rejects Proxy/getters/hidden fields before executing them", () => {
    let calls = 0; const input = fixture();
    rejected(new Proxy(input, { ownKeys() { calls++; return []; } }));
    rejected({ ...input, get operationId() { calls++; return "own"; } });
    const member = fixture(); member.members[0] = new Proxy(member.members[0]!, { get() { calls++; throw new Error("PRIVATE"); } }); rejected(member);
    const array = fixture(); array.absent = new Proxy(array.absent, { getPrototypeOf() { calls++; return Array.prototype; } }); rejected(array);
    const hidden = fixture(); Object.defineProperty(hidden, "operationId", { enumerable: false }); rejected(hidden);
    expect(calls).toBe(0);
  });
  it.each(["formatVersion", "scope", "status", "semanticIdentity", "recoveryDependencies", "producerAuthentication", "restoreApproved", "productionApproved"])("rejects upgraded/contradictory manifest flag %s", key => {
    const docs = mutatedManifest(value => { value[key] = key.endsWith("Approved") ? true : "forged"; });
    expect(() => verifyRawMaterialDocuments(docs.manifest, docs.marker)).toThrow(RawMaterialProtocolError);
  });
  it("rejects tampering even when marker is stale and admits no producer proof from self-consistent rehash", () => {
    const docs = mutatedManifest(value => { (value.members as Array<{ sha256: string }>)[0]!.sha256 = "b".repeat(64); });
    expect(() => verifyRawMaterialDocuments(docs.manifest, docs.marker)).toThrow(RawMaterialProtocolError);
    const marker = JSON.parse(docs.marker.toString()); marker.manifestBytes = docs.manifest.length; marker.manifestSha256 = hash(docs.manifest);
    expect(verifyRawMaterialDocuments(docs.manifest, Buffer.from(JSON.stringify(marker)))).toMatchObject({ producerAuthentication: "not-established", rawPackageOpened: false, restoreApproved: false, productionApproved: false });
  });
  it("rejects bad UTF8, duplicate keys, noncanonical bytes, missing/wrong marker and future format", () => {
    const docs = createRawMaterialDocuments(fixture());
    for (const manifest of [Buffer.from([0xff]), Buffer.concat([docs.manifest, Buffer.from(" ")]), Buffer.from(docs.manifest.toString().replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1')), Buffer.from(docs.manifest.toString().replace('"formatVersion":1', '"formatVersion":2'))]) expect(() => verifyRawMaterialDocuments(manifest, docs.marker)).toThrow(RawMaterialProtocolError);
    for (const marker of [Buffer.alloc(0), Buffer.from("{}"), Buffer.concat([docs.marker, Buffer.from("\n")]), Buffer.from(docs.marker.toString().replace('"restoreApproved":false', '"restoreApproved":true'))]) expect(() => verifyRawMaterialDocuments(docs.manifest, marker)).toThrow(RawMaterialProtocolError);
  });
  it("rejects shared/proxy/oversized bytes and never consults caller iterators", () => {
    const docs = createRawMaterialDocuments(fixture());
    for (const manifest of [Buffer.from(new SharedArrayBuffer(128)), new Proxy(docs.manifest, {}), Buffer.alloc(16 * 1024 ** 2 + 1)]) expect(() => verifyRawMaterialDocuments(manifest, docs.marker)).toThrow(RawMaterialProtocolError);
    expect(() => verifyRawMaterialDocuments(docs.manifest, Buffer.alloc(4097))).toThrow(RawMaterialProtocolError);
    let calls = 0; Object.defineProperty(docs.manifest, Symbol.iterator, { get() { calls++; throw new Error("PRIVATE"); } });
    expect(verifyRawMaterialDocuments(docs.manifest, docs.marker).status).toBe("documents-consistent"); expect(calls).toBe(0);
  });
  it("pairs all present sidecars exactly, preserving empty sidecar vs missing declaration", () => {
    const db = new Database(":memory:"); db.exec("CREATE TABLE own(value TEXT);"); const bytes = db.serialize(); db.close();
    const input = fixture(); input.members[0]!.bytes = bytes.length; input.members[0]!.sha256 = hash(bytes);
    input.members.push({ relativePath: "project-xray.sqlite-journal", layoutSlot: "global-container", sourceIdentity: id(6), targetIdentity: id(7), targetName: "00000001.bin", bytes: 0, sha256: hash(Buffer.alloc(0)) });
    input.absent = input.absent.filter(name => !name.endsWith("-journal")); const docs = createRawMaterialDocuments(input);
    const request = { ...docs, relativeMain: "project-xray.sqlite", payloads: [{ targetName: "00000000.bin", content: bytes }, { targetName: "00000001.bin", content: Buffer.alloc(0) }] };
    expect(inspectCopiedRawDatabase(request)).toMatchObject({ status: "recovery-format-observed", recovery: { materials: { journal: { present: true, bytes: 0 } } } });
    expect(() => inspectCopiedRawDatabase({ ...request, payloads: request.payloads.slice(0, 1) })).toThrow(RawMaterialProtocolError);
  });
  it.each(["hash", "length", "missing", "duplicate", "foreign", "sidecar-as-main", "missing-database"])("rejects mismatched database copy (%s)", mode => {
    const docs = createRawMaterialDocuments(fixture()), content = Buffer.from("own");
    let relativeMain = "project-xray.sqlite", payloads = [{ targetName: "00000000.bin", content }];
    if (mode === "hash") content[0] = 0;
    if (mode === "length") payloads[0]!.content = Buffer.from("different-size");
    if (mode === "missing") payloads = [];
    if (mode === "duplicate") payloads.push(payloads[0]!);
    if (mode === "foreign") payloads[0]!.targetName = "00000002.bin";
    if (mode === "sidecar-as-main") relativeMain += "-wal";
    if (mode === "missing-database") relativeMain = "projects/other.sqlite";
    expect(() => inspectCopiedRawDatabase({ ...docs, relativeMain, payloads })).toThrow(RawMaterialProtocolError);
  });
  it("reports unknown recovery format without opening SQLite, even with self-consistent documents", () => {
    const docs = createRawMaterialDocuments(fixture());
    expect(inspectCopiedRawDatabase({ ...docs, relativeMain: "project-xray.sqlite", payloads: [{ targetName: "00000000.bin", content: Buffer.from("own") }] })).toMatchObject({ status: "recovery-format-rejected", recovery: { code: "RECOVERY_FORMAT_UNRESOLVED" }, sqliteOpenApproved: false });
  });
  it("rejects payload accessors/Proxy and over-limit bytes before any caller hook", () => {
    const docs = createRawMaterialDocuments(fixture()); let calls = 0;
    for (const payload of [{ targetName: "00000000.bin", get content() { calls++; return Buffer.from("own"); } }, { targetName: "00000000.bin", content: new Proxy(Buffer.from("own"), { get() { calls++; throw new Error("PRIVATE"); } }) }, { targetName: "00000000.bin", content: Buffer.alloc(64 * 1024 ** 2 + 1) }]) {
      expect(() => inspectCopiedRawDatabase({ ...docs, relativeMain: "project-xray.sqlite", payloads: [payload] })).toThrow(RawMaterialProtocolError);
    }
    expect(calls).toBe(0);
  });
});
