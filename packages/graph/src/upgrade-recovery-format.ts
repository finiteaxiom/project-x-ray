import { createHash } from "node:crypto";
import { types } from "node:util";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS = 32_768;
const JOURNAL_MAGIC = Buffer.from("d9d505f920a163d7", "hex");
const MAIN_MAGIC = Buffer.from("SQLite format 3\0", "ascii");
const slots = ["main", "wal", "shm", "journal"] as const;
type Slot = typeof slots[number];
type Failure = "INVALID_INPUT" | "LIMIT_EXCEEDED" | "RECOVERY_FORMAT_UNRESOLVED" | "INCOMPLETE_RECOVERY_SET";
type Materials = Record<Slot, Buffer | null>;
interface Material { present: boolean; bytes: number; sha256: string | null }
interface Observation {
  status: "observed";
  formatVersion: "1";
  source: "caller-bytes-unverified";
  format: "main-only" | "wal" | "rollback";
  pageSize: number;
  records: number;
  commits: number;
  materials: Record<Slot, Material>;
  semanticIdentity: "unchecked";
  schemaProfile: "unchecked";
  sqliteOpenApproved: false;
  restoreApproved: false;
  productionApproved: false;
}
export type RecoveryFormatObservation = Observation | { status: "rejected"; code: Failure };
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const getLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const getBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const setBytes = Uint8Array.prototype.set;
function fail(code: Failure = "RECOVERY_FORMAT_UNRESOLVED"): never { throw code; }

function capture(value: unknown): Materials {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("INVALID_INPUT");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 4 || keys.some(key => !slots.includes(key as Slot))) fail("INVALID_INPUT");
  const original = {} as Materials;
  let total = 0;
  for (const slot of slots) {
    const property = Object.getOwnPropertyDescriptor(value, slot);
    if (!property || !Object.hasOwn(property, "value")) fail("INVALID_INPUT");
    const bytes: unknown = property.value;
    if (bytes === null) { original[slot] = null; continue; }
    if (typeof bytes !== "object" || types.isProxy(bytes) || !Buffer.isBuffer(bytes) || Object.getPrototypeOf(bytes) !== Buffer.prototype) fail("INVALID_INPUT");
    if (types.isSharedArrayBuffer(getBuffer.call(bytes))) fail("INVALID_INPUT");
    total += getLength.call(bytes) as number;
    if (total > MAX_BYTES) fail("LIMIT_EXCEEDED");
    original[slot] = bytes;
  }
  if (!original.main) fail("INVALID_INPUT");
  const result = {} as Materials;
  for (const slot of slots) {
    const bytes = original[slot];
    if (bytes === null) result[slot] = null;
    else {
      const copy = Buffer.alloc(getLength.call(bytes) as number);
      setBytes.call(copy, bytes); // Intrinsic copy, no caller iterator/valueOf/property reads.
      result[slot] = copy;
    }
  }
  return result;
}
function powerOfTwo(n: number, low: number, high: number): boolean { return n >= low && n <= high && (n & (n - 1)) === 0; }
function zero(bytes: Buffer, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (bytes[i] !== 0) return false;
  return true;
}
function mainHeader(main: Buffer, allowEmptySchema = false): number {
  if (main.length < 100 || !main.subarray(0, 16).equals(MAIN_MAGIC)) fail();
  const encoded = main.readUInt16BE(16), pageSize = encoded === 1 ? 65536 : encoded;
  if (!powerOfTwo(pageSize, 512, 65536) || main.length % pageSize !== 0) fail();
  if (![1, 2].includes(main[18]!) || main[19] !== main[18] || main[20] !== 0 || main[21] !== 64 || main[22] !== 32 || main[23] !== 32 || !zero(main, 72, 92)) fail();
  const schema = main.readUInt32BE(44), encoding = main.readUInt32BE(56);
  if (!(allowEmptySchema && schema === 0 && encoding === 0) && (![1, 2, 3, 4].includes(schema) || ![1, 2, 3].includes(encoding))) fail();
  // Page count can differ during WAL/rollback recovery. This is not a logical integrity check.
  return pageSize;
}
function checksum(bytes: Buffer, start: number, end: number, little: boolean, sum: [number, number]): void {
  for (let i = start; i < end; i += 8) {
    const a = little ? bytes.readUInt32LE(i) : bytes.readUInt32BE(i);
    const b = little ? bytes.readUInt32LE(i + 4) : bytes.readUInt32BE(i + 4);
    sum[0] = (sum[0] + a + sum[1]) >>> 0;
    sum[1] = (sum[1] + b + sum[0]) >>> 0;
  }
}
function pageNumber(number: number, pageSize: number): void {
  if (number === 0 || number > 0xfffffffe || number === Math.floor(0x40000000 / pageSize) + 1) fail();
}
function walFormat(wal: Buffer, pageSize: number): { records: number; commits: number; pageOne: Buffer | null } {
  if (wal.length < 32) fail();
  const magic = wal.readUInt32BE(0);
  if (![0x377f0682, 0x377f0683].includes(magic) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== pageSize) fail();
  const stride = pageSize + 24;
  if ((wal.length - 32) % stride !== 0) fail();
  const records = (wal.length - 32) / stride;
  if (records > MAX_RECORDS) fail("LIMIT_EXCEEDED");
  const sum: [number, number] = [0, 0], little = magic === 0x377f0682;
  checksum(wal, 0, 24, little, sum);
  if (sum[0] !== wal.readUInt32BE(24) || sum[1] !== wal.readUInt32BE(28)) fail();
  let commits = 0, pendingPageOne: Buffer | null = null, pageOne: Buffer | null = null;
  for (let at = 32; at < wal.length; at += stride) {
    pageNumber(wal.readUInt32BE(at), pageSize);
    const size = wal.readUInt32BE(at + 4);
    if (size > 0xfffffffe) fail();
    if (wal.readUInt32BE(at + 8) !== wal.readUInt32BE(16) || wal.readUInt32BE(at + 12) !== wal.readUInt32BE(20)) fail();
    checksum(wal, at, at + 8, little, sum);
    checksum(wal, at + 24, at + stride, little, sum);
    if (sum[0] !== wal.readUInt32BE(at + 16) || sum[1] !== wal.readUInt32BE(at + 20)) fail();
    if (wal.readUInt32BE(at) === 1) pendingPageOne = wal.subarray(at + 24, at + stride);
    if (size !== 0) { commits++; pageOne = pendingPageOne; }
  }
  // Stale/reset or torn tails are conservatively rejected, never treated as missing.
  return { records, commits, pageOne };
}
function journalFormat(journal: Buffer, pageSize: number): number {
  // Never decode, log, resolve, stat or open a super-journal path. Even malformed trailers fail closed.
  if (journal.length >= 8 && journal.subarray(-8).equals(JOURNAL_MAGIC)) fail("INCOMPLETE_RECOVERY_SET");
  if (journal.length < 28) fail();
  if (zero(journal, 0, 28)) return 0; // Known PERSIST invalidated header; no playback.
  let at = 0, records = 0, sector = 0, originalPages = 0;
  const pages = new Set<number>();
  while (at < journal.length) {
    if (at + 28 > journal.length || !journal.subarray(at, at + 8).equals(JOURNAL_MAGIC)) fail();
    const count = journal.readUInt32BE(at + 8), nonce = journal.readUInt32BE(at + 12);
    const initial = journal.readUInt32BE(at + 16), currentSector = journal.readUInt32BE(at + 20);
    if (count === 0 || count === 0xffffffff || initial === 0 || initial > 0xfffffffe || journal.readUInt32BE(at + 24) !== pageSize || !powerOfTwo(currentSector, 512, 65536)) fail();
    if (sector && (sector !== currentSector || originalPages !== initial)) fail();
    sector = currentSector; originalPages = initial;
    if (at + sector > journal.length || !zero(journal, at + 28, at + sector)) fail();
    records += count;
    if (records > MAX_RECORDS) fail("LIMIT_EXCEEDED");
    at += sector;
    const end = at + count * (pageSize + 8);
    if (end > journal.length) fail();
    for (; at < end; at += pageSize + 8) {
      const number = journal.readUInt32BE(at);
      pageNumber(number, pageSize);
      if (number > initial || pages.has(number)) fail();
      pages.add(number);
      let sum = nonce;
      for (let offset = pageSize - 200; offset > 0; offset -= 200) sum = (sum + journal[at + 4 + offset]!) >>> 0;
      if (sum !== journal.readUInt32BE(at + 4 + pageSize)) fail();
    }
    if (at === journal.length) break;
    const aligned = Math.ceil(at / sector) * sector;
    if (aligned > journal.length || !zero(journal, at, aligned)) fail();
    at = aligned;
  }
  return records;
}

