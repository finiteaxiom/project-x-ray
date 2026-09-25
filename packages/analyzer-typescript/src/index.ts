import { dirname, extname, resolve } from "node:path";
import ts from "typescript";
import type { Confidence, Evidence, GraphEdge, GraphNode, NodeKind, SourceSpan } from "@project-xray/contracts";
import {
  languageFromPath,
  normalizeProjectPath,
  stableId,
  throwIfAborted,
  type AnalyzerContext,
  type FileAnalysis,
  type LanguageAnalyzer,
} from "@project-xray/analyzer-core";

const SUPPORTED = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

export interface TypeScriptProjectSource {
  absolutePath: string;
  content: string;
}

function scriptKind(filePath: string): ts.ScriptKind {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function canonicalPath(filePath: string): string {
  return resolve(filePath).replace(/\\/g, "/").toLocaleLowerCase();
}

function spanOf(sourceFile: ts.SourceFile, node: ts.Node, filePath: string): SourceSpan {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { filePath, startLine: start.line + 1, startColumn: start.character, endLine: end.line + 1, endColumn: end.character };
}

function declarationInfo(node: ts.Node): { kind: NodeKind; nameNode: ts.Identifier | ts.PrivateIdentifier; callableNode?: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return { kind: "function", nameNode: node.name, callableNode: node };
  if (ts.isClassDeclaration(node) && node.name) return { kind: "class", nameNode: node.name };
  if (ts.isMethodDeclaration(node) && node.name && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))) return { kind: "method", nameNode: node.name, callableNode: node };
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const callableNode = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : undefined;
    return { kind: callableNode ? "function" : "variable", nameNode: node.name, ...(callableNode ? { callableNode } : {}) };
  }
  if (ts.isParameter(node) && ts.isIdentifier(node.name)) return { kind: "variable", nameNode: node.name };
  return undefined;
}

function isExported(node: ts.Node): boolean {
  let candidate = node;
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)) candidate = node.parent.parent;
  return ts.canHaveModifiers(candidate) && (ts.getModifiers(candidate)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false);
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return declarationInfo(parent)?.nameNode === node
    || (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
    || (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || ts.isPropertyAssignment(parent) && parent.name === node
    || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)
    || ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent);
}

function isWriteIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && ASSIGNMENT_OPERATORS.has(parent.operatorToken.kind)) {
    return parent.left === node || (ts.isPropertyAccessExpression(parent.left) && parent.left.expression === node);
  }
  return (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
}

function stringLiteralValue(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function unwrapSymbol(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!symbol) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try { return checker.getAliasedSymbol(symbol); }
    catch { return symbol; }
  }
  return symbol;
}

function loadCompilerOptions(rootPath: string, virtualConfigs: TypeScriptProjectSource[]): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2023,
    skipLibCheck: true,
    noEmit: true,
  };
  try {
    const byPath = new Map(virtualConfigs.map((item) => [canonicalPath(item.absolutePath), item.content]));
    const configPath = [resolve(rootPath, "tsconfig.json"), resolve(rootPath, "jsconfig.json")].find((candidate) => byPath.has(canonicalPath(candidate)));
    if (!configPath) return defaults;
    const config = ts.parseConfigFileTextToJson(configPath, byPath.get(canonicalPath(configPath))!);
    if (config.error || !config.config) return defaults;
    const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions ?? {}, rootPath);
    return { ...defaults, ...converted.options, noEmit: true };
  } catch {
    return defaults;
  }
}

export class TypeScriptAnalyzer implements LanguageAnalyzer {
  readonly id = "typescript-program";
  readonly version = `${ts.version}+xray.2`;

  supports(filePath: string): boolean {
    return SUPPORTED.has(extname(filePath).toLowerCase());
  }

  async analyze(filePath: string, source: string, context: AnalyzerContext): Promise<FileAnalysis> {
    return this.analyzeProject([{ absolutePath: filePath, content: source }], context);
  }

