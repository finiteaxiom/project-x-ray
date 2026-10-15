import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectCopiedRecoverySet } from "./upgrade-recovery-format.js";

const magic = Buffer.from("d9d505f920a163d7", "hex");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function main(): Buffer {
  const db = new Database(":memory:");
  try { db.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('ATTACH ordinary data');"); return db.serialize(); }
  finally { db.close(); }
}
function set(bytes = main(), journal: Buffer | null = null) { return { main: bytes, wal: null, shm: null, journal }; }
function wal(little: boolean, committed = true): Buffer {
  const result = Buffer.alloc(32 + 24 + 4096);
  result.writeUInt32BE(little ? 0x377f0682 : 0x377f0683, 0); result.writeUInt32BE(3007000, 4); result.writeUInt32BE(4096, 8);
  result.writeUInt32BE(17, 16); result.writeUInt32BE(29, 20);
  result.writeUInt32BE(1, 32); result.writeUInt32BE(committed ? 2 : 0, 36); result.writeUInt32BE(17, 40); result.writeUInt32BE(29, 44);
  const header = main(); header[18] = 2; header[19] = 2; header.copy(result, 56, 0, 4096);
  // Independent fixture recurrence; header and frame checksum words are always big endian.
  let a = 0, b = 0;
  for (const [start, end, target] of [[0, 24, 24], [32, 40, -1], [56, result.length, 48]]) {
    for (let offset = start!; offset < end!; offset += 8) {
      a = (a + (little ? result.readUInt32LE(offset) : result.readUInt32BE(offset)) + b) >>> 0;
      b = (b + (little ? result.readUInt32LE(offset + 4) : result.readUInt32BE(offset + 4)) + a) >>> 0;
    }
    if (target! >= 0) { result.writeUInt32BE(a, target!); result.writeUInt32BE(b, target! + 4); }
  }
  return result;
}
function journal(page: Buffer, pageNumber = 2, initialPages = 2): Buffer {
  const bytes = Buffer.alloc(512 + 4 + page.length + 4);
  magic.copy(bytes); bytes.writeUInt32BE(1, 8); bytes.writeUInt32BE(1234567, 12); bytes.writeUInt32BE(initialPages, 16);
  bytes.writeUInt32BE(512, 20); bytes.writeUInt32BE(page.length, 24); bytes.writeUInt32BE(pageNumber, 512); page.copy(bytes, 516);
  let checksum = 1234567;
  for (let i = page.length - 200; i > 0; i -= 200) checksum = (checksum + page[i]!) >>> 0;
  bytes.writeUInt32BE(checksum, bytes.length - 4); return bytes;
}
const rejected = (value: unknown, code = "RECOVERY_FORMAT_UNRESOLVED") => expect(inspectCopiedRecoverySet(value)).toEqual({ status: "rejected", code });

describe("copied recovery format prerequisite, no SQLite authority", () => {
  it("observes real serialized main and preserves literal ATTACH data and all input bytes", () => {
    const input = set(), before = hash(input.main), result = inspectCopiedRecoverySet(input);
    expect(result).toMatchObject({ status: "observed", format: "main-only", source: "caller-bytes-unverified", records: 0, semanticIdentity: "unchecked", schemaProfile: "unchecked", sqliteOpenApproved: false, productionApproved: false, restoreApproved: false });
    expect(result).toMatchObject({ materials: { main: { present: true, bytes: input.main.length, sha256: before }, journal: { present: false, sha256: null } } });
    expect(hash(input.main)).toBe(before);
  });
  it("keeps absent and present-empty sidecars distinct", () => {
    expect(inspectCopiedRecoverySet(set(main(), Buffer.alloc(0)))).toMatchObject({ status: "observed", materials: { journal: { present: true, bytes: 0, sha256: hash(Buffer.alloc(0)) } } });
  });
  it("checks actual self-created WAL/SHM bytes without opening captured data", () => {
    const root = mkdtempSync(join(tmpdir(), "xray-recovery-format-")), path = join(root, "own.sqlite");
    const db = new Database(path);
    try {
      db.pragma("journal_mode=WAL"); db.pragma("wal_autocheckpoint=0");
      db.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('own committed row');");
      const input = { main: readFileSync(path), wal: readFileSync(path + "-wal"), shm: readFileSync(path + "-shm"), journal: null };
      const before = [input.main, input.wal, input.shm].map(hash);
      expect(inspectCopiedRecoverySet(input)).toMatchObject({ status: "observed", format: "wal", commits: 2, sqliteOpenApproved: false, materials: { shm: { sha256: before[2] } } });
      const operation = join(root, "operation.sqlite");
      writeFileSync(operation, input.main, { flag: "wx" }); writeFileSync(operation + "-wal", input.wal, { flag: "wx" });
      const recovered = new Database(operation);
      try { expect(recovered.prepare("SELECT value FROM sample").get()).toEqual({ value: "own committed row" }); }
      finally { recovered.close(); }
      expect([input.main, input.wal, input.shm].map(hash)).toEqual(before);
    } finally { db.close(); } // Own fixture retained; not a HANDLE/quiescence experiment.
  });
  it.each([true, false])("verifies both WAL checksum byte orders (%s)", little => {
    const bytes = main(); bytes[18] = 2; bytes[19] = 2;
    expect(inspectCopiedRecoverySet({ ...set(bytes), wal: wal(little) })).toMatchObject({ status: "observed", format: "wal", records: 1, commits: 1 });
  });
  it("requires committed page-one initialization for an empty base header", () => {
    const bytes = main(); bytes[18] = 2; bytes[19] = 2; bytes.writeUInt32BE(0, 44); bytes.writeUInt32BE(0, 56);
    rejected({ ...set(bytes), wal: wal(true, false) });
    expect(inspectCopiedRecoverySet({ ...set(bytes), wal: wal(true) })).toMatchObject({ status: "observed", commits: 1 });
    rejected(set(bytes));
  });
  it.each([0, 4, 8, 16, 24, 32, 40, 48, 100])("rejects corrupt WAL at %s", offset => {
    const bytes = main(); bytes[18] = 2; bytes[19] = 2; const log = wal(true); log[offset] = log[offset]! ^ 128;
    rejected({ ...set(bytes), wal: log });
  });
  it.each([1, 16, 31, 33, 80, 4151])("rejects torn WAL length %s", length => {
    const bytes = main(); bytes[18] = 2; bytes[19] = 2; rejected({ ...set(bytes), wal: wal(true).subarray(0, length) });
  });
  it("observes real PERSIST invalidation and keeps its complete bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "xray-recovery-persist-")), path = join(root, "own.sqlite"), db = new Database(path);
    try {
      db.pragma("journal_mode=PERSIST"); db.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('old'); UPDATE sample SET value='new';");
      expect(existsSync(path + "-journal")).toBe(true);
      const input = set(readFileSync(path), readFileSync(path + "-journal"));
      expect(inspectCopiedRecoverySet(input)).toMatchObject({ status: "observed", format: "rollback", records: 0, materials: { journal: { sha256: hash(input.journal!) } } });
    } finally { db.close(); }
  });
  it("valid finite journal is replayed by real SQLite on a separate own operation copy", () => {
    const root = mkdtempSync(join(tmpdir(), "xray-recovery-journal-")), path = join(root, "own.sqlite");
    const db = new Database(path); db.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('before');");
    const before = db.serialize(); db.exec("UPDATE sample SET value='after';"); db.close();
    const after = readFileSync(path), log = journal(before.subarray(4096, 8192));
    expect(inspectCopiedRecoverySet(set(after, log))).toMatchObject({ status: "observed", format: "rollback", records: 1, sqliteOpenApproved: false });
    const operation = join(root, "operation.sqlite"); writeFileSync(operation, after, { flag: "wx" }); writeFileSync(operation + "-journal", log, { flag: "wx" });
    const recovered = new Database(operation);
    try { expect(recovered.prepare("SELECT value FROM sample").get()).toEqual({ value: "before" }); }
    finally { recovered.close(); }
    expect(hash(readFileSync(path))).toBe(hash(after));
    expect(hash(log)).toBe(hash(journal(before.subarray(4096, 8192))));
  });
  it("checks multiple finite journal segments and rejects repeated page records", () => {
    const bytes = main(), page = bytes.subarray(0, 4096), first = journal(page, 1, 3), second = journal(page, 2, 3);
    const padded = Buffer.concat([first, Buffer.alloc(Math.ceil(first.length / 512) * 512 - first.length), second]);
    expect(inspectCopiedRecoverySet(set(bytes, padded))).toMatchObject({ status: "observed", records: 2 });
    second.writeUInt32BE(1, 512); rejected(set(bytes, Buffer.concat([first, Buffer.alloc(Math.ceil(first.length / 512) * 512 - first.length), second])));
  });
  it.each([8, 20, 24, 512, 516 + 3896, 4612])("rejects bad journal header/page/checksum at %s", offset => {
    const bytes = main(), log = journal(bytes.subarray(4096, 8192)); log[offset] = log[offset]! ^ 255; rejected(set(bytes, log), offset === 8 ? "LIMIT_EXCEEDED" : "RECOVERY_FORMAT_UNRESOLVED");
  });
  it("rejects unknown record counts, truncated and nonzero trailing data", () => {
    const bytes = main(), log = journal(bytes.subarray(4096, 8192));
    for (const count of [0, 0xffffffff]) { const bad = Buffer.from(log); bad.writeUInt32BE(count, 8); rejected(set(bytes, bad)); }
    rejected(set(bytes, log.subarray(0, log.length - 1))); rejected(set(bytes, Buffer.concat([log, Buffer.from("private unknown trailing material")])));
  });
  it("rejects super-journal trailers before decoding paths, including malformed lengths/checksums", () => {
    const bytes = main(), log = journal(bytes.subarray(4096, 8192));
    for (const length of [0, 9, 0xffffffff]) {
      const trailer = Buffer.alloc(20); trailer.writeUInt32BE(length, 4); magic.copy(trailer, 12);
      rejected(set(bytes, Buffer.concat([log, trailer])), "INCOMPLETE_RECOVERY_SET");
    }
  });
  it("rejects contradictory sidecar modes and orphan SHM in rollback mode", () => {
    const bytes = main(); rejected({ ...set(bytes), wal: wal(true) }); rejected({ ...set(bytes), shm: Buffer.from("shm") });
    bytes[18] = 2; bytes[19] = 2; rejected(set(bytes, journal(bytes.subarray(4096, 8192))));
    rejected({ ...set(bytes), shm: Buffer.from("orphan shm") });
    rejected({ ...set(bytes, Buffer.alloc(28)), wal: wal(true) });
  });
  it.each([0, 16, 18, 20, 21, 44, 56, 72])("rejects unsupported main headers (%s)", offset => {
    const bytes = main(); bytes[offset] = bytes[offset]! ^ 255; rejected(set(bytes));
  });
  it("strictly captures without invoking Proxy traps/getters/iterators", () => {
    let calls = 0; const input = set();
    rejected(new Proxy(input, { ownKeys() { calls++; return []; } }), "INVALID_INPUT");
    rejected({ ...input, get journal() { calls++; return null; } }, "INVALID_INPUT");
    rejected({ ...input, main: new Proxy(input.main, { get() { calls++; throw new Error("private"); } }) }, "INVALID_INPUT");
    Object.defineProperty(input.main, Symbol.iterator, { get() { calls++; throw new Error("private"); } });
    expect(inspectCopiedRecoverySet(input)).toMatchObject({ status: "observed" }); expect(calls).toBe(0);
    const result = inspectCopiedRecoverySet(input); input.main.fill(0); expect(result).toMatchObject({ materials: { main: { sha256: expect.any(String) } } });
  });
  it("rejects shared buffers, excess/hidden fields and missing main", () => {
    rejected({ ...set(), main: Buffer.from(new SharedArrayBuffer(8192)) }, "INVALID_INPUT");
    rejected({ ...set(), extra: "private" }, "INVALID_INPUT");
    rejected(Object.defineProperty(set(), "hidden", { value: 1 }), "INVALID_INPUT"); rejected(set(null as unknown as Buffer), "INVALID_INPUT");
  });
  it("enforces byte budget before private copies", () => {
    rejected({ ...set(), shm: Buffer.alloc(64 * 1024 * 1024) }, "LIMIT_EXCEEDED");
  });
});
