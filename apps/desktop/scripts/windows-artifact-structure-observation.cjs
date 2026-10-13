"use strict";

const { types } = require("node:util");

const PROFILE_ID = "project-xray-windows-x64-electron-builder-v1";
const STRUCTURE_STATUSES = Object.freeze(["passed", "failed", "not-evaluated"]);
const STRUCTURE_ISSUES = Object.freeze([
  "missing-required-entry",
  "unexpected-entry",
  "python-worker-location-mismatch",
  "native-unclassified",
  "portable-root-missing",
  "portable-not-pe",
  "app-staging-empty",
  "profile-unsupported",
  "profile-incomplete",
  "declared-passed-with-findings",
]);
const ISSUE_SET = new Set(STRUCTURE_ISSUES);
const CAPTURE_STATES = new Set(["complete", "incomplete"]);
const LIMITS = Object.freeze({
  maxEntriesPerList: 20000,
  maxObjectKeys: 16,
  maxInputDepth: 8,
  maxInputNodes: 100000,
  maxInputCharacters: 8 * 1024 * 1024,
  maxPathUtf8Bytes: 512,
  maxPathDepth: 64,
  maxComponentCodeUnits: 255,
});

const REQUIRED_ASAR_ENTRIES = Object.freeze([
  "apps/desktop/dist/main.js",
  "apps/desktop/dist/preload.js",
  "apps/desktop/dist/analysis-worker.js",
  "apps/desktop/dist/explanation-worker.js",
  "apps/desktop/dist/remote-execution-worker.js",
  "apps/ui/dist/index.html",
]);
const UI_ASSET_PREFIX = "apps/ui/dist/assets/";
const PYTHON_ASAR_PATH = "apps/desktop/dist/python-analyze.py";
const PYTHON_RESOURCE_PATH = "python-analyze.py";
const REQUIRED_UNPACKED_ENTRIES = Object.freeze([
  "apps/desktop/dist/native/secure_reader.node",
  "apps/desktop/dist/native/windows_credentials.node",
]);
const REQUIRED_UNPACKED_SET = new Set(REQUIRED_UNPACKED_ENTRIES);
const SQLITE_RELATIVE_PATHS = Object.freeze([
  "prebuilds/win32-x64.node",
  "build/Release/better_sqlite3.node",
  "build/release/better_sqlite3.node",
]);

class StructureObservationError extends Error {
  constructor(code) {
    super(code);
    this.name = "StructureObservationError";
    this.code = code;
  }
}

function reject(code) {
  throw new StructureObservationError(code);
}

function validScalars(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function capturePlainData(input) {
  const seen = new WeakSet();
  const budget = { nodes: 0, characters: 0 };

  function copy(value, depth) {
    budget.nodes += 1;
    if (budget.nodes > LIMITS.maxInputNodes || depth > LIMITS.maxInputDepth) reject("capture-limit-exceeded");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      budget.characters += value.length;
      if (budget.characters > LIMITS.maxInputCharacters || !validScalars(value)) reject("invalid-or-oversize-string");
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) reject("unsafe-number");
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) reject("non-plain-data");
    if (seen.has(value)) reject("aliased-or-cyclic-data");
    seen.add(value);

    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      reject("uninspectable-data");
    }
    if (Array.isArray(value) && value.length > LIMITS.maxEntriesPerList) reject("invalid-array");
    if (!Array.isArray(value) && keys.length > LIMITS.maxObjectKeys) reject("object-field-limit-exceeded");
    budget.nodes += keys.length;
    if (budget.nodes > LIMITS.maxInputNodes || keys.some(key => typeof key === "string" && (budget.characters += key.length) > LIMITS.maxInputCharacters)) reject("capture-limit-exceeded");

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > LIMITS.maxEntriesPerList ||
          keys.length !== value.length + 1 || keys.some(key => typeof key !== "string")) reject("invalid-array");
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) reject("array-hole-or-accessor");
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }

    if (prototype !== Object.prototype && prototype !== null) reject("invalid-object-prototype");
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") reject("symbol-key-not-allowed");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) reject("accessor-not-allowed");
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }

  return copy(input, 0);
}

function exactKeys(value, expected, code = "invalid-input-shape") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) reject(code);
}

function validateRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || !validScalars(value) ||
      Buffer.byteLength(value, "utf8") > LIMITS.maxPathUtf8Bytes || value.includes("\\") ||
      value.startsWith("/") || /^[A-Za-z]:/u.test(value) || /[\u0000-\u001f\u007f<>:"|?*]/u.test(value)) reject("invalid-relative-path");
  const parts = value.split("/");
  if (parts.length > LIMITS.maxPathDepth || parts.some(part => part.length === 0 || part === "." || part === ".." ||
      part.length > LIMITS.maxComponentCodeUnits || /[ .]$/u.test(part))) reject("invalid-relative-path");
  return value;
}

