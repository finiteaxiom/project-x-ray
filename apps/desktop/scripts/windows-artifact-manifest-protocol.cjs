"use strict";

const { createHash } = require("node:crypto");
const { types } = require("node:util");

const PROTOCOL_VERSION = 1;
const EXIT_CODES = Object.freeze({ success: 0, failed: 2, incomplete: 3, invalidInput: 64, internalError: 70 });
const LIMITS = Object.freeze({
  maxFiles: 5000,
  maxArrayLength: 5000,
  maxInputNodes: 200000,
  maxInputDepth: 80,
  maxInputCharacters: 32 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxDepth: 64,
  maxPathUtf8Bytes: 512,
  maxComponentCodeUnits: 255,
  maxSignerFieldCharacters: 2048,
  maxEkuCount: 16,
  maxEkuCharacters: 256,
  maxSignerJsonBytes: 2048,
  maxPolicyCertificates: 256,
  maxIssueCount: 64,
  maxReportBytes: 32 * 1024 * 1024,
});

const SCAN_STATUSES = new Set(["complete", "incomplete", "failed"]);
const STRUCTURE_STATUSES = new Set(["passed", "failed", "not-evaluated"]);
const ROOT_IDS = new Set(["portable-exe", "app-staging"]);
const SCAN_ISSUES = new Set([
  "cancelled", "timed-out", "enumeration-incomplete", "file-read-failed", "file-changed",
  "reparse-rejected", "file-count-limit-exceeded", "depth-limit-exceeded", "file-size-limit-exceeded",
  "total-size-limit-exceeded", "child-error", "child-nonzero", "child-not-closed",
  "invalid-helper-reply", "scratch-cleanup-incomplete",
  "declared-complete-inconsistent", "enumerated-count-mismatch", "listed-bytes-mismatch",
]);
const STRUCTURE_ISSUES = new Set([
  "missing-required-entry", "unexpected-entry", "python-worker-location-mismatch", "native-unclassified",
  "portable-root-missing", "portable-not-pe", "app-staging-empty", "profile-unsupported", "profile-incomplete",
  "declared-passed-with-findings",
]);
const KNOWN_RAW_STATUSES = new Set([
  "Valid", "NotSigned", "HashMismatch", "NotTrusted", "UnknownError", "NotSupportedFileFormat", "Incompatible",
]);
const INCOMPLETE_RAW_STATUSES = new Set(["NotSupportedFileFormat", "Incompatible"]);
const KNOWN_FAILURE_RAW_STATUSES = new Set(["HashMismatch", "NotTrusted", "UnknownError"]);

class ProtocolError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProtocolError";
    this.code = code;
  }
}

function reject(code) {
  throw new ProtocolError(code);
}

function hasValidScalars(value) {
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

function snapshotPlainData(input) {
  const seen = new WeakSet();
  const budget = { characters: 0, nodes: 0 };

  function copy(value, depth) {
    budget.nodes += 1;
    if (budget.nodes > LIMITS.maxInputNodes || depth > LIMITS.maxInputDepth) reject("observation-capacity-exceeded");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      budget.characters += value.length;
      if (budget.characters > LIMITS.maxInputCharacters || !hasValidScalars(value)) reject("invalid-or-oversize-string");
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) reject("unsafe-number");
      return value;
    }
    if (typeof value !== "object" || value === null) reject("non-data-value");
    if (types.isProxy(value)) reject("proxy-not-allowed");
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

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > LIMITS.maxArrayLength) reject("invalid-array");
      if (keys.length !== value.length + 1 || keys.some(key => typeof key !== "string")) reject("array-symbol-or-extra-property");
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) reject("array-hole-or-accessor");
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }

    if ((prototype !== Object.prototype && prototype !== null) || keys.length > 64) reject("non-plain-object");
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string" || !hasValidScalars(key)) reject("symbol-or-invalid-key");
      budget.characters += key.length;
      if (budget.characters > LIMITS.maxInputCharacters) reject("observation-capacity-exceeded");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) reject("accessor-or-hidden-property");
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }

  return copy(input, 0);
}

function exactKeys(value, required, code = "unknown-or-missing-field") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value);
  if (actual.length !== required.length || required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) reject(code);
}

function isSafeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function codePointCount(value) {
  return Array.from(value).length;
}