  async analyzeProject(sources: TypeScriptProjectSource[], context: AnalyzerContext, virtualConfigs: TypeScriptProjectSource[] = []): Promise<FileAnalysis> {
    throwIfAborted(context.abortSignal);
    const sourceByPath = new Map(sources.map((item) => [canonicalPath(item.absolutePath), item.content]));
    const projectPathByAbsolute = new Map(sources.map((item) => [canonicalPath(item.absolutePath), normalizeProjectPath(context.rootPath, item.absolutePath)]));
    const sourceDirectories = new Set<string>();
    for (const source of sources) {
      let directory = canonicalPath(dirname(source.absolutePath));
      while (directory && !sourceDirectories.has(directory)) {
        sourceDirectories.add(directory);
        const parent = canonicalPath(dirname(directory));
        if (parent === directory) break;
        directory = parent;
      }
    }
    const compilerOptions = loadCompilerOptions(context.rootPath, virtualConfigs);
    const defaultHost = ts.createCompilerHost(compilerOptions, true);
    const libraryRoot = canonicalPath(dirname(ts.getDefaultLibFilePath(compilerOptions)));
    const mayReadCompilerLibrary = (fileName: string): boolean => canonicalPath(fileName).startsWith(`${libraryRoot}/`);
    const host: ts.CompilerHost = {
      ...defaultHost,
      fileExists: (fileName) => sourceByPath.has(canonicalPath(fileName)) || (mayReadCompilerLibrary(fileName) && defaultHost.fileExists(fileName)),
      directoryExists: (directoryName) => sourceDirectories.has(canonicalPath(directoryName)) || canonicalPath(directoryName).startsWith(libraryRoot),
      readFile: (fileName) => sourceByPath.get(canonicalPath(fileName)) ?? (mayReadCompilerLibrary(fileName) ? defaultHost.readFile(fileName) : undefined),
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        const content = sourceByPath.get(canonicalPath(fileName));
        if (content !== undefined) return ts.createSourceFile(fileName, content, languageVersion, true, scriptKind(fileName));
        return mayReadCompilerLibrary(fileName) ? defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : undefined;
      },
    };
    const program = ts.createProgram({ rootNames: sources.map((item) => item.absolutePath), options: compilerOptions, host });
    const checker = program.getTypeChecker();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const evidence: Evidence[] = [];
    const unresolvedCalls: string[] = [];
    const nodeIdBySymbol = new Map<ts.Symbol, string>();
    const callableNodeIds = new Set<string>();
    const callableIdByNode = new Map<ts.Node, string>();
    const fileNodeIdByPath = new Map<string, string>();
    const projectSourceFiles = program.getSourceFiles().filter((sourceFile) => projectPathByAbsolute.has(canonicalPath(sourceFile.fileName)));
    const failures = program.getSyntacticDiagnostics().flatMap((diagnostic) => {
      if (!diagnostic.file) return [];
      const filePath = projectPathByAbsolute.get(canonicalPath(diagnostic.file.fileName)); if (!filePath) return [];
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      return [{ filePath, reason: `TypeScript 语法错误 TS${diagnostic.code}，位置 ${position.line + 1}:${position.character}` }];
    });

    const addEvidence = (sourceFile: ts.SourceFile, projectPath: string, kind: string, node: ts.Node, reason: string, confidence: Confidence = "verified"): string => {
      const span = spanOf(sourceFile, node, projectPath);
      const id = stableId(context.snapshotId, projectPath, kind, String(span.startLine), String(span.startColumn), reason);
      evidence.push({ id, snapshotId: context.snapshotId, analyzer: this.id, analyzerVersion: this.version, kind, confidence, reason, span });
      return id;
    };

    const addEdge = (edge: Omit<GraphEdge, "id" | "snapshotId">, discriminator = ""): void => {
      edges.push({ ...edge, id: stableId(context.snapshotId, edge.source, edge.target, edge.kind, edge.evidenceId, discriminator), snapshotId: context.snapshotId });
    };

