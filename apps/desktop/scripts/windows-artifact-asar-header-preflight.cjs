"use strict";

const { TextDecoder, types } = require("node:util");

const SIZE_PICKLE_BYTES = 8;
const MAX_HEADER_PICKLE_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT = 5000;
const MAX_PATH_DEPTH = 64;
const MAX_PATH_UTF8_BYTES = 512;
const MAX_COMPONENT_CODE_UNITS = 255;
const MAX_JSON_DEPTH = 132;
const MAX_JSON_NODES = 200000;
const MAX_JSON_OBJECT_KEYS = 50000;
const MAX_JSON_STRING_UTF8_BYTES = 4096;
const MAX_INTEGRITY_BLOCKS = 100000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const PICKLE_ALIGNMENT = 4;
const INTEGRITY_BLOCK_SIZE = 4 * 1024 * 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const JSON_WHITESPACE = new Set([" ", "\t", "\r", "\n"]);
const FAILURE_CODES = new Set([
  "invalid-archive-length",
  "archive-size-limit-exceeded",
  "invalid-byte-capture",
  "byte-capture-limit-exceeded",
  "invalid-size-pickle",
  "invalid-header-pickle",
  "header-size-mismatch",
  "header-size-limit-exceeded",
  "header-out-of-bounds",
  "invalid-pickle-layout",
  "invalid-pickle-padding",
  "invalid-header-utf8",
  "json-depth-limit-exceeded",
  "json-node-limit-exceeded",
  "json-object-key-limit-exceeded",
  "json-string-limit-exceeded",
  "duplicate-json-key",
  "invalid-json",
  "invalid-header-shape",
  "invalid-directory-shape",
  "invalid-entry-shape",
  "unsupported-link",
  "invalid-path",
  "ambiguous-case-path",
  "entry-count-limit-exceeded",
  "invalid-file-size",
  "invalid-file-offset",
  "packed-range-out-of-bounds",
  "overlapping-packed-ranges",
  "invalid-integrity",
  "output-limit-exceeded",
  "internal-error",
]);

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length").get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;

function reject(code) {
  const failure = Object.create(null);
  failure.code = FAILURE_CODES.has(code) ? code : "internal-error";
  throw failure;
}

function inspectBuffer(input, maximumBytes) {
  if (input === null || typeof input !== "object" || types.isProxy(input)) reject("invalid-byte-capture");

  let prototype;
  try {
    prototype = Object.getPrototypeOf(input);
  } catch {
    reject("invalid-byte-capture");
  }
  if (!Buffer.isBuffer(input) || prototype !== Buffer.prototype) reject("invalid-byte-capture");

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
  if (!Number.isSafeInteger(length) || length < 0) reject("invalid-byte-capture");
  if (length > maximumBytes) reject("byte-capture-limit-exceeded");
  if (types.isSharedArrayBuffer(backing)) reject("invalid-byte-capture");
  return { backing, byteOffset, length };
}

function copyBufferCapture(capture) {
  try {
    const source = Buffer.from(capture.backing, capture.byteOffset, capture.length);
    const copy = Buffer.alloc(capture.length);
    Buffer.prototype.copy.call(source, copy, 0, 0, capture.length);
    return copy;
  } catch {
    reject("invalid-byte-capture");
  }
}

function align4(value) {
  return value + ((PICKLE_ALIGNMENT - (value % PICKLE_ALIGNMENT)) % PICKLE_ALIGNMENT);
}

function readHeaderText(headerPickle) {
  if (headerPickle.length < 12) reject("invalid-header-pickle");
  const payloadSize = headerPickle.readUInt32LE(0);
  if (payloadSize !== headerPickle.length - 4 || payloadSize % PICKLE_ALIGNMENT !== 0) reject("invalid-pickle-layout");

  const stringByteLength = headerPickle.readInt32LE(4);
  if (stringByteLength < 0) reject("invalid-pickle-layout");
  const paddedStringBytes = align4(stringByteLength);
  if (4 + paddedStringBytes !== payloadSize) reject("invalid-pickle-layout");

  const paddingStart = 8 + stringByteLength;
  const paddingEnd = 8 + paddedStringBytes;
  for (let index = paddingStart; index < paddingEnd; index += 1) {
    if (headerPickle[index] !== 0) reject("invalid-pickle-padding");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(headerPickle.subarray(8, paddingStart));
  } catch {
    reject("invalid-header-utf8");
  }
}