function compareCodePoints(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  const count = Math.min(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return a.length - b.length;
}

function sortUniqueStrings(values, code) {
  const sorted = [...values].sort(compareCodePoints);
  for (let index = 1; index < sorted.length; index += 1) if (sorted[index] === sorted[index - 1]) reject(code);
  return sorted;
}

function validateIssueArray(value, allowed, code) {
  if (!Array.isArray(value) || value.length > LIMITS.maxIssueCount) reject(code);
  for (const issue of value) if (typeof issue !== "string" || !allowed.has(issue)) reject(code);
  return sortUniqueStrings(value, code);
}

function validatePath(path, rootId) {
  if (typeof path !== "string" || path.length === 0 || utf8Bytes(path) > LIMITS.maxPathUtf8Bytes) reject("invalid-relative-path");
  if (path.startsWith("/") || path.endsWith("/") || path.includes("\\") || /[<>:"|?*\u0000-\u001f\u007f-\u009f]/u.test(path)) reject("invalid-relative-path");
  const parts = path.split("/");
  if (parts.length > LIMITS.maxDepth || (rootId === "portable-exe" && parts.length !== 1)) reject("invalid-relative-path-depth");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.length > LIMITS.maxComponentCodeUnits || /[. ]$/u.test(part)) reject("invalid-path-component");
    const normalized = part.normalize("NFKC").toUpperCase();
    const deviceStem = normalized.split(".", 1)[0];
    if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/u.test(deviceStem)) reject("reserved-device-path");
  }
  return parts.map(part => part.normalize("NFKC").toUpperCase()).join("/");
}

function validateHash(value, code = "invalid-sha256") {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/u.test(value)) reject(code);
  return value.toLowerCase();
}

function validateSigner(input) {
  if (input === null) return null;
  exactKeys(input, ["certificateSha256", "subject", "issuer", "validFrom", "validTo", "codeSigningEku"], "invalid-signer-fields");
  const signer = {
    certificateSha256: validateHash(input.certificateSha256, "invalid-signer-certificate-hash"),
    subject: input.subject,
    issuer: input.issuer,
    validFrom: input.validFrom,
    validTo: input.validTo,
    codeSigningEku: input.codeSigningEku,
  };
  for (const field of ["subject", "issuer"]) {
    if (typeof signer[field] !== "string" || codePointCount(signer[field]) > LIMITS.maxSignerFieldCharacters || /[\u0000-\u001f\u007f-\u009f]/u.test(signer[field])) reject("invalid-signer-text");
  }
  const isoMillis = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
  const validity = [];
  for (const field of ["validFrom", "validTo"]) {
    if (typeof signer[field] !== "string" || !isoMillis.test(signer[field])) reject("invalid-signer-time");
    const timestamp = Date.parse(signer[field]);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== signer[field]) reject("invalid-signer-time");
    validity.push(timestamp);
  }
  if (validity[0] > validity[1]) reject("invalid-signer-validity-range");
  if (!Array.isArray(signer.codeSigningEku) || signer.codeSigningEku.length > LIMITS.maxEkuCount) reject("invalid-signer-eku");
  for (const eku of signer.codeSigningEku) {
    if (typeof eku !== "string" || eku.length > LIMITS.maxEkuCharacters || !/^\d+(?:\.\d+)+$/u.test(eku)) reject("invalid-signer-eku");
  }
  signer.codeSigningEku = sortUniqueStrings(signer.codeSigningEku, "duplicate-signer-eku");
  if (utf8Bytes(canonicalStringify(signer)) > LIMITS.maxSignerJsonBytes) reject("signer-size-limit-exceeded");
  return signer;
}

