import { PythonParseReuseSession, parseHash } from "./parse-cache.js";
export { PythonParseReuseSession, type PythonParseWork } from "./parse-cache.js";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import { diagnosticForError, safeDiagnostic, type Confidence, type Evidence, type GraphEdge, type GraphNode, type NodeKind, type SafeDiagnostic, type SourceSpan } from "@project-xray/contracts";
import { normalizeProjectPath, stableId, throwIfAborted, type AnalyzerContext, type FileAnalysis, type LanguageAnalyzer } from "@project-xray/analyzer-core";

const positionSchema = z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative(), endLine: z.number().int().positive(), endColumn: z.number().int().nonnegative() });
const symbolSchema = positionSchema.extend({ kind: z.enum(["function", "method", "class", "variable"]), name: z.string(), qualified: z.string(), owner: z.string().optional(), bindingKind: z.string().optional() });
const importSchema = positionSchema.extend({ module: z.string(), member: z.string().optional(), local: z.string(), alias: z.string().nullable().optional(), scope: z.string() });
const callSchema = positionSchema.extend({ caller: z.string(), expression: z.string(), resolution: z.enum(["local", "import", "unresolved", "shadowed", "decorated", "attribute", "dynamic"]), rootName: z.string().optional(), targetQualified: z.string().optional(), importModule: z.string().optional(), importMember: z.string().optional() });
const accessSchema = positionSchema.extend({ caller: z.string(), target: z.string(), targetQualified: z.string().nullable().optional(), mode: z.enum(["read", "write"]) });
const returnSchema = positionSchema.extend({ caller: z.string(), target: z.string(), targetQualified: z.string().nullable().optional() });
const endpointSchema = positionSchema.extend({ framework: z.string(), method: z.string(), route: z.string(), handler: z.string() });
const pythonResultSchema = z.object({ protocolVersion: z.literal("2.2.0"), runtimeFingerprint: z.string().regex(/^[a-f0-9]{64}$/), workerDigest: z.string().regex(/^[a-f0-9]{64}$/), symbols: z.array(symbolSchema), imports: z.array(importSchema), calls: z.array(callSchema), accesses: z.array(accessSchema), returns: z.array(returnSchema), endpoints: z.array(endpointSchema) });
type PythonResult = z.infer<typeof pythonResultSchema>;
export interface PythonProjectSource { absolutePath: string; content: string }
type PythonFailureKind = "syntax" | "environment" | "timeout" | "protocol" | "process";
type PythonSyntaxCode = "SyntaxError" | "IndentationError" | "TabError";
class PythonAnalysisError extends Error { constructor(readonly kind: PythonFailureKind, message: string, readonly detailCode?: PythonSyntaxCode) { super(message); this.name = "PythonAnalysisError"; } }
const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
const pythonDiagnostic = (error: unknown): SafeDiagnostic => {
  if (!(error instanceof PythonAnalysisError)) return diagnosticForError(error, "PYTHON_ANALYSIS_FAILED");
  if (error.kind === "syntax") return safeDiagnostic("PYTHON_SYNTAX_ERROR", error.detailCode);
  if (error.kind === "environment") return safeDiagnostic("PYTHON_ENVIRONMENT_UNAVAILABLE");
  if (error.kind === "timeout") return safeDiagnostic("ANALYSIS_TIMEOUT");
  return safeDiagnostic("PYTHON_ANALYSIS_FAILED");
};

function analyzerWorkerPath(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const moduleDirectory = typeof __dirname === "string" ? __dirname : undefined;
  const candidates = [
    process.env.XRAY_PYTHON_ANALYZER,
    join(process.cwd(), "python", "analyze.py"),
    join(process.cwd(), "packages", "analyzer-python", "python", "analyze.py"),
    join(process.cwd(), "..", "analyzer-python", "python", "analyze.py"),
    join(process.cwd(), "..", "..", "packages", "analyzer-python", "python", "analyze.py"),
    join(process.cwd(), "apps", "desktop", "dist", "python-analyze.py"),
    moduleDirectory ? join(moduleDirectory, "python-analyze.py") : undefined,
    moduleDirectory ? join(moduleDirectory, "python", "analyze.py") : undefined,
    resourcesPath ? join(resourcesPath, "python-analyze.py") : undefined,
  ].filter((item): item is string => Boolean(item));
  const found = candidates.find(existsSync); if (!found) throw new PythonAnalysisError("environment", "Python 分析 worker 不可用"); return found;
}

