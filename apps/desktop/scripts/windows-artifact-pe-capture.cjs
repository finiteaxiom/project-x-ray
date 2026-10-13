"use strict";

// Internal DTO consumption only. A caller-created DTO is not source authentication.
// Importing this module never opens a file or starts a process.
const { types } = require("node:util");
const { derivePeHeaderRange, observePeHeader } = require("./windows-artifact-pe-observation.cjs");
function reject() { const error = new TypeError("PE capture is invalid"); error.code = "PE_CAPTURE_INVALID"; throw error; }
function record(input, keys) {
  if (!input || typeof input !== "object" || types.isProxy(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) reject();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) reject();
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) reject();
    copy[key] = descriptor.value;
  }
  return copy;
}
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) reject(); }
function hex(value, bytes) { if (typeof value !== "string" || value.length !== bytes * 2 || !/^[0-9a-f]*$/.test(value)) reject(); return Buffer.from(value, "hex"); }

/** Synchronously captures plain fields; retains no caller object or byte array. */
function consumePeCapture(input) {
  const o = record(input, ["status", "snapshotStatus", "signatureStatus", "identity", "bytesRead", "bufferBytes", "readCalls", "sha256", "heldHandles", "peCapture"]);
  const identity = record(o.identity, ["volume", "fileId"]);
  const capture = record(o.peCapture, ["version", "fileBytes", "dosHex", "peOffset", "peHex"]);
  if (o.status !== "observed" || o.snapshotStatus !== "incomplete" || o.signatureStatus !== "not-evaluated"
    || o.bufferBytes !== 1048576 || capture.version !== 1 || capture.fileBytes !== o.bytesRead
    || typeof identity.volume !== "string" || !/^[0-9A-F]{16}$/.test(identity.volume)
    || typeof identity.fileId !== "string" || !/^[0-9A-F]{32}$/.test(identity.fileId)) reject();
  integer(o.bytesRead, 0, 2147483648); integer(o.heldHandles, 1, 65);
  integer(o.readCalls, Math.ceil(o.bytesRead / o.bufferBytes) + 1, o.bytesRead + 1);
  hex(o.sha256, 32);
  const dos = hex(capture.dosHex, Math.min(64, o.bytesRead));
  const request = derivePeHeaderRange(o.bytesRead, dos);
  let pe;
  if (Object.hasOwn(request, "offset")) {
    integer(capture.peOffset, 64, o.bytesRead - 24);
    if (capture.peOffset !== request.offset) reject();
    pe = observePeHeader(o.bytesRead, request, hex(capture.peHex, 24));
  } else {
    if (capture.peOffset !== null || capture.peHex !== "") reject();
    pe = request;
  }
  // No raw DOS/COFF bytes, path, signer assertion or captured material in the output.
  return Object.freeze({ status: o.status, snapshotStatus: o.snapshotStatus, signatureStatus: o.signatureStatus,
    identity: Object.freeze({ volume: identity.volume, fileId: identity.fileId }), bytesRead: o.bytesRead,
    bufferBytes: o.bufferBytes, readCalls: o.readCalls, sha256: o.sha256, heldHandles: o.heldHandles, pe });
}
module.exports = Object.freeze({ consumePeCapture });