function parseObservation(input) {
  const data = snapshotPlainData(input);
  exactKeys(data, ["schemaVersion", "observationKind", "sourceCommit", "files", "scan", "structure", "authenticode", "publisherPolicy"]);
  if (data.schemaVersion !== PROTOCOL_VERSION) reject("unsupported-protocol-version");
  if (!["synthetic", "caller-supplied"].includes(data.observationKind)) reject("invalid-observation-kind");
  if (data.sourceCommit !== null && (typeof data.sourceCommit !== "string" || !/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u.test(data.sourceCommit))) reject("invalid-operator-commit");

  if (!Array.isArray(data.files) || data.files.length > LIMITS.maxFiles) reject("file-record-limit-exceeded");
  const files = data.files.map(inputFile => {
    exactKeys(inputFile, ["rootId", "path", "bytes", "sha256", "classification", "peStatus", "machine"], "invalid-file-fields");
    if (!ROOT_IDS.has(inputFile.rootId)) reject("invalid-root-id");
    const pathKey = validatePath(inputFile.path, inputFile.rootId);
    if (!isSafeInteger(inputFile.bytes)) reject("invalid-file-size");
    const expectedClassification = inputFile.rootId === "portable-exe" ? "portable-exe" : "app-file";
    if (inputFile.classification !== expectedClassification) reject("file-root-classification-mismatch");
    if (!["pe", "non-pe", "unknown"].includes(inputFile.peStatus)) reject("invalid-pe-status");
    if (inputFile.peStatus === "pe") {
      if (typeof inputFile.machine !== "string" || !/^[0-9A-F]{4}$/u.test(inputFile.machine)) reject("invalid-pe-machine");
    } else if (inputFile.machine !== null) reject("invalid-pe-machine");
    return {
      rootId: inputFile.rootId,
      path: inputFile.path,
      pathKey,
      bytes: inputFile.bytes,
      sha256: validateHash(inputFile.sha256),
      classification: inputFile.classification,
      peStatus: inputFile.peStatus,
      machine: inputFile.machine,
    };
  });
  files.sort((a, b) => compareCodePoints(a.rootId, b.rootId) || compareCodePoints(a.path, b.path));
  const windowsPathKeys = new Set();
  for (const file of files) {
    const key = `${file.rootId}\0${file.pathKey}`;
    if (windowsPathKeys.has(key)) reject("duplicate-windows-path");
    windowsPathKeys.add(key);
  }
  const portableCount = files.filter(file => file.rootId === "portable-exe").length;
  if (portableCount > 1) reject("portable-root-cardinality");

  exactKeys(data.scan, ["status", "enumeratedFileCount", "listedBytes", "issues"], "invalid-scan-fields");
  if (!SCAN_STATUSES.has(data.scan.status) || !isSafeInteger(data.scan.enumeratedFileCount) || !isSafeInteger(data.scan.listedBytes)) reject("invalid-scan-values");
  const scan = {
    status: data.scan.status,
    enumeratedFileCount: data.scan.enumeratedFileCount,
    listedBytes: data.scan.listedBytes,
    issues: validateIssueArray(data.scan.issues, SCAN_ISSUES, "invalid-scan-issues"),
  };

  exactKeys(data.structure, ["status", "issues"], "invalid-structure-fields");
  if (!STRUCTURE_STATUSES.has(data.structure.status)) reject("invalid-structure-status");
  const structure = {
    status: data.structure.status,
    issues: validateIssueArray(data.structure.issues, STRUCTURE_ISSUES, "invalid-structure-issues"),
  };

  if (!Array.isArray(data.authenticode) || data.authenticode.length !== files.length) reject("authenticity-association-count-mismatch");
  const fileById = new Map(files.map(file => [`${file.rootId}\0${file.path}`, file]));
  const authKeys = new Set();
  const authenticode = data.authenticode.map(inputAuth => {
    exactKeys(inputAuth, ["rootId", "path", "fileSha256", "captureStatus", "rawStatus", "signer"], "invalid-authenticode-fields");
    if (!ROOT_IDS.has(inputAuth.rootId)) reject("invalid-authenticode-root");
    validatePath(inputAuth.path, inputAuth.rootId);
    const key = `${inputAuth.rootId}\0${inputAuth.path}`;
    if (authKeys.has(key)) reject("duplicate-authenticode-association");
    authKeys.add(key);
    const file = fileById.get(key);
    if (!file) reject("orphan-authenticode-association");
    const fileSha256 = validateHash(inputAuth.fileSha256, "invalid-authenticode-file-hash");
    if (file.sha256 !== fileSha256) reject("authenticode-file-hash-mismatch");
    if (!["captured", "not-captured", "not-applicable"].includes(inputAuth.captureStatus)) reject("invalid-authenticode-capture-status");
    if (inputAuth.rawStatus !== null && (typeof inputAuth.rawStatus !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(inputAuth.rawStatus))) reject("invalid-raw-authenticode-status");
    const signer = validateSigner(inputAuth.signer);
    if (inputAuth.captureStatus === "captured" && inputAuth.rawStatus === null) reject("captured-status-missing-raw-value");
    if (inputAuth.captureStatus !== "captured" && (inputAuth.rawStatus !== null || signer !== null)) reject("uncaptured-status-has-raw-data");
    if (file.peStatus === "non-pe" && (inputAuth.captureStatus !== "not-applicable" || inputAuth.rawStatus !== null || signer !== null)) reject("non-pe-authenticode-mismatch");
    if (file.peStatus === "pe" && inputAuth.captureStatus === "not-applicable") reject("pe-authenticode-not-applicable");
    if (file.peStatus === "unknown" && inputAuth.captureStatus !== "not-captured") reject("unknown-pe-authenticode-mismatch");
    return {
      rootId: inputAuth.rootId,
      path: inputAuth.path,
      fileSha256,
      captureStatus: inputAuth.captureStatus,
      rawStatus: inputAuth.rawStatus,
      signer,
    };
  });
  authenticode.sort((a, b) => compareCodePoints(a.rootId, b.rootId) || compareCodePoints(a.path, b.path));

  let publisherPolicy = null;
  if (data.publisherPolicy !== null) {
    exactKeys(data.publisherPolicy, ["policyId", "allowedCertificateSha256"], "invalid-publisher-policy-fields");
    const { policyId, allowedCertificateSha256 } = data.publisherPolicy;
    if (typeof policyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(policyId)) reject("invalid-policy-id");
    if (!Array.isArray(allowedCertificateSha256) || allowedCertificateSha256.length > LIMITS.maxPolicyCertificates) reject("policy-size-limit-exceeded");
    const normalized = allowedCertificateSha256.map(hash => validateHash(hash, "invalid-policy-certificate-hash"));
    publisherPolicy = { policyId, allowedCertificateSha256: sortUniqueStrings(normalized, "duplicate-policy-certificate") };
  }

  const parsed = {
    schemaVersion: PROTOCOL_VERSION,
    observationKind: data.observationKind,
    sourceCommit: data.sourceCommit === null ? null : data.sourceCommit.toLowerCase(),
    files: files.map(({ pathKey, ...file }) => file),
    scan,
    structure,
    authenticode,
    publisherPolicy,
  };
  return deepFreeze(parsed);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) reject("non-canonical-number");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  reject("non-canonical-data");
}