function workerDigest(): string { return parseHash(readFileSync(analyzerWorkerPath(), "utf8")); }

function runPythonAnalyzer(filePath: string, source: string, signal?: AbortSignal, timeoutMs = 15_000): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal); let worker: string; let digest: string;
    try { worker = analyzerWorkerPath(); digest = workerDigest(); } catch (error) { reject(error); return; }
    const child = spawn("python", ["-I", worker], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (operation: () => void): void => { if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort); operation(); };
    const abort = (): void => { child.kill(); finish(() => reject(new DOMException("Python 分析任务已取消", "AbortError"))); };
    const timeout = setTimeout(() => { child.kill(); finish(() => reject(new PythonAnalysisError("timeout", `Python 分析超时：${filePath.split(/[\\/]/).at(-1) ?? "文件"}`))); }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true }); child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; }); child.stderr.on("data", (chunk: string) => { stderr += chunk; }); child.stdin.on("error", () => undefined);
    child.on("error", (error: NodeJS.ErrnoException) => finish(() => reject(new PythonAnalysisError("environment", `Python 运行环境不可用（${error.code ?? "启动失败"}）`))));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) { const finalLine = stderr.trim().split(/\r?\n/).at(-1) ?? ""; const syntaxType = finalLine.match(/^(SyntaxError|IndentationError|TabError):/)?.[1] as PythonSyntaxCode | undefined; finish(() => reject(syntaxType ? new PythonAnalysisError("syntax", `Python 语法错误（${syntaxType}）`, syntaxType) : new PythonAnalysisError("process", `Python 分析器异常退出（${code ?? "无退出码"}）`))); return; }
      const parsed = (() => { try { return pythonResultSchema.safeParse(JSON.parse(stdout)); } catch { return { success: false } as const; } })();
      try { if (workerDigest() !== digest || analyzerWorkerPath() !== worker || (parsed.success && parsed.data.workerDigest !== digest)) { finish(() => reject(new PythonAnalysisError("protocol", "Python 工具身份变化"))); return; } } catch { finish(() => reject(new PythonAnalysisError("environment", "Python 工具不可用"))); return; }
      finish(() => parsed.success ? resolve(parsed.data) : reject(new PythonAnalysisError("protocol", "Python 分析器返回了无效结果")));
    });
    child.stdin.end(JSON.stringify({ filePath, sourceBase64: Buffer.from(source, "utf8").toString("base64") }));
  });
}

function moduleName(projectPath: string): string { const name = projectPath.replace(/\.py$/i, "").replaceAll("/", "."); return name.endsWith(".__init__") ? name.slice(0, -9) : name; }
function resolveImportedModule(sourcePath: string, imported: string): string {
  const dots = imported.match(/^\.+/)?.[0].length ?? 0; if (!dots) return imported;
  const current = moduleName(sourcePath); const parts = sourcePath.replaceAll("\\", "/").endsWith("/__init__.py") ? current.split(".") : current.split(".").slice(0, -1);
  parts.splice(Math.max(0, parts.length - (dots - 1))); const suffix = imported.slice(dots); return [...parts, ...(suffix ? suffix.split(".") : [])].join(".");
}

export class PythonAnalyzer implements LanguageAnalyzer {
  readonly id = "python-ast"; readonly version = "2.2.0";
  supports(filePath: string): boolean { return extname(filePath).toLowerCase() === ".py"; }

  async analyze(filePath: string, source: string, context: AnalyzerContext): Promise<FileAnalysis> {
    const result = await runPythonAnalyzer(filePath, source, context.abortSignal); return this.normalize(filePath, result, context);
  }