function validatePathList(value) {
  if (!Array.isArray(value) || value.length > LIMITS.maxEntriesPerList) reject("entry-list-limit-exceeded");
  const exact = new Set();
  const windowsFolded = new Map();
  const paths = [];
  for (const entry of value) {
    const path = validateRelativePath(entry);
    if (exact.has(path)) reject("duplicate-path");
    exact.add(path);
    const folded = path.toLowerCase();
    const prior = windowsFolded.get(folded);
    if (prior !== undefined && prior !== path) reject("ambiguous-case-path");
    windowsFolded.set(folded, path);
    paths.push(path);
  }
  return Object.freeze({ paths, exact });
}

function validateAsarEntries(value) {
  if (!Array.isArray(value) || value.length > LIMITS.maxEntriesPerList) reject("entry-list-limit-exceeded");
  const entries = [];
  const byPath = new Map();
  const exact = new Set();
  const windowsFolded = new Map();
  let metadataComplete = true;
  for (const candidate of value) {
    exactKeys(candidate, ["path", "file", "unpacked"], "invalid-asar-entry-fields");
    const path = validateRelativePath(candidate.path);
    if (candidate.file !== true && candidate.file !== false && candidate.file !== null) reject("invalid-asar-file-state");
    if (candidate.unpacked !== true && candidate.unpacked !== false && candidate.unpacked !== null) reject("invalid-asar-unpacked-state");
    if (candidate.file === false && candidate.unpacked === true) reject("invalid-asar-entry-state");
    if (candidate.file === null || candidate.unpacked === null) metadataComplete = false;
    if (exact.has(path)) reject("duplicate-path");
    exact.add(path);
    const folded = path.toLowerCase();
    const prior = windowsFolded.get(folded);
    if (prior !== undefined && prior !== path) reject("ambiguous-case-path");
    windowsFolded.set(folded, path);
    const entry = Object.freeze({ path, file: candidate.file, unpacked: candidate.unpacked });
    entries.push(entry);
    byPath.set(path, entry);
  }
  return Object.freeze({ entries, byPath, exact, metadataComplete });
}

function validateCaptureState(value) {
  if (typeof value !== "string" || !CAPTURE_STATES.has(value)) reject("invalid-capture-state");
  return value;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezePlain(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezePlain(child);
    Object.freeze(value);
  }
  return value;
}

function isNativePath(path) {
  return path.toLowerCase().endsWith(".node");
}

function isPackedAsarFile(entry) {
  return entry?.file === true && entry.unpacked === false;
}

function isSqliteAddonPath(path) {
  const parts = path.split("/");
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] !== "node_modules" || parts[index + 1] !== "better-sqlite3") continue;
    const packageRelative = parts.slice(index + 2).join("/");
    if (SQLITE_RELATIVE_PATHS.includes(packageRelative)) return true;
  }
  return false;
}