function signatureAssessment(rawStatus, captureStatus) {
  if (captureStatus === "not-applicable") return "not-applicable";
  if (captureStatus !== "captured" || rawStatus === null) return "incomplete";
  if (rawStatus === "Valid") return "valid";
  if (rawStatus === "NotSigned") return "unsigned";
  if (KNOWN_FAILURE_RAW_STATUSES.has(rawStatus)) return "failed";
  if (INCOMPLETE_RAW_STATUSES.has(rawStatus) || !KNOWN_RAW_STATUSES.has(rawStatus)) return "incomplete";
  return "incomplete";
}

function buildManifest(observation) {
  const scanIssues = new Set(observation.scan.issues);
  const listedBytes = observation.files.reduce((total, file) => {
    const next = total + file.bytes;
    if (!Number.isSafeInteger(next)) reject("listed-byte-sum-unsafe");
    return next;
  }, 0);
  let scanStatus = observation.scan.status;
  const scanMismatch = observation.scan.enumeratedFileCount !== observation.files.length || observation.scan.listedBytes !== listedBytes;
  const scanOverLimit = observation.scan.enumeratedFileCount > LIMITS.maxFiles || observation.scan.listedBytes > LIMITS.maxTotalBytes || observation.files.some(file => file.bytes > LIMITS.maxFileBytes) || listedBytes > LIMITS.maxTotalBytes;
  if (observation.scan.status === "complete" && (scanMismatch || observation.scan.issues.length > 0 || scanOverLimit)) {
    scanStatus = "incomplete";
    scanIssues.add("declared-complete-inconsistent");
  }
  if (observation.scan.enumeratedFileCount > LIMITS.maxFiles || observation.files.length > LIMITS.maxFiles) scanIssues.add("file-count-limit-exceeded");
  if (observation.files.some(file => file.path.split("/").length > LIMITS.maxDepth)) scanIssues.add("depth-limit-exceeded");
  if (observation.files.some(file => file.bytes > LIMITS.maxFileBytes)) scanIssues.add("file-size-limit-exceeded");
  if (listedBytes > LIMITS.maxTotalBytes || observation.scan.listedBytes > LIMITS.maxTotalBytes) scanIssues.add("total-size-limit-exceeded");
  if (observation.scan.enumeratedFileCount !== observation.files.length) scanIssues.add("enumerated-count-mismatch");
  if (observation.scan.listedBytes !== listedBytes) scanIssues.add("listed-bytes-mismatch");
  if (observation.scan.status === "incomplete") scanStatus = "incomplete";
  if (observation.scan.status === "failed") scanStatus = "failed";

  const structureIssues = new Set(observation.structure.issues);
  const portableFiles = observation.files.filter(file => file.rootId === "portable-exe");
  if (portableFiles.length === 0) structureIssues.add("portable-root-missing");
  else if (portableFiles[0].peStatus !== "pe") structureIssues.add("portable-not-pe");
  if (!observation.files.some(file => file.rootId === "app-staging")) structureIssues.add("app-staging-empty");
  let structureStatus = observation.structure.status;
  if (structureStatus === "passed" && (structureIssues.size > 0 || observation.structure.issues.length > 0)) {
    structureStatus = "failed";
    structureIssues.add("declared-passed-with-findings");
  } else if (structureIssues.size > 0) structureStatus = "failed";

  const authByFile = new Map(observation.authenticode.map(row => [`${row.rootId}\0${row.path}`, row]));
  const signatureIssues = new Set();
  let applicablePeCount = 0;
  let capturedPeCount = 0;
  let unknownPeKindCount = 0;
  let signatureCoverageIncomplete = false;
  const publisherPolicyDigest = observation.publisherPolicy === null ? null : createHash("sha256").update(canonicalStringify(observation.publisherPolicy), "utf8").digest("hex");
  let applicableValidPeCount = 0;
  let evaluatedTrustCount = 0;
  const trustIssues = new Set();
  let trustCoverageIncomplete = false;

  const files = observation.files.map(file => {
    const auth = authByFile.get(`${file.rootId}\0${file.path}`);
    if (!auth) reject("missing-authenticode-association");
    let assessment;
    if (file.peStatus === "non-pe") {
      assessment = "not-applicable";
    } else if (file.peStatus === "unknown") {
      unknownPeKindCount += 1;
      signatureCoverageIncomplete = true;
      signatureIssues.add("pe-kind-unknown");
      assessment = "not-evaluated";
    } else {
      applicablePeCount += 1;
      if (auth.captureStatus === "captured" && auth.rawStatus !== null) capturedPeCount += 1;
      assessment = signatureAssessment(auth.rawStatus, auth.captureStatus);
      if (assessment === "incomplete") {
        signatureCoverageIncomplete = true;
        if (auth.captureStatus === "not-captured") signatureIssues.add("capture-not-complete");
        else if (!KNOWN_RAW_STATUSES.has(auth.rawStatus)) signatureIssues.add("raw-status-unknown");
        else signatureIssues.add("raw-status-unsupported");
      }
      if (auth.rawStatus === "NotSigned" && auth.signer !== null) {
        assessment = "incomplete";
        signatureCoverageIncomplete = true;
        signatureIssues.add("signer-on-not-signed");
      }
      if (auth.rawStatus === "Valid" && auth.signer === null) {
        assessment = "incomplete";
        signatureCoverageIncomplete = true;
        signatureIssues.add("valid-signer-missing");
      }
      if (observation.publisherPolicy !== null && assessment === "incomplete") {
        trustCoverageIncomplete = true;
        trustIssues.add("signature-status-not-evaluated");
      }
    }

    let trustStatus = "not-evaluated";
    if (observation.publisherPolicy !== null && file.peStatus === "pe" && auth.rawStatus === "Valid") {
      applicableValidPeCount += 1;
      if (auth.signer === null) {
        trustCoverageIncomplete = true;
        trustIssues.add("valid-signer-missing");
      } else {
        evaluatedTrustCount += 1;
        trustStatus = observation.publisherPolicy.allowedCertificateSha256.includes(auth.signer.certificateSha256) ? "matched" : "mismatch";
      }
    }
    if (observation.publisherPolicy !== null && file.peStatus === "unknown") {
      trustCoverageIncomplete = true;
      trustIssues.add("pe-kind-unknown");
    }
    return {
      rootId: file.rootId,
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
      classification: file.classification,
      peStatus: file.peStatus,
      machine: file.machine,
      authenticode: {
        captureStatus: auth.captureStatus,
        rawStatus: auth.rawStatus,
        assessment,
        signer: auth.signer,
      },
      publisherTrust: {
        status: trustStatus,
        policyId: observation.publisherPolicy?.policyId ?? null,
      },
    };
  });

  const signatureCoverageStatus = applicablePeCount + unknownPeKindCount === 0
    ? "not-applicable"
    : signatureCoverageIncomplete ? "incomplete" : "complete";
  if (observation.publisherPolicy !== null && applicableValidPeCount > evaluatedTrustCount) trustCoverageIncomplete = true;
  const finalPolicyStatus = observation.publisherPolicy === null
    ? "not-evaluated"
    : trustCoverageIncomplete ? "incomplete"
      : applicableValidPeCount === 0 ? "not-applicable" : "complete";

  const manifest = {
    schemaVersion: PROTOCOL_VERSION,
    observationKind: observation.observationKind,
    evidenceBoundary: "caller-observation-unverified",
    sourceDeclaration: { kind: "operator-declared", commit: observation.sourceCommit },
    scan: {
      observedStatus: observation.scan.status,
      status: scanStatus,
      enumeratedFileCount: observation.scan.enumeratedFileCount,
      listedBytes: observation.scan.listedBytes,
      issues: sortUniqueStrings([...scanIssues], "duplicate-derived-scan-issue"),
    },
    structure: {
      observedStatus: observation.structure.status,
      status: structureStatus,
      issues: sortUniqueStrings([...structureIssues], "duplicate-derived-structure-issue"),
    },
    signatureCoverage: {
      status: signatureCoverageStatus,
      applicablePeCount,
      capturedPeCount,
      unknownPeKindCount,
      issues: sortUniqueStrings([...signatureIssues], "duplicate-derived-signature-issue"),
    },
    publisherPolicy: observation.publisherPolicy === null ? null : {
      policyId: observation.publisherPolicy.policyId,
      policySha256: publisherPolicyDigest,
      allowedCertificateSha256: observation.publisherPolicy.allowedCertificateSha256,
    },
    publisherPolicyEvaluation: {
      status: finalPolicyStatus,
      policyId: observation.publisherPolicy?.policyId ?? null,
      applicableValidPeCount,
      evaluatedCount: evaluatedTrustCount,
      issues: sortUniqueStrings([...trustIssues], "duplicate-derived-policy-issue"),
    },
    files,
    releaseDecision: "not-evaluated",
    buildAssociation: "not-established",
    runtimeWiring: "not-assessed",
    exitCode: 0,
  };
  manifest.exitCode = calculateExitCode(manifest);
  const outputBytes = utf8Bytes(canonicalStringify(manifest));
  if (outputBytes > LIMITS.maxReportBytes) reject("report-size-limit-exceeded");
  return deepFreeze(manifest);
}

