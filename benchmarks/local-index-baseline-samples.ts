import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/contracts/src/snapshot-content.ts";

export type BaselineSampleKind = "small" | "medium";
export type BaselineSampleLanguage = "TypeScript" | "Python";

export interface BaselineSampleFile {
  path: string;
  language: BaselineSampleLanguage;
  bytes: number;
  sha256: string;
}

export interface BaselineSampleDefinition {
  kind: BaselineSampleKind;
  id: string;
  generatorVersion?: number;
  files: readonly BaselineSampleFile[];
  manifestSha256: string;
  totalBytes: number;
}

export const SMALL_SAMPLE_ID = "e2e-project-small-v1";
export const MEDIUM_SAMPLE_ID = "e2e-project-medium-v1";
export const MEDIUM_GENERATOR_VERSION = 1;
export const MEDIUM_MAX_FILE_BYTES = 4_096;
export const MEDIUM_MAX_TOTAL_BYTES = 512 * 1_024;
export const MEDIUM_TYPE_SCRIPT_FILE_COUNT = 96;
export const MEDIUM_PYTHON_FILE_COUNT = 32;
export const MEDIUM_FILE_COUNT = MEDIUM_TYPE_SCRIPT_FILE_COUNT + MEDIUM_PYTHON_FILE_COUNT;
export const MEDIUM_SAMPLE_MANIFEST_SHA256 = "0c250b857248c59e5aaa9d40341857f10770049d128e70010f10a9a3dc2ed9aa";

const SMALL_FILES: readonly BaselineSampleFile[] = Object.freeze([
  Object.freeze({ path: "src/auth.ts", language: "TypeScript", bytes: 146, sha256: "19256989f7e619fa37dee1d2400619a922d8c450867e221bb05a0c5db27f1b5d" }),
  Object.freeze({ path: "src/validation.ts", language: "TypeScript", bytes: 80, sha256: "3e7980d05fe47137aaac04b76832f0f30ead18f1c7ce101aded9da6623db3722" }),
  Object.freeze({ path: "worker.py", language: "Python", bytes: 81, sha256: "c4419c8bd43fbc7a768998a9f8ee94d092a91acae1ea1bb89fdd811bc184a8a6" }),
]);

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tsFunctionName(index: number): string {
  return `step${String(index).padStart(3, "0")}`;
}

function pythonFunctionName(index: number): string {
  return `step_${String(index).padStart(3, "0")}`;
}

function typeScriptContent(index: number): string {
  const name = tsFunctionName(index);
  if (index === MEDIUM_TYPE_SCRIPT_FILE_COUNT - 1) {
    return `export function ${name}(value: number): number {\n  return value + 1;\n}\n`;
  }
  const next = tsFunctionName(index + 1);
  const nextPath = `./step-${String(index + 1).padStart(3, "0")}`;
  return `import { ${next} } from "${nextPath}";\n\nexport function ${name}(value: number): number {\n  return ${next}(value);\n}\n`;
}

function pythonContent(index: number): string {
  const name = pythonFunctionName(index);
  if (index === MEDIUM_PYTHON_FILE_COUNT - 1) {
    return `def ${name}(value):\n    return value + 1\n`;
  }
  const next = pythonFunctionName(index + 1);
  return `from .${next} import ${next}\n\ndef ${name}(value):\n    return ${next}(value)\n`;
}

const MEDIUM_CONTENT = new Map<string, string>();
const mediumFiles: BaselineSampleFile[] = [];
for (let index = 0; index < MEDIUM_TYPE_SCRIPT_FILE_COUNT; index += 1) {
  const path = `src/ts/step-${String(index).padStart(3, "0")}.ts`;
  const content = typeScriptContent(index);
  MEDIUM_CONTENT.set(path, content);
  const bytes = Buffer.byteLength(content, "utf8");
  mediumFiles.push({ path, language: "TypeScript", bytes, sha256: sha256(content) });
}
for (let index = 0; index < MEDIUM_PYTHON_FILE_COUNT; index += 1) {
  const path = `src/python/step_${String(index).padStart(3, "0")}.py`;
  const content = pythonContent(index);
  MEDIUM_CONTENT.set(path, content);
  const bytes = Buffer.byteLength(content, "utf8");
  mediumFiles.push({ path, language: "Python", bytes, sha256: sha256(content) });
}
mediumFiles.sort((left, right) => comparePath(left.path, right.path));

function manifestDigest(sampleId: string, files: readonly { path: string; language: string; bytes: number; sha256: string }[]): string {
  return sha256(canonicalJson({ sampleId, files }));
}

const mediumTotalBytes = mediumFiles.reduce((total, file) => total + file.bytes, 0);
if (mediumFiles.length !== MEDIUM_FILE_COUNT
  || mediumFiles.filter((file) => file.language === "TypeScript").length !== MEDIUM_TYPE_SCRIPT_FILE_COUNT
  || mediumFiles.filter((file) => file.language === "Python").length !== MEDIUM_PYTHON_FILE_COUNT
  || mediumFiles.some((file) => file.bytes > MEDIUM_MAX_FILE_BYTES)
  || mediumTotalBytes > MEDIUM_MAX_TOTAL_BYTES) {
  throw new Error("SAMPLE_GENERATOR_LIMIT_INVALID");
}

const smallSample: BaselineSampleDefinition = Object.freeze({
  kind: "small",
  id: SMALL_SAMPLE_ID,
  files: SMALL_FILES,
  manifestSha256: manifestDigest(SMALL_SAMPLE_ID, SMALL_FILES),
  totalBytes: SMALL_FILES.reduce((total, file) => total + file.bytes, 0),
});

const mediumSample: BaselineSampleDefinition = Object.freeze({
  kind: "medium",
  id: MEDIUM_SAMPLE_ID,
  generatorVersion: MEDIUM_GENERATOR_VERSION,
  files: Object.freeze(mediumFiles.map((file) => Object.freeze(file))),
  manifestSha256: manifestDigest(MEDIUM_SAMPLE_ID, mediumFiles),
  totalBytes: mediumTotalBytes,
});
if (mediumSample.manifestSha256 !== MEDIUM_SAMPLE_MANIFEST_SHA256) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");

export function getBaselineSample(value: BaselineSampleKind | string): BaselineSampleDefinition | undefined {
  if (value === "small" || value === SMALL_SAMPLE_ID) return smallSample;
  if (value === "medium" || value === MEDIUM_SAMPLE_ID) return mediumSample;
  return undefined;
}

export function getGeneratedSampleContent(sampleId: string, path: string): string | undefined {
  if (sampleId !== MEDIUM_SAMPLE_ID) return undefined;
  return MEDIUM_CONTENT.get(path);
}

export function getSampleLanguageCounts(sample: BaselineSampleDefinition): Record<BaselineSampleLanguage, number> {
  return {
    TypeScript: sample.files.filter((file) => file.language === "TypeScript").length,
    Python: sample.files.filter((file) => file.language === "Python").length,
  };
}

export function computeSampleManifestSha256(sampleId: string, files: readonly { path: string; language: string; bytes: number; sha256: string }[]): string {
  return manifestDigest(sampleId, [...files].sort((left, right) => comparePath(left.path, right.path)));
}