  private normalize(filePath: string, result: PythonResult, context: AnalyzerContext): FileAnalysis {
    const projectPath = normalizeProjectPath(context.rootPath, filePath); const fileNodeId = stableId(context.repositoryId, "file", projectPath);
    const nodes: GraphNode[] = []; const edges: GraphEdge[] = []; const evidence: Evidence[] = []; const unresolvedCalls: string[] = []; const symbols = new Map<string, string>();
    const addEvidence = (kind: string, span: SourceSpan, reason: string, confidence: Confidence = "verified"): string => { const id = stableId(context.snapshotId, projectPath, kind, String(span.startLine), String(span.startColumn), reason); evidence.push({ id, snapshotId: context.snapshotId, analyzer: this.id, analyzerVersion: this.version, kind, confidence, reason, span }); return id; };
    const addEdge = (edge: Omit<GraphEdge, "id" | "snapshotId">, discriminator = ""): void => { edges.push({ ...edge, id: stableId(context.snapshotId, edge.source, edge.target, edge.kind, discriminator), snapshotId: context.snapshotId }); };
    const spanOf = (item: z.infer<typeof positionSchema>): SourceSpan => ({ filePath: projectPath, startLine: item.line, startColumn: item.column, endLine: item.endLine, endColumn: item.endColumn });
    for (const item of result.symbols) { const qualifiedName = `${projectPath}::${item.qualified}`; const id = stableId(context.repositoryId, item.kind, qualifiedName); symbols.set(item.qualified, id); const span = spanOf(item); nodes.push({ id, snapshotId: context.snapshotId, kind: item.kind as NodeKind, name: item.name, qualifiedName, language: "Python", filePath: projectPath, span, metadata: { scope: item.owner ?? "<module>", bindingKind: item.bindingKind ?? "unknown" } }); const evidenceId = addEvidence("symbol-definition", span, `Python AST 定义 ${item.kind} ${item.qualified}`); addEdge({ source: fileNodeId, target: id, kind: "DEFINES", confidence: "verified", evidenceId, reason: "文件包含此词法作用域符号" }); }
    for (const item of result.imports) { const span = spanOf(item); const target = stableId(context.repositoryId, "python-import-ref", projectPath, item.scope, item.local, item.module, item.member ?? ""); const relative = item.module.startsWith("."); nodes.push({ id: target, snapshotId: context.snapshotId, kind: relative ? "module" : "external-dependency", name: item.member ? `${item.module}:${item.member}` : item.module, qualifiedName: item.module, metadata: { unresolved: true, referenceKind: relative ? "unresolved-module" : "external-dependency", importModule: item.module, ...(item.member ? { importMember: item.member } : {}), localBinding: item.local, scope: item.scope } }); const evidenceId = addEvidence("import-binding", span, `Python import 将 ${item.module}${item.member ? `.${item.member}` : ""} 绑定为 ${item.local}`, relative ? "unknown" : "verified"); addEdge({ source: fileNodeId, target, kind: "IMPORTS", confidence: relative ? "unknown" : "verified", evidenceId, reason: "Python AST import 绑定", unresolvedTarget: item.module }); }
    for (const call of result.calls) {
      const caller = symbols.get(call.caller); if (!caller) continue; const span = spanOf(call); let target = call.targetQualified ? symbols.get(call.targetQualified) : undefined; let confidence: Confidence = target ? "verified" : "unknown"; let reason = target ? "词法绑定解析到当前文件定义" : "观察到调用表达式，但目标尚未证明";
      if (!target && call.resolution === "import") { const relative = call.importModule?.startsWith(".") ?? false; target = stableId(context.repositoryId, "python-import-call", projectPath, call.importModule ?? "", call.importMember ?? ""); confidence = relative ? "unknown" : "inferred"; reason = relative ? "相对 import 绑定存在，但目标模块尚未解析" : "import 绑定确认外部包来源，但未分析外部实现"; nodes.push({ id: target, snapshotId: context.snapshotId, kind: relative ? "unresolved-call" : "external-dependency", name: call.expression, qualifiedName: `${call.importModule ?? ""}${call.importMember ? `.${call.importMember}` : ""}`, metadata: { unresolved: relative, referenceKind: relative ? "unresolved-call" : "external-dependency", importModule: call.importModule, importMember: call.importMember, callExpression: call.expression } }); }
      if (!target) { target = stableId(context.repositoryId, "unresolved-call", projectPath, call.caller, call.expression, String(call.line), String(call.column)); unresolvedCalls.push(call.expression); nodes.push({ id: target, snapshotId: context.snapshotId, kind: call.resolution === "dynamic" ? "unsupported-semantic" : "unresolved-call", name: call.expression, qualifiedName: `${projectPath}::${call.caller}::${call.expression}`, filePath: projectPath, span, metadata: { unresolved: true, referenceKind: call.resolution === "dynamic" ? "unsupported-semantic" : "unresolved-call", resolution: call.resolution, importModule: call.importModule, importMember: call.importMember } }); reason = call.resolution === "shadowed" ? "名称被参数或变量遮蔽，不能证明其为可调用定义" : call.resolution === "decorated" ? "名称绑定来自装饰器定义；装饰器可能返回包装对象，无法证明最终调用目标" : call.resolution === "attribute" ? "属性调用缺少可靠接收者类型，不按方法名猜测" : call.resolution === "dynamic" ? "动态调用结构不受当前静态分析支持" : reason; }
      const evidenceId = addEvidence("call-expression", span, `观察到 Python 调用表达式 ${call.expression}；${reason}`, confidence); addEdge({ source: caller, target, kind: "CALLS", confidence, evidenceId, reason, ...(confidence === "unknown" ? { unresolvedTarget: call.expression } : {}) }, `${call.line}:${call.column}`);
    }
    for (const access of result.accesses) { const caller = symbols.get(access.caller); const variable = access.targetQualified ? symbols.get(access.targetQualified) : undefined; if (!caller || !variable || caller === variable) continue; const span = spanOf(access); const kind = access.mode === "write" ? "WRITES" : "READS"; const evidenceId = addEvidence(`variable-${access.mode}`, span, `${access.mode === "write" ? "写入" : "读取"}词法绑定 ${access.targetQualified}`); addEdge({ source: caller, target: variable, kind, confidence: "verified", evidenceId, reason: "Python AST 名称上下文及词法绑定确认变量访问" }, `${access.line}:${access.column}`); }
    for (const item of result.returns) { const caller = symbols.get(item.caller); const value = item.targetQualified ? symbols.get(item.targetQualified) : undefined; if (!caller || !value) continue; const span = spanOf(item); const evidenceId = addEvidence("return-flow", span, `${item.target} 的词法绑定值从当前函数返回`); addEdge({ source: caller, target: value, kind: "RETURNS", confidence: "verified", evidenceId, reason: "返回表达式引用此词法绑定" }, `${item.line}:${item.column}`); }
    for (const endpoint of result.endpoints) { const name = `${endpoint.method} ${endpoint.route}`; const id = stableId(context.repositoryId, "endpoint", projectPath, name, String(endpoint.line)); const span = spanOf(endpoint); const evidenceId = addEvidence("python-route", span, `${endpoint.framework} 路由连接到 ${endpoint.handler}`, "inferred"); nodes.push({ id, snapshotId: context.snapshotId, kind: "endpoint", name, qualifiedName: `${projectPath}::${name}`, language: "Python", filePath: projectPath, span, metadata: { framework: endpoint.framework, handler: endpoint.handler } }); addEdge({ source: fileNodeId, target: id, kind: "DEFINES", confidence: "inferred", evidenceId, reason: "框架路由约定推断为入口" }); const handler = symbols.get(endpoint.handler); if (handler) addEdge({ source: id, target: handler, kind: "HANDLES", confidence: "inferred", evidenceId, reason: "路由声明引用此处理函数" }); }
    return { nodes: unique(nodes), edges: unique(edges), evidence: unique(evidence), unresolvedCalls };
  }

