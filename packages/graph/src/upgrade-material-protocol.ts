import { createHash } from "node:crypto";
import { types, TextDecoder } from "node:util";
import { inspectCopiedRecoverySet } from "./upgrade-recovery-format.js";

const MAX_FILES = 10_000, MAX_BYTES = 10 * 1024 ** 3;
const MAX_PRESENCE = MAX_FILES * 4;
const MAX_MANIFEST = 16 * 1024 ** 2, MAX_MARKER = 4096;
const suffixes = ["", "-wal", "-shm", "-journal"] as const;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const copyBytes = Uint8Array.prototype.set;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export class RawMaterialProtocolError extends Error {
  readonly code = "RAW_MATERIAL_PROTOCOL_REJECTED";
  constructor() { super("原始材料格式校验拒绝"); }
}
function reject(): never { throw new RawMaterialProtocolError(); }
function data(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) reject();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !field.enumerable || !Object.hasOwn(field, "value")) reject();
    output[key] = field.value;
  }
  return output;
}
function list(value: unknown, max = MAX_FILES): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) reject();
  if (Reflect.ownKeys(value).length !== value.length + 1) reject();
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !field.enumerable || !Object.hasOwn(field, "value")) reject();
    output.push(field.value);
  }
  return output;
}
function text(value: unknown, pattern: RegExp, max = 512): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > max || !pattern.test(value)) reject();
  return value;
}
function number(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) reject();
  return value as number;
}
function byteSize(value: unknown, max: number, empty = false): number {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Buffer.isBuffer(value) || Object.getPrototypeOf(value) !== Buffer.prototype || types.isSharedArrayBuffer(arrayBuffer.call(value))) reject();
  const size = byteLength.call(value) as number;
  if (size < (empty ? 0 : 1) || size > max) reject(); return size;
}
function capturedBytes(value: unknown, max: number, empty = false): Buffer {
  const size = byteSize(value, max, empty);
  const result = Buffer.alloc(size); copyBytes.call(result, value as Buffer); return result;
}
function identity(value: unknown): string { return text(value, /^[a-f0-9]{16}:[a-f0-9]{32}$/, 49); }
function relativeName(value: unknown): { name: string; main: string; slot: "global-container" | "project-file" } {
  const name = text(value, /^[^\\\x00-\x1f:*?"<>|]+$/);
  // Only the source layout's two slots, never an arbitrary path or an external journal name.
  const leaf = name.startsWith("projects/") ? name.slice(9) : name;
  if (leaf.includes("/") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(leaf)) reject();
  const suffix = suffixes.find(s => leaf.endsWith(".sqlite" + s));
  if (suffix === undefined) reject();
  const mainLeaf = leaf.slice(0, leaf.length - suffix.length), stem = mainLeaf.slice(0, -7);
  if (!stem || stem === "." || stem === ".." || stem.endsWith(".") || stem.endsWith(" ") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) reject();
  if (name.startsWith("projects/")) return { name, main: "projects/" + mainLeaf, slot: "project-file" };
  if (mainLeaf !== "project-xray.sqlite") reject();
  return { name, main: mainLeaf, slot: "global-container" };
}
interface Member {
  relativePath: string; layoutSlot: "global-container" | "project-file";
  sourceIdentity: string; targetName: string; targetIdentity: string; bytes: number; sha256: string;
}
export interface RawMaterialManifest {
  formatVersion: 1; status: "raw-material"; scope: "ordinary-win32-handles"; operationId: string;
  sourceRootIdentity: string; sourceProjectsIdentity: string | null; targetParentIdentity: string; targetOperationIdentity: string;
  members: Member[]; absent: string[];
  semanticIdentity: "unchecked"; recoveryDependencies: "unchecked"; producerAuthentication: "not-established";
  restoreApproved: false; productionApproved: false;
}
const inputKeys = ["operationId", "sourceRootIdentity", "sourceProjectsIdentity", "targetParentIdentity", "targetOperationIdentity", "members", "absent"];
const fixed = { formatVersion: 1, status: "raw-material", scope: "ordinary-win32-handles", semanticIdentity: "unchecked", recoveryDependencies: "unchecked", producerAuthentication: "not-established", restoreApproved: false, productionApproved: false } as const;
function normalize(input: unknown): RawMaterialManifest {
  const value = data(input, inputKeys);
  const operationId = text(value.operationId, /^[A-Za-z0-9_-]{1,128}$/, 128);
  const sourceRootIdentity = identity(value.sourceRootIdentity), targetParentIdentity = identity(value.targetParentIdentity), targetOperationIdentity = identity(value.targetOperationIdentity);
  const sourceProjectsIdentity = value.sourceProjectsIdentity === null ? null : identity(value.sourceProjectsIdentity);
  const volume = sourceRootIdentity.slice(0, 16), identities = new Set<string>(), names = new Set<string>(), groups = new Map<string, Set<string>>();
  function registerId(id: string): void { if (id.slice(0, 16) !== volume || identities.has(id)) reject(); identities.add(id); }
  for (const id of [sourceRootIdentity, targetParentIdentity, targetOperationIdentity]) registerId(id);
  if (sourceProjectsIdentity !== null) registerId(sourceProjectsIdentity);
  function registerName(name: string): ReturnType<typeof relativeName> {
    const parsed = relativeName(name), folded = name.toLowerCase();
    if (parsed.slot === "project-file" && sourceProjectsIdentity === null) reject();
    if (names.has(folded)) reject(); names.add(folded);
    const siblings = groups.get(parsed.main) ?? new Set<string>(); siblings.add(name); groups.set(parsed.main, siblings); return parsed;
  }
  let total = 0;
  const members = list(value.members).map((raw, index): Member => {
    const member = data(raw, ["relativePath", "layoutSlot", "sourceIdentity", "targetName", "targetIdentity", "bytes", "sha256"]);
    const parsed = registerName(member.relativePath as string);
    if (member.layoutSlot !== parsed.slot || member.targetName !== String(index).padStart(8, "0") + ".bin") reject();
    const sourceIdentity = identity(member.sourceIdentity), targetIdentity = identity(member.targetIdentity); registerId(sourceIdentity); registerId(targetIdentity);
    const bytes = number(member.bytes, MAX_BYTES); total += bytes; if (total > MAX_BYTES) reject();
    const sha256 = text(member.sha256, /^[a-f0-9]{64}$/, 64);
    if (bytes === 0 && sha256 !== digest(Buffer.alloc(0))) reject();
    return { relativePath: parsed.name, layoutSlot: parsed.slot, sourceIdentity, targetName: member.targetName as string, targetIdentity, bytes, sha256 };
  });
  const absent = list(value.absent, MAX_PRESENCE).map(raw => registerName(raw as string).name).sort();
  if (members.length + absent.length > MAX_PRESENCE || !members.some(m => m.relativePath === "project-xray.sqlite")) reject();
  const present = new Set(members.map(m => m.relativePath));
  for (const [main, siblings] of groups) {
    if (!present.has(main) || siblings.size !== 4 || suffixes.some(s => !siblings.has(main + s))) reject();
  }
  return { formatVersion: fixed.formatVersion, status: fixed.status, scope: fixed.scope, operationId, sourceRootIdentity, sourceProjectsIdentity, targetParentIdentity, targetOperationIdentity, members, absent, semanticIdentity: fixed.semanticIdentity, recoveryDependencies: fixed.recoveryDependencies, producerAuthentication: fixed.producerAuthentication, restoreApproved: false, productionApproved: false };
}
function canonical(value: unknown, max: number): Buffer {
  const bytes = Buffer.from(JSON.stringify(value), "utf8"); if (bytes.length > max) reject(); return bytes;
}
function parse(bytes: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)); } catch { reject(); }
}
function parseManifest(bytes: Buffer): RawMaterialManifest {
  const value = data(parse(bytes), ["formatVersion", "status", "scope", ...inputKeys, "semanticIdentity", "recoveryDependencies", "producerAuthentication", "restoreApproved", "productionApproved"]);
  for (const [key, expected] of Object.entries(fixed)) if (value[key] !== expected) reject();
  const input: Record<string, unknown> = Object.create(null); for (const key of inputKeys) input[key] = value[key];
  const normalized = normalize(input);
  // Canonical round-trip rejects duplicate keys, alternate spellings, whitespace and unknown fields.
  if (!canonical(normalized, MAX_MANIFEST).equals(bytes)) reject(); return normalized;
}
function markerFor(bytes: Buffer, manifest: RawMaterialManifest) {
  return { formatVersion: 1, status: "raw-material", operationId: manifest.operationId, manifestBytes: bytes.length, manifestSha256: digest(bytes), restoreApproved: false, productionApproved: false };
}
/** Internal document construction only. No file creation, source loan or successful package receipt. */
export function createRawMaterialDocuments(input: unknown): { manifest: Buffer; marker: Buffer } {
  try {
    const manifest = normalize(input), bytes = canonical(manifest, MAX_MANIFEST);
    return { manifest: bytes, marker: canonical(markerFor(bytes, manifest), MAX_MARKER) };
  } catch { reject(); }
}
/** Reopen prerequisite: self-consistent declarations never establish producer or HANDLE authority. */
export function verifyRawMaterialDocuments(manifestInput: unknown, markerInput: unknown) {
  try {
    const bytes = capturedBytes(manifestInput, MAX_MANIFEST), marker = capturedBytes(markerInput, MAX_MARKER);
    const manifest = parseManifest(bytes);
    if (!canonical(markerFor(bytes, manifest), MAX_MARKER).equals(marker)) reject();
    return Object.freeze({ status: "documents-consistent" as const, operationId: manifest.operationId, manifestBytes: bytes.length, manifestSha256: digest(bytes), members: manifest.members.length, materialBytes: manifest.members.reduce((sum, member) => sum + member.bytes, 0), producerAuthentication: "not-established" as const, rawPackageOpened: false as const, sqliteOpenApproved: false as const, restoreApproved: false as const, productionApproved: false as const });
  } catch { reject(); }
}

