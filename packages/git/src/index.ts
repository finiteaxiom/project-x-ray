import { execFile } from "node:child_process";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ComparisonMode } from "@project-xray/contracts";
import { classifyProjectPath, contentFingerprint, discoverProject, languageFromPath, normalizeProjectPath, sourceFingerprint, stableId, throwIfAborted } from "@project-xray/analyzer-core";
import { attachPatchSections, parseNameStatus, type CapturedChange } from "./comparison-diff.js";

export { attachPatchSections, parseNameStatus, parsePatch, splitPatchSections, type CapturedChange, type CapturedHunk } from "./comparison-diff.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

function gitBuffer(args: string[], cwd: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    throwIfAborted(signal);
    const child = execFile("git", ["--no-pager", "-c", "diff.external=", "-c", "core.quotepath=false", ...args], { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 50 * 1024 * 1024, encoding: "buffer", env: { ...process.env, GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" } }, (error, stdout) => error ? reject(new Error(sanitizeGitError(error.message))) : resolvePromise(Buffer.from(stdout)));
    const abort = (): void => { child.kill(); }; signal?.addEventListener("abort", abort, { once: true }); child.once("exit", () => signal?.removeEventListener("abort", abort));
  });
}

function gitBufferWithInput(args: string[], cwd: string, input: string, signal?: AbortSignal, maxBuffer = 140 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    throwIfAborted(signal);
    const child = execFile("git", ["--no-pager", "-c", "diff.external=", "-c", "core.quotepath=false", ...args], { cwd, windowsHide: true, timeout: 120_000, maxBuffer, encoding: "buffer", env: { ...process.env, GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" } }, (error, stdout) => error ? reject(new Error(sanitizeGitError(error.message))) : resolvePromise(Buffer.from(stdout)));
    const abort = (): void => { child.kill(); };
    signal?.addEventListener("abort", abort, { once: true }); child.once("exit", () => signal?.removeEventListener("abort", abort));
    child.stdin?.end(input);
  });
}

async function gitText(args: string[], cwd: string, signal?: AbortSignal): Promise<string> { return (await gitBuffer(args, cwd, signal)).toString("utf8"); }
function sanitizeGitError(message: string): string { return message.replace(/[\r\n]+/g, " ").replace(/(?:[A-Za-z]:)?[^ ]*[\\/][^ ]*/g, "<path>").slice(0, 400); }

export interface CapturedSource { projectPath: string; content: string; contentHash: string; language: string }
export interface CapturedSide {
  kind: "empty-tree" | "commit" | "index" | "working-tree"; label: string; revision?: string; parentNumber?: number;
  contentFingerprint: string; manifestFingerprint: string; stateFingerprint: string; capturedAt: string; sources: CapturedSource[];
  unsupported: string[]; ignored: string[]; secrets: string[]; binary: string[]; oversized: string[]; submodules: string[];
}
export interface CapturedComparison { rootPath: string; head: string; mode: ComparisonMode; left: CapturedSide; right: CapturedSide; changes: CapturedChange[]; captureFingerprint: string; limitations: string[] }
export interface CaptureComparisonHooks { afterSidesCaptured?: (attempt: number) => void | Promise<void> }

export async function captureComparison(rootPath: string, mode: ComparisonMode, parentNumber = 1, signal?: AbortSignal, hooks: CaptureComparisonHooks = {}): Promise<CapturedComparison> {
  const safeRoot = await realpath(rootPath); const top = (await gitText(["rev-parse", "--show-toplevel"], safeRoot, signal)).trim();
  if ((await realpath(top)).toLocaleLowerCase() !== safeRoot.toLocaleLowerCase()) throw new Error("比较只允许从已导入 Git 仓库根目录执行");
  const objectFormat = (await gitText(["rev-parse", "--show-object-format"], safeRoot, signal)).trim(); if (objectFormat !== "sha1" && objectFormat !== "sha256") throw new Error(`不支持的 Git 对象格式：${objectFormat}`);
  let verifiedHead: string; try { verifiedHead = (await gitText(["rev-parse", "--verify", "HEAD"], safeRoot, signal)).trim(); } catch { throw new Error("Git 仓库尚无任何提交；请先创建初始提交后再比较"); }
  const conflicts = await gitText(["ls-files", "--unmerged", "-z"], safeRoot, signal); if (conflicts.length && mode !== "last-commit") throw new Error("index 存在未合并条目；必须先解决冲突，不能把多阶段条目当作普通文件比较");
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal); const before = await comparisonStateFingerprint(safeRoot, mode, signal);
    try {
      const head = (await gitText(["rev-parse", "HEAD"], safeRoot, signal)).trim(); if (head !== verifiedHead && mode === "last-commit") { lastError = "比较生成期间 HEAD 发生变化"; verifiedHead = head; continue; }
      const { left, right, diffArgs } = await captureSides(safeRoot, mode, head, parentNumber, objectFormat, signal); await hooks.afterSidesCaptured?.(attempt);
      const changes = await captureChanges(safeRoot, mode, diffArgs, left, right, signal);
      const after = await comparisonStateFingerprint(safeRoot, mode, signal);
      if (before !== after) { lastError = "比较生成期间 HEAD、index 或工作区发生变化"; continue; }
      return { rootPath: safeRoot, head, mode, left, right, changes, captureFingerprint: after, limitations: ["只分析受支持且未命中秘密/忽略规则、大小不超过 2 MB 的文本源码与配置", "工作区身份包含实际纳入分析的路径与内容哈希；秘密、忽略、不支持和超限内容不参与内容指纹", "重命名相似度来自 Git，仅表示文本相似，不证明语义等价", `Git 对象格式：${objectFormat}`, "普通文件系统无法提供跨工作区文件的绝对原子读取；捕获前后会校验并最多重试一次"] };
    } catch (error) { if (signal?.aborted) throw new DOMException("比较任务已取消", "AbortError"); throw error; }
  }
  throw new Error(`${lastError}；有界重试后仍不稳定，未发布报告`);
}