  async analyzeProject(sources: PythonProjectSource[], context: AnalyzerContext, reuse?: PythonParseReuseSession): Promise<FileAnalysis> {
    sources = sources.map(source => ({ ...source }));
    const raw = reuse ? await reuse.prepare(sources, p => normalizeProjectPath(context.rootPath, p), (p, content) => runPythonAnalyzer(p, content, context.abortSignal), (json, content) => {
      try { const result = pythonResultSchema.safeParse(JSON.parse(json)); if (!result.success) return undefined; const lines = content.split("\n"); for (const list of [result.data.symbols,result.data.imports,result.data.calls,result.data.accesses,result.data.returns,result.data.endpoints]) for (const item of list) if (item.line > lines.length || item.endLine > lines.length || item.endLine < item.line || item.column > Buffer.byteLength(lines[item.line-1]!) || item.endColumn > Buffer.byteLength(lines[item.endLine-1]!)) return undefined; return result.data; } catch { return undefined; }
    }, workerDigest, () => throwIfAborted(context.abortSignal)) : undefined;
    const parts = new Array<FileAnalysis | undefined>(sources.length); const failures: NonNullable<FileAnalysis["failures"]> = []; let cursor = 0; const concurrency = Math.max(1, Math.min(4, sources.length));
    await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < sources.length) { throwIfAborted(context.abortSignal); const index = cursor++; const source = sources[index]!; try { const result = raw?.get(source.absolutePath); if (result instanceof Error) throw result; parts[index] = result ? this.normalize(source.absolutePath, result, context) : await this.analyze(source.absolutePath, source.content, context); if (reuse) reuse.stats.normalizedFiles++; } catch (error) { if (context.abortSignal?.aborted || isAbortError(error)) throw error; failures.push({ filePath: normalizeProjectPath(context.rootPath, source.absolutePath), ...pythonDiagnostic(error) }); } } }));
    if (reuse) reuse.stats.semanticPasses++;
    const completed = parts.filter((part): part is FileAnalysis => Boolean(part)); const nodes = completed.flatMap((part) => part.nodes); const evidence = completed.flatMap((part) => part.evidence); const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const moduleFiles = new Map<string, string>(); const symbolsByModule = new Map<string, Map<string, GraphNode>>();
    for (const [index, source] of sources.entries()) if (parts[index]) { const path = normalizeProjectPath(context.rootPath, source.absolutePath); const module = moduleName(path); moduleFiles.set(module, stableId(context.repositoryId, "file", path)); const map = new Map<string, GraphNode>(); for (const node of parts[index]!.nodes) if (["function", "method", "class"].includes(node.kind) && node.qualifiedName.startsWith(`${path}::`)) map.set(node.qualifiedName.slice(path.length + 2), node); symbolsByModule.set(module, map); }
    const resolvedEdges = completed.flatMap((part) => part.edges).map((edge) => {
      const sourcePath = evidence.find((item) => item.id === edge.evidenceId)?.span.filePath; const targetNode = nodeById.get(edge.target); if (!sourcePath || !targetNode) return edge;
      const imported = typeof targetNode.metadata.importModule === "string" ? targetNode.metadata.importModule : undefined; if (!imported) return edge; const module = resolveImportedModule(sourcePath, imported); const file = moduleFiles.get(module);
      if (edge.kind === "IMPORTS" && file) return { ...edge, id: stableId(context.snapshotId, edge.source, file, "IMPORTS", edge.evidenceId), target: file, confidence: "verified" as const, reason: "Python 模块路径及包结构解析到项目源码", unresolvedTarget: undefined };
      if (edge.kind === "CALLS" && file) { const member = typeof targetNode.metadata.importMember === "string" ? targetNode.metadata.importMember : undefined; const target = member ? symbolsByModule.get(module)?.get(member) : undefined; if (target?.metadata.bindingKind === "decorated-definition") return { ...edge, confidence: "unknown" as const, reason: "项目模块成员带有装饰器，最终调用目标无法由静态语义证明", unresolvedTarget: target.name }; if (target) return { ...edge, id: stableId(context.snapshotId, edge.source, target.id, "CALLS", edge.evidenceId), target: target.id, confidence: "verified" as const, reason: "Python import 本地绑定解析到项目内成员定义", unresolvedTarget: undefined }; return { ...edge, confidence: "unknown" as const, reason: "项目模块已解析，但导入成员或调用目标无法证明", unresolvedTarget: targetNode.name }; }
      return edge;
    });
    const edgeByEvidence = new Map(resolvedEdges.map((edge) => [edge.evidenceId, edge]));
    const resolvedEvidence = unique(evidence.map((item) => { const edge = edgeByEvidence.get(item.id); return !edge || (item.confidence === edge.confidence && item.reason.endsWith(edge.reason)) ? item : { ...item, confidence: edge.confidence, reason: `${item.reason}；${edge.reason}` }; }));
    const decoratedUnresolvedCalls = resolvedEdges.filter((edge) => edge.kind === "CALLS" && edge.reason.includes("装饰器") && edge.unresolvedTarget).map((edge) => edge.unresolvedTarget!);
    const referenced = new Set(resolvedEdges.flatMap((edge) => [edge.source, edge.target]));
    return { nodes: unique(nodes).filter((node) => !node.metadata.unresolved || referenced.has(node.id)), edges: unique(resolvedEdges), evidence: resolvedEvidence, unresolvedCalls: [...new Set([...completed.flatMap((part) => part.unresolvedCalls), ...decoratedUnresolvedCalls])], failures: [...failures, ...completed.flatMap((part) => part.failures ?? [])].sort((a, b) => a.filePath.localeCompare(b.filePath)) };
  }
}

function unique<T extends { id: string }>(items: T[]): T[] { return [...new Map(items.map((item) => [item.id, item])).values()]; }