function scanJson(text) {
  let cursor = 0;
  let nodes = 0;

  function skipWhitespace() {
    while (cursor < text.length && JSON_WHITESPACE.has(text[cursor])) cursor += 1;
  }

  function readString() {
    if (text[cursor] !== '"') reject("invalid-json");
    cursor += 1;
    const pieces = [];
    let decodedBytes = 0;

    function appendUnit(codeUnit, byteLength) {
      pieces.push(String.fromCharCode(codeUnit));
      decodedBytes += byteLength;
      if (decodedBytes > MAX_JSON_STRING_UTF8_BYTES) reject("json-string-limit-exceeded");
    }

    function readHexUnit() {
      if (cursor + 4 > text.length) reject("invalid-json");
      const hex = text.slice(cursor, cursor + 4);
      if (!/^[0-9a-fA-F]{4}$/u.test(hex)) reject("invalid-json");
      cursor += 4;
      return Number.parseInt(hex, 16);
    }

    while (cursor < text.length) {
      const character = text[cursor];
      const codeUnit = text.charCodeAt(cursor);
      cursor += 1;

      if (character === '"') return pieces.join("");
      if (character === "\\") {
        if (cursor >= text.length) reject("invalid-json");
        const escape = text[cursor];
        cursor += 1;
        if (escape === '"' || escape === "\\" || escape === "/") appendUnit(escape.charCodeAt(0), 1);
        else if (escape === "b") appendUnit(0x08, 1);
        else if (escape === "f") appendUnit(0x0c, 1);
        else if (escape === "n") appendUnit(0x0a, 1);
        else if (escape === "r") appendUnit(0x0d, 1);
        else if (escape === "t") appendUnit(0x09, 1);
        else if (escape === "u") {
          let escapedUnit = readHexUnit();
          if (escapedUnit >= 0xd800 && escapedUnit <= 0xdbff) {
            if (text[cursor] !== "\\" || text[cursor + 1] !== "u") reject("invalid-json");
            cursor += 2;
            const low = readHexUnit();
            if (low < 0xdc00 || low > 0xdfff) reject("invalid-json");
            appendUnit(escapedUnit, 0);
            appendUnit(low, 4);
          } else if (escapedUnit >= 0xdc00 && escapedUnit <= 0xdfff) {
            reject("invalid-json");
          } else {
            appendUnit(escapedUnit, escapedUnit < 0x80 ? 1 : escapedUnit < 0x800 ? 2 : 3);
          }
        } else reject("invalid-json");
        continue;
      }

      if (codeUnit < 0x20) reject("invalid-json");
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        if (cursor >= text.length) reject("invalid-json");
        const low = text.charCodeAt(cursor);
        if (low < 0xdc00 || low > 0xdfff) reject("invalid-json");
        cursor += 1;
        appendUnit(codeUnit, 0);
        appendUnit(low, 4);
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        reject("invalid-json");
      } else {
        appendUnit(codeUnit, codeUnit < 0x80 ? 1 : codeUnit < 0x800 ? 2 : 3);
      }
    }
    reject("invalid-json");
  }

  function readNumber() {
    if (text[cursor] === "-") cursor += 1;
    if (cursor >= text.length) reject("invalid-json");
    if (text[cursor] === "0") cursor += 1;
    else {
      if (text[cursor] < "1" || text[cursor] > "9") reject("invalid-json");
      while (text[cursor] >= "0" && text[cursor] <= "9") cursor += 1;
    }
    if (text[cursor] === ".") {
      cursor += 1;
      if (text[cursor] < "0" || text[cursor] > "9") reject("invalid-json");
      while (text[cursor] >= "0" && text[cursor] <= "9") cursor += 1;
    }
    if (text[cursor] === "e" || text[cursor] === "E") {
      cursor += 1;
      if (text[cursor] === "+" || text[cursor] === "-") cursor += 1;
      if (text[cursor] < "0" || text[cursor] > "9") reject("invalid-json");
      while (text[cursor] >= "0" && text[cursor] <= "9") cursor += 1;
    }
  }

  function readValue(depth) {
    if (depth > MAX_JSON_DEPTH) reject("json-depth-limit-exceeded");
    nodes += 1;
    if (nodes > MAX_JSON_NODES) reject("json-node-limit-exceeded");
    skipWhitespace();

    const character = text[cursor];
    if (character === '"') {
      readString();
      return;
    }
    if (character === "{") {
      cursor += 1;
      skipWhitespace();
      if (text[cursor] === "}") {
        cursor += 1;
        return;
      }
      const keys = new Set();
      while (cursor < text.length) {
        skipWhitespace();
        const key = readString();
        if (keys.has(key)) reject("duplicate-json-key");
        keys.add(key);
        if (keys.size > MAX_JSON_OBJECT_KEYS) reject("json-object-key-limit-exceeded");
        skipWhitespace();
        if (text[cursor] !== ":") reject("invalid-json");
        cursor += 1;
        readValue(depth + 1);
        skipWhitespace();
        if (text[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ",") reject("invalid-json");
        cursor += 1;
      }
      reject("invalid-json");
    }
    if (character === "[") {
      cursor += 1;
      skipWhitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        readValue(depth + 1);
        skipWhitespace();
        if (text[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (text[cursor] !== ",") reject("invalid-json");
        cursor += 1;
      }
      reject("invalid-json");
    }
    if (character === "t" && text.startsWith("true", cursor)) cursor += 4;
    else if (character === "f" && text.startsWith("false", cursor)) cursor += 5;
    else if (character === "n" && text.startsWith("null", cursor)) cursor += 4;
    else if (character === "-" || character >= "0" && character <= "9") readNumber();
    else reject("invalid-json");
  }

  readValue(0);
  skipWhitespace();
  if (cursor !== text.length) reject("invalid-json");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateComponent(component) {
  if (typeof component !== "string" || component.length === 0 || component === "." || component === ".." ||
      component.includes("/") || component.includes("\\") || component.length > MAX_COMPONENT_CODE_UNITS ||
      /[\u0000-\u001f\u007f<>:"|?*]/u.test(component) || /[ .]$/u.test(component)) reject("invalid-path");

  const deviceStem = component.split(".", 1)[0].replace(/[ .]+$/u, "").toLowerCase();
  if (/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/u.test(deviceStem)) reject("invalid-path");
}

function validateRelativePath(parts) {
  if (parts.length === 0 || parts.length > MAX_PATH_DEPTH) reject("invalid-path");
  for (const part of parts) validateComponent(part);
  const path = parts.join("/");
  if (Buffer.byteLength(path, "utf8") > MAX_PATH_UTF8_BYTES || path.startsWith("/") || /^[A-Za-z]:/u.test(path)) reject("invalid-path");
  return path;
}

function validateIntegrity(value) {
  if (!isRecord(value)) reject("invalid-integrity");
  const keys = Object.keys(value);
  if (keys.length !== 4 || !hasOwn(value, "algorithm") || !hasOwn(value, "hash") ||
      !hasOwn(value, "blockSize") || !hasOwn(value, "blocks")) reject("invalid-integrity");
  if (value.algorithm !== "SHA256" || typeof value.hash !== "string" || !SHA256_HEX.test(value.hash) ||
      value.blockSize !== INTEGRITY_BLOCK_SIZE || !Array.isArray(value.blocks) ||
      value.blocks.length === 0 || value.blocks.length > MAX_INTEGRITY_BLOCKS) reject("invalid-integrity");
  for (const hash of value.blocks) {
    if (typeof hash !== "string" || !SHA256_HEX.test(hash)) reject("invalid-integrity");
  }
}

function validateHeader(header, dataBytes) {
  if (!isRecord(header) || Object.keys(header).length !== 1 || !hasOwn(header, "files") || !isRecord(header.files)) {
    reject("invalid-header-shape");
  }

  const entries = [];
  const exactPaths = new Set();
  const foldedPaths = new Map();
  const packedRanges = [];
  let directories = 0;
  let files = 0;

  function addEntry(parts, isFile, unpacked) {
    if (entries.length >= MAX_ENTRY_COUNT) reject("entry-count-limit-exceeded");
    const path = validateRelativePath(parts);
    if (exactPaths.has(path)) reject("invalid-path");
    exactPaths.add(path);
    const folded = path.toLowerCase();
    const previous = foldedPaths.get(folded);
    if (previous !== undefined && previous !== path) reject("ambiguous-case-path");
    foldedPaths.set(folded, path);
    entries.push({ path, file: isFile, unpacked: isFile && unpacked });
    if (isFile) files += 1;
    else directories += 1;
  }

  function visitDirectory(children, parentParts) {
    if (!isRecord(children)) reject("invalid-directory-shape");
    const names = Object.keys(children);
    for (const name of names) {
      const parts = parentParts.concat(name);
      validateRelativePath(parts);
      const node = children[name];
      if (!isRecord(node)) reject("invalid-entry-shape");
      if (hasOwn(node, "link")) reject("unsupported-link");

      const nodeKeys = Object.keys(node);
      if (hasOwn(node, "files")) {
        if (nodeKeys.some(key => key !== "files" && key !== "unpacked") || !isRecord(node.files) ||
            hasOwn(node, "unpacked") && node.unpacked !== true) reject("invalid-directory-shape");
        addEntry(parts, false, false);
        visitDirectory(node.files, parts);
        continue;
      }

      const allowedFileKeys = new Set(["size", "offset", "unpacked", "integrity", "executable"]);
      if (nodeKeys.some(key => !allowedFileKeys.has(key)) || !hasOwn(node, "size") || !hasOwn(node, "integrity")) {
        reject("invalid-entry-shape");
      }
      if (!Number.isSafeInteger(node.size) || node.size < 0) reject("invalid-file-size");
      validateIntegrity(node.integrity);

      const isUnpacked = hasOwn(node, "unpacked");
      if (isUnpacked) {
        if (node.unpacked !== true || hasOwn(node, "offset") || hasOwn(node, "executable")) reject("invalid-entry-shape");
      } else {
        if (!hasOwn(node, "offset") || typeof node.offset !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(node.offset) ||
            hasOwn(node, "executable") && node.executable !== true) reject("invalid-file-offset");
        const offset = BigInt(node.offset);
        const size = BigInt(node.size);
        const dataLength = BigInt(dataBytes);
        if (offset > dataLength || size > dataLength - offset) reject("packed-range-out-of-bounds");
        if (size > 0n) packedRanges.push({ start: offset, end: offset + size });
      }
      addEntry(parts, true, isUnpacked);
    }
  }

  visitDirectory(header.files, []);
  packedRanges.sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : 0);
  for (let index = 1; index < packedRanges.length; index += 1) {
    if (packedRanges[index].start < packedRanges[index - 1].end) reject("overlapping-packed-ranges");
  }

  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { entries, directories, files };
}

function freezeResult(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeResult(child);
    Object.freeze(value);
  }
  return value;
}

function makeResult(status, failureCode, archiveBytes, sizePickleBytes, headerPickleBytes, observation) {
  const entries = observation ? observation.entries : [];
  const result = {
    observationStatus: status,
    failureCode,
    evidence: { source: "caller-bytes", scope: "header-only" },
    claims: {
      snapshot: "incomplete",
      signature: "not-evaluated",
      content: "not-evaluated",
      hash: "not-evaluated",
      sourceIdentity: "not-evaluated",
    },
    archiveBytes,
    sizePickleBytes,
    headerPickleBytes,
    counts: {
      entries: entries.length,
      directories: observation ? observation.directories : 0,
      files: observation ? observation.files : 0,
    },
    entries,
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_OUTPUT_BYTES) reject("output-limit-exceeded");
  return freezeResult(result);
}

function observeAsarHeader(sizePickleCapture, headerPickleCapture, archiveBytes) {
  let capturedSizeLength = null;
  let capturedHeaderLength = null;
  let capturedArchiveBytes = null;
  try {
    if (!Number.isSafeInteger(archiveBytes) || archiveBytes < SIZE_PICKLE_BYTES) reject("invalid-archive-length");
    if (archiveBytes > MAX_ARCHIVE_BYTES) reject("archive-size-limit-exceeded");
    capturedArchiveBytes = archiveBytes;

    const sizeInfo = inspectBuffer(sizePickleCapture, SIZE_PICKLE_BYTES);
    const headerInfo = inspectBuffer(headerPickleCapture, MAX_HEADER_PICKLE_BYTES);
    capturedSizeLength = sizeInfo.length;
    capturedHeaderLength = headerInfo.length;
    if (sizeInfo.length !== SIZE_PICKLE_BYTES) reject("invalid-size-pickle");
    if (headerInfo.length === 0) reject("invalid-header-pickle");

    const sizePickle = copyBufferCapture(sizeInfo);
    const headerPickle = copyBufferCapture(headerInfo);
    if (sizePickle.readUInt32LE(0) !== 4) reject("invalid-size-pickle");
    const declaredHeaderBytes = sizePickle.readUInt32LE(4);
    if (declaredHeaderBytes > MAX_HEADER_PICKLE_BYTES) reject("header-size-limit-exceeded");
    if (declaredHeaderBytes !== headerPickle.length) reject("header-size-mismatch");
    if (declaredHeaderBytes > archiveBytes - SIZE_PICKLE_BYTES) reject("header-out-of-bounds");

    const dataStart = SIZE_PICKLE_BYTES + declaredHeaderBytes;
    const dataBytes = archiveBytes - dataStart;
    const headerText = readHeaderText(headerPickle);
    scanJson(headerText);

    let header;
    try {
      header = JSON.parse(headerText);
    } catch {
      reject("invalid-json");
    }
    const observation = validateHeader(header, dataBytes);
    return makeResult("passed", null, archiveBytes, sizeInfo.length, headerInfo.length, observation);
  } catch (error) {
    const code = error && typeof error === "object" && FAILURE_CODES.has(error.code) ? error.code : "internal-error";
    return makeResult("failed", code, capturedArchiveBytes, capturedSizeLength, capturedHeaderLength, null);
  }
}

module.exports = Object.freeze({ observeAsarHeader });