export async function comparisonStateFingerprint(rootPath: string, mode: ComparisonMode, signal?: AbortSignal): Promise<string> {
  const head = await gitBuffer(["rev-parse", "HEAD"], rootPath, signal); if (mode === "last-commit") return contentFingerprint(head.toString("base64"));
  const index = await gitBuffer(["ls-files", "--stage", "-z"], rootPath, signal); if (mode === "staged") return contentFingerprint(Buffer.concat([head, index]).toString("base64"));
  const working = await captureWorking(rootPath, signal, head, index); return working.stateFingerprint;
}

async function captureSides(root: string, mode: ComparisonMode, head: string, parentNumber: number, objectFormat: string, signal?: AbortSignal): Promise<{ left: CapturedSide; right: CapturedSide; diffArgs: string[] }> {
  if (mode === "working") return { left: await captureIndex(root, signal), right: await captureWorking(root, signal), diffArgs: [] };
  if (mode === "staged") return { left: await captureCommit(root, head, "HEAD", signal), right: await captureIndex(root, signal), diffArgs: ["--cached"] };
  const commitObject = await gitText(["cat-file", "commit", head], root, signal); const parents = commitObject.split(/\r?\n/).filter((line) => line.startsWith("parent ")).map((line) => line.slice(7).trim());
  if (parents.length === 0) { const emptyTree = (await gitBufferWithInput(["hash-object", "-t", "tree", "--stdin"], root, "", signal, 1024 * 1024)).toString("utf8").trim(); const expectedLength = objectFormat === "sha256" ? 64 : 40; if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`).test(emptyTree)) throw new Error("无法为当前 Git 对象格式计算空树身份"); return { left: emptySide(emptyTree), right: await captureCommit(root, head, "HEAD", signal), diffArgs: [emptyTree, head] }; }
  const parent = parents[parentNumber - 1]; if (!parent) throw new Error(`合并提交没有第 ${parentNumber} 个父提交；可用父提交数量为 ${parents.length}`);
  try { await gitText(["cat-file", "-e", `${parent}^{commit}`], root, signal); } catch { throw new Error(`缺少所选父提交 ${parent.slice(0, 12)}，可能是浅克隆；不会静默改用其他基准`); }
  return { left: await captureCommit(root, parent, `HEAD 的第 ${parentNumber} 个父提交`, signal, parentNumber), right: await captureCommit(root, head, "HEAD", signal), diffArgs: [parent, head] };
}

function emptySide(emptyTree: string): CapturedSide { return { kind: "empty-tree", label: "空树（初始提交基准）", revision: emptyTree, contentFingerprint: contentFingerprint(""), manifestFingerprint: contentFingerprint(""), stateFingerprint: emptyTree, capturedAt: new Date().toISOString(), sources: [], unsupported: [], ignored: [], secrets: [], binary: [], oversized: [], submodules: [] }; }
async function captureCommit(root: string, revision: string, label: string, signal?: AbortSignal, parentNumber?: number): Promise<CapturedSide> {
  const tree = (await gitText(["rev-parse", `${revision}^{tree}`], root, signal)).trim(); const raw = await gitBuffer(["ls-tree", "-r", "-z", "--full-tree", revision], root, signal); const entries = parseTreeEntries(raw); const result = await sourcesFromEntries(root, entries, signal);
  return sideFromSources({ kind: "commit", label: `${label} · ${revision.slice(0, 12)}`, revision, ...(parentNumber ? { parentNumber } : {}), stateFingerprint: `${revision}:${tree}` }, result);
}
async function captureIndex(root: string, signal?: AbortSignal): Promise<CapturedSide> {
  const raw = await gitBuffer(["ls-files", "--stage", "-z"], root, signal); const entries = parseIndexEntries(raw); if (entries.some((item) => item.stage !== 0)) throw new Error("index 存在多阶段条目，无法建立不可变 index 侧"); const result = await sourcesFromEntries(root, entries, signal);
  return sideFromSources({ kind: "index", label: "Index（暂存区实际 blob）", stateFingerprint: contentFingerprint(raw.toString("base64")) }, result);
}
async function captureWorking(root: string, signal?: AbortSignal, knownHead?: Buffer, knownIndex?: Buffer): Promise<CapturedSide> {
  const discovery = await discoverProject(root, signal); const sources: CapturedSource[] = []; const binary: string[] = [];
  if (discovery.failures.length) throw new Error(`工作区清单读取失败：${discovery.failures.slice(0, 3).map((item) => item.filePath).join("、")}`);
  for (const absolutePath of discovery.files) { throwIfAborted(signal); const projectPath = normalizeProjectPath(root, absolutePath); const raw = await readFile(absolutePath); if (raw.includes(0)) { binary.push(projectPath); continue; } const content = raw.toString("utf8"); sources.push({ projectPath, content, contentHash: contentFingerprint(content), language: languageFromPath(projectPath) }); }
  const head = knownHead ?? await gitBuffer(["rev-parse", "HEAD"], root, signal); const index = knownIndex ?? await gitBuffer(["ls-files", "--stage", "-z"], root, signal); const contentIdentity = sourceFingerprint(sources.map((item) => ({ path: item.projectPath, content: item.content })));
  const stateFingerprint = contentFingerprint(Buffer.concat([head, index, Buffer.from(contentIdentity)]).toString("base64"));
  return sideFromSources({ kind: "working-tree", label: "Working tree（捕获时内容）", stateFingerprint }, { sources, unsupported: discovery.unsupportedPaths, ignored: discovery.ignoredPaths, secrets: discovery.secretPaths, binary, oversized: discovery.oversizedPaths, submodules: [] });
}
function sideFromSources(base: Pick<CapturedSide, "kind" | "label" | "stateFingerprint"> & Partial<Pick<CapturedSide, "revision" | "parentNumber">>, result: Pick<CapturedSide, "sources" | "unsupported" | "ignored" | "secrets" | "binary" | "oversized" | "submodules">): CapturedSide {
  const content = sourceFingerprint(result.sources.map((item) => ({ path: item.projectPath, content: item.content }))); const manifests = sourceFingerprint(result.sources.filter((item) => classifyProjectPath(item.projectPath) === "config").map((item) => ({ path: item.projectPath, content: item.content })));
  return { ...base, ...result, contentFingerprint: content, manifestFingerprint: manifests, capturedAt: new Date().toISOString() };
}
interface ObjectEntry { mode: string; oid: string; path: string; stage: number }
function parseTreeEntries(raw: Buffer): ObjectEntry[] { return raw.toString("utf8").split("\0").filter(Boolean).map((entry) => { const match = entry.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t([\s\S]+)$/); if (!match) throw new Error("Git tree 返回格式无效"); return { mode: match[1]!, oid: match[3]!, path: match[4]!, stage: 0 }; }); }
function parseIndexEntries(raw: Buffer): ObjectEntry[] { return raw.toString("utf8").split("\0").filter(Boolean).map((entry) => { const match = entry.match(/^(\d+)\s+([0-9a-f]+)\s+(\d)\t([\s\S]+)$/); if (!match) throw new Error("Git index 返回格式无效"); return { mode: match[1]!, oid: match[2]!, stage: Number(match[3]), path: match[4]! }; }); }
async function sourcesFromEntries(root: string, entries: ObjectEntry[], signal?: AbortSignal): Promise<Pick<CapturedSide, "sources" | "unsupported" | "ignored" | "secrets" | "binary" | "oversized" | "submodules">> {
  const sources: CapturedSource[] = []; const unsupported: string[] = []; const ignored: string[] = []; const secrets: string[] = []; const binary: string[] = []; const oversized: string[] = []; const submodules: string[] = [];
  const eligible: ObjectEntry[] = [];
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) { throwIfAborted(signal); assertSafeGitPath(entry.path); if (entry.mode === "160000") { submodules.push(entry.path); continue; } if (entry.mode === "120000") { unsupported.push(entry.path); continue; } const classification = classifyProjectPath(entry.path); if (classification === "secret") { secrets.push(entry.path); continue; } if (classification === "ignored") { ignored.push(entry.path); continue; } if (classification === "unsupported") { unsupported.push(entry.path); continue; } eligible.push(entry); }
  const objectSizes = await readObjectSizes(root, eligible.map((entry) => entry.oid), signal);
  const readable = eligible.filter((entry) => { if ((objectSizes.get(entry.oid) ?? Number.POSITIVE_INFINITY) <= 2_000_000) return true; oversized.push(entry.path); return false; });
  const blobs = await readBlobs(root, readable.map((entry) => entry.oid), signal);
  for (const entry of readable) { const blob = blobs.get(entry.oid); if (!blob) throw new Error("Git 批量对象读取缺少预期 blob"); if (blob.includes(0)) { binary.push(entry.path); continue; } const content = blob.toString("utf8"); sources.push({ projectPath: entry.path, content, contentHash: contentFingerprint(content), language: languageFromPath(entry.path) }); }
  return { sources, unsupported, ignored, secrets, binary, oversized, submodules };
}

async function readObjectSizes(root: string, oids: string[], signal?: AbortSignal): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (let offset = 0; offset < oids.length; offset += 256) {
    throwIfAborted(signal); const chunk = [...new Set(oids.slice(offset, offset + 256))]; if (!chunk.length) continue;
    const raw = await gitBufferWithInput(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], root, `${chunk.join("\n")}\n`, signal, 4 * 1024 * 1024);
    for (const line of raw.toString("utf8").trim().split(/\r?\n/).filter(Boolean)) { const match = line.match(/^([0-9a-f]+) blob (\d+)$/); if (match) sizes.set(match[1]!, Number(match[2])); }
  }
  return sizes;
}

async function readBlobs(root: string, oids: string[], signal?: AbortSignal): Promise<Map<string, Buffer>> {
  const blobs = new Map<string, Buffer>();
  for (let offset = 0; offset < oids.length; offset += 64) {
    throwIfAborted(signal); const chunk = [...new Set(oids.slice(offset, offset + 64))]; if (!chunk.length) continue;
    const raw = await gitBufferWithInput(["cat-file", "--batch"], root, `${chunk.join("\n")}\n`, signal); let cursor = 0;
    for (const requested of chunk) { const lineEnd = raw.indexOf(10, cursor); if (lineEnd < 0) throw new Error("Git 批量对象响应缺少头部"); const header = raw.subarray(cursor, lineEnd).toString("utf8"); const match = header.match(/^([0-9a-f]+) blob (\d+)$/); if (!match || match[1] !== requested) throw new Error("Git 批量对象响应与请求不一致"); const size = Number(match[2]); const start = lineEnd + 1; const end = start + size; if (end >= raw.length) throw new Error("Git 批量对象响应被截断"); blobs.set(requested, raw.subarray(start, end)); cursor = end + 1; }
  }
  return blobs;
}

async function captureChanges(root: string, mode: ComparisonMode, diffArgs: string[], left: CapturedSide, right: CapturedSide, signal?: AbortSignal): Promise<CapturedChange[]> {
  const common = [...diffArgs, "--find-renames=20%", "--no-ext-diff", "--no-textconv"]; const statusRaw = await gitText(["diff", ...common, "--name-status", "-z"], root, signal); const statusChanges = parseNameStatus(statusRaw, assertSafeGitPath).filter((change) => { const path = change.newPath ?? change.oldPath ?? ""; const classification = classifyProjectPath(path); return classification !== "secret" && classification !== "ignored"; });
  const excluded = new Set([...left.unsupported, ...right.unsupported, ...left.oversized, ...right.oversized, ...left.submodules, ...right.submodules]); const binary = new Set([...left.binary, ...right.binary]); const patchable = statusChanges.filter((change) => ![change.oldPath, change.newPath].some((path) => path && (excluded.has(path) || binary.has(path)))); const literalPaths = [...new Set(patchable.flatMap((change) => [change.oldPath, change.newPath]).filter((path): path is string => Boolean(path)).map((path) => `:(literal)${path}`))]; const patch = literalPaths.length ? await gitText(["diff", ...common, "--patch", "--unified=0", "--no-color", "--no-prefix", "--", ...literalPaths], root, signal) : ""; const detailed = attachPatchSections(patchable, patch); const details = new Map(detailed.map((item) => [`${item.status}\0${item.oldPath ?? ""}\0${item.newPath ?? ""}`, item])); const changes: CapturedChange[] = statusChanges.map((item) => details.get(`${item.status}\0${item.oldPath ?? ""}\0${item.newPath ?? ""}`) ?? { ...item, additions: 0, deletions: 0, binary: [item.oldPath, item.newPath].some((path) => Boolean(path && binary.has(path))), hunks: [] });
  if (mode === "working") { const untracked = (await gitText(["ls-files", "--others", "--exclude-standard", "-z"], root, signal)).split("\0").filter(Boolean); for (const path of untracked) { assertSafeGitPath(path); const captured = right.sources.find((item) => item.projectPath === path); const classification = classifyProjectPath(path); if (classification === "secret" || classification === "ignored") continue; const metadataOnly = right.unsupported.includes(path) || right.binary.includes(path) || right.oversized.includes(path); if (!captured && !metadataOnly) continue; const lines = captured?.content.split(/\r?\n/) ?? []; changes.push({ status: "untracked", newPath: path, additions: captured ? lines.length : 0, deletions: 0, binary: right.binary.includes(path), hunks: captured ? [{ header: `@@ -0,0 +1,${lines.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length }] : [] }); } }
  return changes.sort((a, b) => (a.newPath ?? a.oldPath ?? "").localeCompare(b.newPath ?? b.oldPath ?? ""));
}
export function assertSafeGitPath(path: string): void { if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).some((part) => part === ".." || part === "")) throw new Error("Git 对象包含越界或无效路径，已拒绝比较"); }

export async function getGitHead(rootPath: string): Promise<string | undefined> {
  try { return await git(["rev-parse", "HEAD"], rootPath); }
  catch { return undefined; }
}

export async function cloneRepository(cacheRoot: string, url: string, branch?: string | undefined): Promise<string> {
  const parsedName = basename(url.replace(/[\\/]$/, "")).replace(/\.git$/i, "") || "repository";
  const target = join(cacheRoot, `${parsedName}-${stableId(url).slice(0, 8)}`);
  await mkdir(cacheRoot, { recursive: true });
  const args = ["clone", "--depth", "1"];
  if (branch) args.push("--branch", branch, "--single-branch");
  args.push("--", url, target);
  await git(args);
  return target;
}