    for (const sourceFile of projectSourceFiles) {
      throwIfAborted(context.abortSignal);
      const projectPath = projectPathByAbsolute.get(canonicalPath(sourceFile.fileName))!;
      fileNodeIdByPath.set(canonicalPath(sourceFile.fileName), stableId(context.repositoryId, "file", projectPath));
      const collect = (node: ts.Node): void => {
        const info = declarationInfo(node);
        if (info) {
          const symbol = unwrapSymbol(checker, checker.getSymbolAtLocation(info.nameNode));
          const fileNodeId = fileNodeIdByPath.get(canonicalPath(sourceFile.fileName))!;
          const symbolName = info.nameNode.text;
          const semanticName = symbol ? checker.getFullyQualifiedName(symbol).replace(/^".*"\./, "") : symbolName;
          const qualifiedName = `${projectPath}::${semanticName}`;
          const nodeId = stableId(context.repositoryId, info.kind, qualifiedName);
          const symbolSpan = spanOf(sourceFile, node, projectPath);
          nodes.push({
            id: nodeId,
            snapshotId: context.snapshotId,
            kind: info.kind,
            name: symbolName,
            qualifiedName,
            language: languageFromPath(sourceFile.fileName),
            filePath: projectPath,
            span: symbolSpan,
            metadata: { exported: isExported(node), parameter: ts.isParameter(node) },
          });
          if (symbol) nodeIdBySymbol.set(symbol, nodeId);
          if (info.kind === "function" || info.kind === "method" || info.kind === "class") callableNodeIds.add(nodeId);
          if (info.callableNode) callableIdByNode.set(info.callableNode, nodeId);
          if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) callableIdByNode.set(node, nodeId);
          const evidenceId = addEvidence(sourceFile, projectPath, "symbol-definition", node, `TypeScript Program 定义了 ${info.kind} ${symbolName}`);
          const parentCallable = findEnclosingCallable(node.parent, callableIdByNode);
          addEdge({ source: parentCallable ?? fileNodeId, target: nodeId, kind: "DEFINES", confidence: "verified", evidenceId, reason: parentCallable ? "可调用符号定义了此局部符号" : "文件定义了此符号" });
          if (isExported(node)) addEdge({ source: fileNodeId, target: nodeId, kind: "EXPORTS", confidence: "verified", evidenceId, reason: "符号带有静态 export 修饰符" });
        }
        ts.forEachChild(node, collect);
      };
      collect(sourceFile);
    }

    for (const sourceFile of projectSourceFiles) {
      const projectPath = projectPathByAbsolute.get(canonicalPath(sourceFile.fileName))!;
      const fileNodeId = fileNodeIdByPath.get(canonicalPath(sourceFile.fileName))!;
      const visit = (node: ts.Node): void => {
        throwIfAborted(context.abortSignal);
        const callableId = findEnclosingCallable(node, callableIdByNode);

        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const moduleName = node.moduleSpecifier.text;
          const resolved = ts.resolveModuleName(moduleName, sourceFile.fileName, compilerOptions, host).resolvedModule;
          const resolvedFileId = resolved ? fileNodeIdByPath.get(canonicalPath(resolved.resolvedFileName)) : undefined;
          const targetId = resolvedFileId ?? stableId(context.repositoryId, "module-ref", moduleName);
          if (!resolvedFileId) {
            nodes.push({ id: targetId, snapshotId: context.snapshotId, kind: moduleName.startsWith(".") ? "module" : "external-dependency", name: moduleName, qualifiedName: moduleName, metadata: { unresolved: moduleName.startsWith(".") } });
          }
          const confidence: Confidence = resolvedFileId || !moduleName.startsWith(".") ? "verified" : "unknown";
          const evidenceId = addEvidence(sourceFile, projectPath, "import", node, `静态 import 指向 ${moduleName}`, confidence);
          addEdge({
            source: fileNodeId,
            target: targetId,
            kind: "IMPORTS",
            confidence,
            evidenceId,
            reason: resolvedFileId ? "TypeScript 模块解析定位到项目文件" : moduleName.startsWith(".") ? "相对导入未解析" : "静态外部依赖导入",
            ...(confidence === "unknown" ? { unresolvedTarget: moduleName } : {}),
          });
        }

        if (ts.isCallExpression(node) && callableId) {
          const symbolNode = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
          const targetSymbol = unwrapSymbol(checker, checker.getSymbolAtLocation(symbolNode));
          const candidateTargetId = targetSymbol ? nodeIdBySymbol.get(targetSymbol) : undefined;
          const targetId = candidateTargetId && callableNodeIds.has(candidateTargetId) ? candidateTargetId : undefined;
          const targetName = node.expression.getText(sourceFile);
          const placeholderId = targetId ?? stableId(context.repositoryId, "unresolved-call", targetName);
          const confidence: Confidence = targetId ? "verified" : "unknown";
          const evidenceId = addEvidence(sourceFile, projectPath, "call-expression", node, `调用表达式 ${targetName}`, confidence);
          if (!targetId) unresolvedCalls.push(targetName);
          addEdge({ source: callableId, target: placeholderId, kind: "CALLS", confidence, evidenceId, reason: targetId ? "TypeChecker 将调用解析到项目符号" : "调用存在，但 TypeChecker 无法定位项目内目标", ...(!targetId ? { unresolvedTarget: targetName } : {}) }, String(node.pos));
          if (targetId) {
            for (const argument of node.arguments) {
              for (const identifier of identifiersIn(argument)) {
                const valueSymbol = unwrapSymbol(checker, checker.getSymbolAtLocation(identifier));
                const valueId = valueSymbol ? nodeIdBySymbol.get(valueSymbol) : undefined;
                if (!valueId) continue;
                const passEvidenceId = addEvidence(sourceFile, projectPath, "argument-flow", identifier, `${identifier.text} 作为参数传入 ${targetName}`);
                addEdge({ source: valueId, target: targetId, kind: "PASSES_TO", confidence: "verified", evidenceId: passEvidenceId, reason: "TypeChecker 解析到的实参与调用目标" }, String(identifier.pos));
              }
            }
          }
        }

        if (ts.isCallExpression(node)) this.addFrameworkFacts(node, sourceFile, projectPath, fileNodeId, context, checker, nodeIdBySymbol, nodes, addEvidence, addEdge);

        if (ts.isReturnStatement(node) && callableId && node.expression) {
          for (const identifier of identifiersIn(node.expression)) {
            const valueSymbol = unwrapSymbol(checker, checker.getSymbolAtLocation(identifier));
            const valueId = valueSymbol ? nodeIdBySymbol.get(valueSymbol) : undefined;
            if (!valueId) continue;
            const evidenceId = addEvidence(sourceFile, projectPath, "return-flow", identifier, `${identifier.text} 的值从当前函数返回`);
            addEdge({ source: callableId, target: valueId, kind: "RETURNS", confidence: "verified", evidenceId, reason: "返回表达式引用此符号" }, String(identifier.pos));
          }
        }

        if (ts.isIdentifier(node) && callableId && !isDeclarationName(node)) {
          const symbol = unwrapSymbol(checker, checker.getSymbolAtLocation(node));
          const targetId = symbol ? nodeIdBySymbol.get(symbol) : undefined;
          if (targetId && targetId !== callableId) {
            const write = isWriteIdentifier(node);
            const evidenceId = addEvidence(sourceFile, projectPath, write ? "variable-write" : "variable-read", node, `${write ? "写入" : "读取"}变量 ${node.text}`);
            addEdge({ source: callableId, target: targetId, kind: write ? "WRITES" : "READS", confidence: "verified", evidenceId, reason: write ? "TypeChecker 解析到赋值目标" : "TypeChecker 解析到值引用" }, String(node.pos));
          }
        }

        if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text.startsWith("on")) {
          const expression = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
          if (expression) {
            const symbol = unwrapSymbol(checker, checker.getSymbolAtLocation(expression));
            const handlerId = symbol ? nodeIdBySymbol.get(symbol) : undefined;
            if (handlerId) {
              const endpointName = `UI ${node.name.text}`;
              const endpointId = stableId(context.repositoryId, "endpoint", projectPath, endpointName, String(node.pos));
              const evidenceId = addEvidence(sourceFile, projectPath, "react-event", node, `${node.name.text} 属性连接到处理函数`, "inferred");
              nodes.push({ id: endpointId, snapshotId: context.snapshotId, kind: "endpoint", name: endpointName, qualifiedName: `${projectPath}::${endpointName}`, filePath: projectPath, span: spanOf(sourceFile, node, projectPath), language: languageFromPath(sourceFile.fileName), metadata: { framework: "React" } });
              addEdge({ source: fileNodeId, target: endpointId, kind: "DEFINES", confidence: "inferred", evidenceId, reason: "JSX 事件属性推断为界面入口" });
              addEdge({ source: endpointId, target: handlerId, kind: "HANDLES", confidence: "inferred", evidenceId, reason: "JSX 事件属性引用此处理函数" });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    return {
      nodes: [...new Map(nodes.map((node) => [node.id, node])).values()],
      edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
      evidence: [...new Map(evidence.map((item) => [item.id, item])).values()],
      unresolvedCalls: [...new Set(unresolvedCalls)],
      failures: [...new Map(failures.map((item) => [`${item.filePath}:${item.reason}`, item])).values()],
    };
  }

  private addFrameworkFacts(
    node: ts.CallExpression,
    sourceFile: ts.SourceFile,
    projectPath: string,
    fileNodeId: string,
    context: AnalyzerContext,
    checker: ts.TypeChecker,
    nodeIdBySymbol: Map<ts.Symbol, string>,
    nodes: GraphNode[],
    addEvidence: (sourceFile: ts.SourceFile, projectPath: string, kind: string, node: ts.Node, reason: string, confidence?: Confidence) => string,
    addEdge: (edge: Omit<GraphEdge, "id" | "snapshotId">, discriminator?: string) => void,
  ): void {
    if (!ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text.toLowerCase();
    const route = stringLiteralValue(node.arguments[0]);
    if (!HTTP_METHODS.has(method) || !route) return;
    const handlerExpression = node.arguments.at(-1);
    if (!handlerExpression) return;
    const handlerSymbol = unwrapSymbol(checker, checker.getSymbolAtLocation(handlerExpression));
    const handlerId = handlerSymbol ? nodeIdBySymbol.get(handlerSymbol) : undefined;
    const endpointName = `${method.toUpperCase()} ${route}`;
    const endpointId = stableId(context.repositoryId, "endpoint", projectPath, endpointName);
    const evidenceId = addEvidence(sourceFile, projectPath, "http-route", node, `调用形态匹配 HTTP 路由 ${endpointName}`, "inferred");
    nodes.push({ id: endpointId, snapshotId: context.snapshotId, kind: "endpoint", name: endpointName, qualifiedName: `${projectPath}::${endpointName}`, filePath: projectPath, span: spanOf(sourceFile, node, projectPath), language: languageFromPath(sourceFile.fileName), metadata: { framework: "Express/Fastify-compatible" } });
    addEdge({ source: fileNodeId, target: endpointId, kind: "DEFINES", confidence: "inferred", evidenceId, reason: "方法名和字符串参数匹配常见 Web 路由语法" });
    if (handlerId) addEdge({ source: endpointId, target: handlerId, kind: "HANDLES", confidence: "inferred", evidenceId, reason: "路由调用的末尾参数解析到项目内处理函数" });
  }
}

function findEnclosingCallable(node: ts.Node | undefined, callableIdByNode: Map<ts.Node, string>): string | undefined {
  let current = node;
  while (current) {
    const id = callableIdByNode.get(current);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

function identifiersIn(node: ts.Node): ts.Identifier[] {
  const identifiers: ts.Identifier[] = [];
  const visit = (item: ts.Node): void => {
    if (ts.isIdentifier(item) && !isDeclarationName(item)) identifiers.push(item);
    ts.forEachChild(item, visit);
  };
  visit(node);
  return identifiers;
}