function calculateExitCode(manifest) {
  if (manifest.scan.status !== "complete" || manifest.structure.status === "not-evaluated") return EXIT_CODES.incomplete;
  if (manifest.signatureCoverage.status === "incomplete" || manifest.publisherPolicyEvaluation.status === "incomplete") return EXIT_CODES.incomplete;
  if (manifest.structure.status === "failed") return EXIT_CODES.failed;
  if (manifest.files.some(file => file.authenticode.assessment === "failed" || file.authenticode.assessment === "unsigned")) return EXIT_CODES.failed;
  if (manifest.files.some(file => file.publisherTrust.status === "mismatch")) return EXIT_CODES.failed;
  if (manifest.structure.status !== "passed") return EXIT_CODES.incomplete;
  return EXIT_CODES.success;
}

function deriveManifest(input) {
  return buildManifest(parseObservation(input));
}

function deriveExitCode(input) {
  try {
    return deriveManifest(input).exitCode;
  } catch (error) {
    return error instanceof ProtocolError ? EXIT_CODES.invalidInput : EXIT_CODES.internalError;
  }
}

function manifestToObservation(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    observationKind: manifest.observationKind,
    sourceCommit: manifest.sourceDeclaration.commit,
    files: manifest.files.map(file => ({
      rootId: file.rootId,
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
      classification: file.classification,
      peStatus: file.peStatus,
      machine: file.machine,
    })),
    scan: {
      status: manifest.scan.observedStatus,
      enumeratedFileCount: manifest.scan.enumeratedFileCount,
      listedBytes: manifest.scan.listedBytes,
      issues: manifest.scan.issues,
    },
    structure: { status: manifest.structure.observedStatus, issues: manifest.structure.issues },
    authenticode: manifest.files.map(file => ({
      rootId: file.rootId,
      path: file.path,
      fileSha256: file.sha256,
      captureStatus: file.authenticode.captureStatus,
      rawStatus: file.authenticode.rawStatus,
      signer: file.authenticode.signer,
    })),
    publisherPolicy: manifest.publisherPolicy === null ? null : {
      policyId: manifest.publisherPolicy.policyId,
      allowedCertificateSha256: manifest.publisherPolicy.allowedCertificateSha256,
    },
  };
}