function observeArtifactStructure(input) {
  const captured = capturePlainData(input);
  exactKeys(captured, ["schemaVersion", "profileId", "capture", "asarEntries", "unpackedFiles", "extraResourceFiles"]);
  if (captured.schemaVersion !== 1) reject("unsupported-capture-schema");
  if (typeof captured.profileId !== "string" || captured.profileId.length === 0 || captured.profileId.length > 128) reject("invalid-profile-id");
  exactKeys(captured.capture, ["asar", "unpacked", "extraResources"]);
  const capture = {
    asar: validateCaptureState(captured.capture.asar),
    unpacked: validateCaptureState(captured.capture.unpacked),
    extraResources: validateCaptureState(captured.capture.extraResources),
  };
  const asar = validateAsarEntries(captured.asarEntries);
  const unpacked = validatePathList(captured.unpackedFiles);
  const extraResources = validatePathList(captured.extraResourceFiles);
  const captureComplete = capture.asar === "complete" && capture.unpacked === "complete" && capture.extraResources === "complete" && asar.metadataComplete;
  const supportedProfile = captured.profileId === PROFILE_ID;
  const issues = new Set();
  let requiredAsarEntriesPresent = null;
  let mappedUnpackedNativeFiles = null;
  let hasUiJavaScript = null;
  let hasUiStylesheet = null;
  let pythonAsarAbsent = null;
  let pythonResourceMapped = null;
  let sqliteMapped = null;

  if (!supportedProfile) issues.add("profile-unsupported");
  if (!captureComplete) issues.add("profile-incomplete");

  let status = "not-evaluated";
  if (supportedProfile && captureComplete) {
    status = "passed";
    requiredAsarEntriesPresent = 0;
    mappedUnpackedNativeFiles = 0;
    for (const entry of REQUIRED_ASAR_ENTRIES) {
      if (isPackedAsarFile(asar.byPath.get(entry))) requiredAsarEntriesPresent += 1;
      else issues.add("missing-required-entry");
    }

    hasUiJavaScript = asar.entries.some(entry => isPackedAsarFile(entry) && entry.path.startsWith(UI_ASSET_PREFIX) && entry.path.length > UI_ASSET_PREFIX.length && entry.path.endsWith(".js"));
    hasUiStylesheet = asar.entries.some(entry => isPackedAsarFile(entry) && entry.path.startsWith(UI_ASSET_PREFIX) && entry.path.length > UI_ASSET_PREFIX.length && entry.path.endsWith(".css"));
    if (!hasUiJavaScript || !hasUiStylesheet) issues.add("missing-required-entry");
    pythonAsarAbsent = !asar.entries.some(entry => entry.file === true && (entry.path === PYTHON_ASAR_PATH || entry.path.startsWith("apps/desktop/dist/") && entry.path.endsWith(".py")));
    if (!pythonAsarAbsent) issues.add("python-worker-location-mismatch");
    pythonResourceMapped = extraResources.exact.has(PYTHON_RESOURCE_PATH);
    if (!pythonResourceMapped) issues.add("python-worker-location-mismatch");
    if (extraResources.paths.some(path => path !== PYTHON_RESOURCE_PATH)) issues.add("unexpected-entry");
    if (extraResources.paths.some(isNativePath)) issues.add("native-unclassified");

    const asarNativeEntries = asar.entries.filter(entry => isNativePath(entry.path));
    const physicalNativePaths = new Set(unpacked.paths.filter(isNativePath));
    for (const entry of asarNativeEntries) {
      if (entry.file !== true || entry.unpacked !== true ||
          !REQUIRED_UNPACKED_SET.has(entry.path) && !isSqliteAddonPath(entry.path)) issues.add("native-unclassified");
      if (!unpacked.exact.has(entry.path)) issues.add("missing-required-entry");
    }
    for (const entry of asar.entries) {
      if (entry.file === true && entry.unpacked === true && !isNativePath(entry.path)) issues.add("unexpected-entry");
    }
    for (const path of physicalNativePaths) {
      const archiveEntry = asar.byPath.get(path);
      if (!archiveEntry || archiveEntry.file !== true || archiveEntry.unpacked !== true ||
          !REQUIRED_UNPACKED_SET.has(path) && !isSqliteAddonPath(path)) issues.add("native-unclassified");
    }
    if (unpacked.paths.some(path => !isNativePath(path))) issues.add("unexpected-entry");

    for (const path of REQUIRED_UNPACKED_ENTRIES) {
      const archiveEntry = asar.byPath.get(path);
      const mapped = archiveEntry?.file === true && archiveEntry.unpacked === true && unpacked.exact.has(path);
      if (mapped) mappedUnpackedNativeFiles += 1;
      else issues.add("missing-required-entry");
      if (archiveEntry?.file === true && archiveEntry.unpacked !== true) issues.add("native-unclassified");
    }

    const asarSqliteEntries = asarNativeEntries.filter(entry => entry.file === true && isSqliteAddonPath(entry.path));
    const physicalSqlitePaths = unpacked.paths.filter(isSqliteAddonPath);
    sqliteMapped = asarSqliteEntries.length === 1 && physicalSqlitePaths.length === 1 &&
      asarSqliteEntries[0].unpacked === true && asarSqliteEntries[0].path === physicalSqlitePaths[0];
    if (asarSqliteEntries.length === 0 || physicalSqlitePaths.length === 0) issues.add("missing-required-entry");
    if (asarSqliteEntries.length > 1 || physicalSqlitePaths.length > 1 ||
        asarSqliteEntries.length === 1 && physicalSqlitePaths.length === 1 && !sqliteMapped) issues.add("native-unclassified");

    if (issues.size > 0) status = "failed";
  }

  const structureIssues = [...issues].sort(compareStrings);
  if (structureIssues.some(issue => !ISSUE_SET.has(issue))) reject("internal-issue-not-in-v1-enum");
  return freezePlain({
    structure: { status, issues: structureIssues },
    metadata: {
      profileId: supportedProfile ? PROFILE_ID : null,
      captureStatus: captureComplete ? "complete" : "incomplete",
      counts: {
        asarEntries: asar.entries.length,
        unpackedFiles: unpacked.paths.length,
        extraResourceFiles: extraResources.paths.length,
      },
      checks: {
        requiredAsarEntriesPresent,
        requiredAsarEntriesTotal: REQUIRED_ASAR_ENTRIES.length,
        uiJavaScriptAssetPresent: hasUiJavaScript,
        uiStylesheetPresent: hasUiStylesheet,
        pythonAsarAbsent,
        mappedUnpackedNativeFiles,
        sqliteMapped,
        pythonResourceMapped,
      },
    },
  });
}

module.exports = Object.freeze({
  PROFILE_ID,
  STRUCTURE_STATUSES,
  STRUCTURE_ISSUES,
  LIMITS,
  StructureObservationError,
  observeArtifactStructure,
});