/** S2 byte prerequisite: exact declared payload pairing before recovery inspection, zero file IO. */
export function inspectCopiedRawDatabase(input: unknown) {
  try {
    const value = data(input, ["manifest", "marker", "relativeMain", "payloads"]);
    const bytes = capturedBytes(value.manifest, MAX_MANIFEST), marker = capturedBytes(value.marker, MAX_MARKER);
    const documents = verifyRawMaterialDocuments(bytes, marker), manifest = parseManifest(bytes);
    const requested = relativeName(value.relativeMain);
    if (requested.name !== requested.main) reject();
    const selected = manifest.members.filter(member => relativeName(member.relativePath).main === requested.main);
    if (!selected.some(member => member.relativePath === requested.main)) reject();
    const payloads = list(value.payloads, 4);
    if (payloads.length !== selected.length || payloads.length > 4) reject();
    let total = 0;
    const captured = payloads.map(raw => {
      const item = data(raw, ["targetName", "content"]);
      const targetName = text(item.targetName, /^[0-9]{8}\.bin$/, 12);
      total += byteSize(item.content, 64 * 1024 ** 2, true);
      if (total > 64 * 1024 ** 2) reject();
      return { targetName, original: item.content };
    });
    const names = new Set<string>();
    const recoveryInput: Record<string, Buffer | null> = { main: null, wal: null, shm: null, journal: null };
    for (const item of captured) {
      if (names.has(item.targetName)) reject(); names.add(item.targetName);
      const member = selected.find(candidate => candidate.targetName === item.targetName);
      if (!member) reject();
      const content = capturedBytes(item.original, 64 * 1024 ** 2, true);
      if (content.length !== member.bytes || digest(content) !== member.sha256) reject();
      const suffix = member.relativePath.slice(requested.main.length);
      recoveryInput[suffix === "" ? "main" : suffix.slice(1)] = content;
    }
    const recovery = inspectCopiedRecoverySet(recoveryInput);
    return Object.freeze({ status: recovery.status === "observed" ? "recovery-format-observed" as const : "recovery-format-rejected" as const,
      relativeMain: requested.main, manifestSha256: documents.manifestSha256, recovery,
      source: "caller-bytes-unverified" as const, producerAuthentication: "not-established" as const,
      rawPackageOpened: false as const, sqliteOpenApproved: false as const, restoreApproved: false as const, productionApproved: false as const });
  } catch { reject(); }
}