function validateManifest(manifest) {
  exactKeys(manifest, [
    "schemaVersion", "observationKind", "evidenceBoundary", "sourceDeclaration", "scan", "structure", "signatureCoverage",
    "publisherPolicy", "publisherPolicyEvaluation", "files", "releaseDecision", "buildAssociation", "runtimeWiring", "exitCode",
  ], "invalid-manifest-fields");
  if (manifest.schemaVersion !== PROTOCOL_VERSION || !["synthetic", "caller-supplied"].includes(manifest.observationKind) || manifest.evidenceBoundary !== "caller-observation-unverified") reject("invalid-manifest-version-or-boundary");
  exactKeys(manifest.sourceDeclaration, ["kind", "commit"], "invalid-source-declaration");
  if (manifest.sourceDeclaration.kind !== "operator-declared") reject("invalid-source-declaration");
  if (manifest.releaseDecision !== "not-evaluated" || manifest.buildAssociation !== "not-established" || manifest.runtimeWiring !== "not-assessed") reject("invalid-fixed-manifest-state");
  exactKeys(manifest.scan, ["observedStatus", "status", "enumeratedFileCount", "listedBytes", "issues"], "invalid-manifest-scan");
  exactKeys(manifest.structure, ["observedStatus", "status", "issues"], "invalid-manifest-structure");
  exactKeys(manifest.signatureCoverage, ["status", "applicablePeCount", "capturedPeCount", "unknownPeKindCount", "issues"], "invalid-manifest-signature-coverage");
  exactKeys(manifest.publisherPolicyEvaluation, ["status", "policyId", "applicableValidPeCount", "evaluatedCount", "issues"], "invalid-manifest-policy-evaluation");
  if (!Array.isArray(manifest.files) || manifest.files.length > LIMITS.maxFiles) reject("invalid-manifest-files");
  for (const file of manifest.files) {
    exactKeys(file, ["rootId", "path", "bytes", "sha256", "classification", "peStatus", "machine", "authenticode", "publisherTrust"], "invalid-manifest-file");
    exactKeys(file.authenticode, ["captureStatus", "rawStatus", "assessment", "signer"], "invalid-manifest-authenticode");
    exactKeys(file.publisherTrust, ["status", "policyId"], "invalid-manifest-publisher-trust");
  }
  if (manifest.publisherPolicy !== null) exactKeys(manifest.publisherPolicy, ["policyId", "policySha256", "allowedCertificateSha256"], "invalid-manifest-policy");
  const rebuilt = buildManifest(parseObservation(manifestToObservation(manifest)));
  if (canonicalStringify(rebuilt) !== canonicalStringify(manifest)) reject("manifest-derived-state-mismatch");
  return rebuilt;
}

function serializeManifest(input) {
  const copied = snapshotPlainData(input);
  const validated = validateManifest(copied);
  const json = canonicalStringify(validated);
  if (utf8Bytes(json) > LIMITS.maxReportBytes) reject("report-size-limit-exceeded");
  return json;
}

function parseManifest(canonicalJson) {
  if (typeof canonicalJson !== "string" || utf8Bytes(canonicalJson) > LIMITS.maxReportBytes) reject("invalid-or-oversize-manifest-json");
  let parsed;
  try {
    parsed = JSON.parse(canonicalJson);
  } catch {
    reject("invalid-manifest-json");
  }
  const copied = snapshotPlainData(parsed);
  const rebuilt = validateManifest(copied);
  if (canonicalStringify(copied) !== canonicalJson) reject("manifest-json-not-canonical");
  return rebuilt;
}

module.exports = Object.freeze({
  PROTOCOL_VERSION,
  LIMITS,
  EXIT_CODES,
  ProtocolError,
  parseObservation,
  deriveManifest,
  deriveExitCode,
  serializeManifest,
  parseManifest,
});
