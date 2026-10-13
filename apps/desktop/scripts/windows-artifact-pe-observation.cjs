"use strict";

const { types } = require("node:util");

const DOS_HEADER_BYTES = 64;
const DOS_PE_OFFSET = 0x3c;
const PE_HEADER_BYTES = 24;
const PE_SIGNATURE = Buffer.from([0x50, 0x45, 0x00, 0x00]);
const requests = new WeakMap();

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length").get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;

function reject(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function assertFileBytes(fileBytes) {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) reject("invalid-file-length");
}

function copyCapture(input, maximumBytes, fileBytes) {
  if (input === null || (typeof input !== "object" && typeof input !== "function")) reject("invalid-byte-capture");
  if (types.isProxy(input)) reject("invalid-byte-capture");

  const isBuffer = Buffer.isBuffer(input);
  if ((!isBuffer && Object.getPrototypeOf(input) !== Uint8Array.prototype)
    || (isBuffer && Object.getPrototypeOf(input) !== Buffer.prototype)) {
    reject("invalid-byte-capture");
  }

  let length;
  let backing;
  let byteOffset;
  try {
    length = typedArrayLength.call(input);
    backing = typedArrayBuffer.call(input);
    byteOffset = typedArrayByteOffset.call(input);
  } catch {
    reject("invalid-byte-capture");
  }

  if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) reject("invalid-byte-capture-length");
  if (length > fileBytes) reject("capture-exceeds-file-length");
  if (types.isSharedArrayBuffer(backing)) reject("shared-byte-capture-not-supported");

  try {
    const source = Buffer.from(backing, byteOffset, length);
    const copy = Buffer.alloc(length);
    source.copy(copy);
    return copy;
  } catch {
    reject("invalid-byte-capture");
  }
}

function observation(peStatus, machine, architecture, issue) {
  return Object.freeze({ peStatus, machine, architecture, issue });
}

function derivePeHeaderRange(fileBytes, dosHeaderCapture) {
  assertFileBytes(fileBytes);
  const dosHeader = copyCapture(dosHeaderCapture, DOS_HEADER_BYTES, fileBytes);

  if (dosHeader.length < DOS_HEADER_BYTES) {
    return observation("unknown", null, null, "short-dos-header");
  }
  if (dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) {
    return observation("non-pe", null, null, "dos-signature-mismatch");
  }

  const offset = dosHeader.readUInt32LE(DOS_PE_OFFSET);
  if (offset < DOS_HEADER_BYTES) {
    return observation("unknown", null, null, "invalid-pe-header-offset");
  }

  const rangeEnd = offset + PE_HEADER_BYTES;
  if (!Number.isSafeInteger(rangeEnd)) {
    return observation("unknown", null, null, "pe-header-range-overflow");
  }
  if (rangeEnd > fileBytes) {
    return observation("unknown", null, null, "pe-header-range-out-of-file");
  }

  const request = Object.freeze({ offset, byteLength: PE_HEADER_BYTES });
  requests.set(request, Object.freeze({ fileBytes, offset }));
  return request;
}

function observePeHeader(fileBytes, request, peHeaderCapture) {
  const capturedRequest = requests.get(request);
  if (!capturedRequest) reject("invalid-pe-header-request");
  assertFileBytes(fileBytes);
  if (fileBytes !== capturedRequest.fileBytes) reject("pe-header-request-file-length-mismatch");

  const peHeader = copyCapture(peHeaderCapture, PE_HEADER_BYTES, fileBytes);
  if (peHeader.length < PE_HEADER_BYTES) {
    return observation("unknown", null, null, "short-pe-header");
  }
  if (!peHeader.subarray(0, PE_SIGNATURE.length).equals(PE_SIGNATURE)) {
    return observation("unknown", null, null, "pe-signature-mismatch");
  }

  const machineValue = peHeader.readUInt16LE(4);
  const machine = machineValue.toString(16).toUpperCase().padStart(4, "0");
  const architecture = machineValue === 0x8664 ? "x64" : machineValue === 0x014c ? "x86" : "unknown";
  return observation("pe", machine, architecture, architecture === "unknown" ? "unknown-machine" : null);
}

module.exports = Object.freeze({ derivePeHeaderRange, observePeHeader });