/** Internal prerequisite only. Caller bytes and format observations never authorize SQLite/restore. */
export function inspectCopiedRecoverySet(input: unknown): RecoveryFormatObservation {
  try {
    const captured = capture(input), main = captured.main!;
    const wal = captured.wal, journal = captured.journal;
    const hasWal = wal !== null && wal.length > 0, hasJournal = journal !== null && journal.length > 0;
    const pageSize = mainHeader(main, hasWal);
    if (hasWal && hasJournal) fail();
    if (main[18] === 1 && (hasWal || (captured.shm !== null && captured.shm.length > 0))) fail();
    if (main[18] === 2 && hasJournal) fail();
    if (!hasWal && captured.shm !== null && captured.shm.length > 0) fail();
    const details = hasWal ? walFormat(wal, pageSize) : { records: hasJournal ? journalFormat(journal, pageSize) : 0, commits: 0, pageOne: null };
    // A newly created WAL database may still have an empty base schema header.
    // Only a checksummed, committed page-one image may supply its initialized header.
    if (details.pageOne && (mainHeader(details.pageOne) !== pageSize || details.pageOne[18] !== 2)) fail();
    if (main.readUInt32BE(44) === 0 && !details.pageOne) fail();
    const materials = {} as Record<Slot, Material>;
    for (const slot of slots) {
      const bytes = captured[slot];
      materials[slot] = bytes === null ? { present: false, bytes: 0, sha256: null } : { present: true, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    return { status: "observed", formatVersion: "1", source: "caller-bytes-unverified", format: hasWal ? "wal" : hasJournal ? "rollback" : "main-only", pageSize, records: details.records, commits: details.commits, materials, semanticIdentity: "unchecked", schemaProfile: "unchecked", sqliteOpenApproved: false, restoreApproved: false, productionApproved: false };
  } catch (code) {
    return { status: "rejected", code: ["INVALID_INPUT", "LIMIT_EXCEEDED", "RECOVERY_FORMAT_UNRESOLVED", "INCOMPLETE_RECOVERY_SET"].includes(code as string) ? code as Failure : "RECOVERY_FORMAT_UNRESOLVED" };
  }
}
