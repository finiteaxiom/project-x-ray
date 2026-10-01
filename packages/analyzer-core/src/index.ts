import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import { createIgnorePolicy, isCustomIgnored } from "./ignore-policy.js";
import type { IgnorePolicy } from "@project-xray/contracts";
export { createIgnorePolicy, matchesIgnoreRule, configurationFingerprint } from "./ignore-policy.js";
import { diagnosticForError, type Evidence, type GraphEdge, type GraphNode, type SafeDiagnosticCode, type SafeDiagnosticDetailCode } from "@project-xray/contracts";
import { createSecureReadScope, readSecureProjectFile } from "./secure-read.js";
export { createSecureReadScope, isProjectPathSecurityError, ProjectPathSecurityError, readProjectFileSecure, readSecureProjectFile, readSecureProjectFileBuffer, type SecureReadScope, type SecureReadTestHooks } from "./secure-read.js";

export interface AnalyzerContext {
  rootPath: string;
  repositoryId: string;
  snapshotId: string;
  abortSignal?: AbortSignal;
}

export interface FileAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: Evidence[];
  unresolvedCalls: string[];
  failures?: Array<{ filePath: string; code: SafeDiagnosticCode; reason: string; detailCode?: SafeDiagnosticDetailCode }>;
}

export interface LanguageAnalyzer {
  readonly id: string;
  readonly version: string;
  supports(filePath: string): boolean;
  analyze(filePath: string, source: string, context: AnalyzerContext): Promise<FileAnalysis>;
}

export const DEFAULT_IGNORE = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/*.min.js",
  "**/*.map",
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
  "**/*.p12",
];

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"]);
export const ANALYSIS_CONFIG_NAMES = ["package.json", "pyproject.toml", "requirements.txt", "tsconfig.json", "jsconfig.json"] as const;
const MANIFEST_NAMES = new Set<string>(ANALYSIS_CONFIG_NAMES);
const HARD_DIRECTORY_IGNORE = ["**/.git/**", "**/node_modules/**", "**/.venv/**", "**/venv/**", "**/__pycache__/**", "**/dist/**", "**/build/**", "**/out/**", "**/coverage/**", "**/.next/**", "**/.turbo/**"];
const SECRET_FILE = /(^|\/)(\.env[^/]*|[^/]+\.(pem|key|pfx|p12))$/i;
export type ProjectPathClass = "source" | "config" | "secret" | "ignored" | "unsupported";
export function classifyProjectPath(projectPath: string, policy?: IgnorePolicy): ProjectPathClass {
  const normalized = projectPath.replaceAll("\\", "/");
  if (SECRET_FILE.test(normalized)) return "secret";
  if (policy && isCustomIgnored(normalized, policy)) return "ignored";
  if (normalized.endsWith(".min.js") || normalized.endsWith(".map") || /(^|\/)(\.git|node_modules|\.venv|venv|__pycache__|dist|build|out|coverage|\.next|\.turbo)(\/|$)/i.test(normalized)) return "ignored";
  const fileName = normalized.split("/").at(-1) ?? ""; if (MANIFEST_NAMES.has(fileName)) return "config";
  return SOURCE_EXTENSIONS.has(extname(normalized).toLowerCase()) ? "source" : "unsupported";
}

export interface ProjectDiscovery {
  files: string[];
  unsupportedFiles: number;
  ignoredFiles: number;
  unsupportedPaths: string[];
  ignoredPaths: string[];
  secretPaths: string[];
  oversizedPaths: string[];
  ignoredByRule: string[];
  failures: Array<{ filePath: string; code: SafeDiagnosticCode; reason: string; detailCode?: SafeDiagnosticDetailCode }>;
}

export interface ProjectDiscoveryTestHooks { beforeEntry?: (absolutePath: string) => void | Promise<void> }

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("索引任务已取消", "AbortError");
}

export async function discoverProject(rootPath: string, signal?: AbortSignal, testHooks?: ProjectDiscoveryTestHooks, policy: IgnorePolicy = createIgnorePolicy()): Promise<ProjectDiscovery> {
  const resolvedRoot = await realpath(rootPath);
  throwIfAborted(signal);
  const entries = await fg("**/*", { cwd: resolvedRoot, absolute: true, onlyFiles: true, dot: true, followSymbolicLinks: false, ignore: HARD_DIRECTORY_IGNORE, suppressErrors: true });
  const files: string[] = [];
  const failures: ProjectDiscovery["failures"] = [];
  let unsupportedFiles = 0;
  let ignoredFiles = 0;
  const unsupportedPaths: string[] = [];
  const ignoredPaths: string[] = [];
  const secretPaths: string[] = [];
  const oversizedPaths: string[] = [];
  for (const entry of entries) {
    throwIfAborted(signal);
    const projectPath = normalizeProjectPath(resolvedRoot, entry);
    const classification = classifyProjectPath(projectPath, policy);
    if (classification === "secret") { ignoredFiles += 1; secretPaths.push(projectPath); continue; }
    if (classification === "ignored") { ignoredFiles += 1; ignoredPaths.push(projectPath); continue; }
    if (classification === "unsupported") { unsupportedFiles += 1; unsupportedPaths.push(projectPath); continue; }
    try {
      await testHooks?.beforeEntry?.(entry);
      const realEntry = await realpath(entry);
      assertContainedPath(resolvedRoot, realEntry);
      const info = await stat(realEntry);
      if (info.size > 2_000_000) { ignoredFiles += 1; oversizedPaths.push(projectPath); continue; }
      files.push(realEntry);
    } catch (error) {
      failures.push({ filePath: projectPath, ...diagnosticForError(error, "FILE_DISCOVERY_FAILED") });
    }
  }
  return { files: files.sort((a, b) => a.localeCompare(b)), unsupportedFiles, ignoredFiles, unsupportedPaths: unsupportedPaths.sort(), ignoredPaths: ignoredPaths.sort(), secretPaths: secretPaths.sort(), oversizedPaths: oversizedPaths.sort(), ignoredByRule: [...DEFAULT_IGNORE, ...policy.rules], failures };
}

export async function discoverProjectFiles(rootPath: string): Promise<string[]> {
  return (await discoverProject(rootPath)).files;
}

export function assertContainedPath(rootPath: string, candidatePath: string): void {
  const normalizedRoot = resolve(rootPath);
  const normalizedCandidate = resolve(candidatePath);
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(prefix)) {
    throw new Error("请求路径超出项目根目录");
  }
}

export async function readProjectFile(rootPath: string, filePath: string, options: { signal?: AbortSignal; testHooks?: import("./secure-read.js").SecureReadTestHooks } = {}): Promise<string> {
  const scope = await createSecureReadScope(rootPath);
  try {
    const candidate = resolve(scope.rootPath, filePath);
    assertContainedPath(scope.rootPath, candidate);
    return await readSecureProjectFile(scope, candidate, options);
  } finally { scope.close(); }
}

export function normalizeProjectPath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

export function languageFromPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if ([".ts", ".tsx"].includes(extension)) return "TypeScript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "JavaScript";
  if (extension === ".py") return "Python";
  return "Manifest";
}

export function isAnalysisConfig(filePath: string): boolean { return MANIFEST_NAMES.has(filePath.split(/[\\/]/).at(-1) ?? ""); }

export function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

export function sourceFingerprint(entries: Array<{ path: string; content: string }>): string {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(entry.path).update("\u0000").update(entry.content).update("\u0000");
  }
  return hash.digest("hex");
}

export function contentFingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function moduleNameForPath(projectPath: string): string {
  const directory = dirname(projectPath).split(sep).join("/");
  if (directory === ".") return "根目录";
  return directory.split("/").slice(0, 2).join("/");
}
