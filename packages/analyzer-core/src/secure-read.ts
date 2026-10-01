import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SafeDiagnosticError } from "@project-xray/contracts";

const MAX_SOURCE_BYTES = 2_000_000;
const READ_CHUNK_BYTES = 64 * 1024;
const REQUIRE = createRequire(process.execPath);

interface NativeInspection { contained: boolean; identity: string; isDirectory: boolean; isFile: boolean; size: number }
interface NativeSecureReader {
  createScope(rootPath: string): { nativeScope: unknown; rootPath: string };
  openFile(scope: unknown, relativePath: string): Promise<unknown>;
  inspectFileHandle(scope: unknown, fileHandle: unknown): NativeInspection;
  readFileChunk(scope: unknown, fileHandle: unknown, capacity: number): Promise<Buffer>;
  closeFile(fileHandle: unknown): void;
  closeScope(scope: unknown): void;
}

export class ProjectPathSecurityError extends Error {
  readonly code = "ERR_PROJECT_PATH_SECURITY";
  constructor(phase: "before-read" | "after-read" = "before-read") {
    super(phase === "before-read"
      ? "已打开文件句柄超出项目根目录；源码字节尚未读取"
      : "读取期间文件句柄的根目录包含性或对象身份校验失败；缓冲区已丢弃且未交给分析器");
    this.name = "ProjectPathSecurityError";
  }
}

export interface SecureReadTestHooks {
  beforeOpen?: (absolutePath: string) => void | Promise<void>;
  afterOpen?: (absolutePath: string) => void | Promise<void>;
  onReadChunk?: (absolutePath: string, bytesRead: number) => void;
  afterRead?: (absolutePath: string) => void | Promise<void>;
}

export interface SecureReadScope {
  readonly rootPath: string;
  readonly nativeScope: unknown;
  close(): void;
}

let nativeReader: NativeSecureReader | undefined;

export async function createSecureReadScope(rootPath: string): Promise<SecureReadScope> {
  const reader = getNativeReader();
  const created = reader.createScope(resolve(rootPath));
  const nativeScope = created.nativeScope;
  let closed = false;
  return {
    rootPath: created.rootPath,
    nativeScope,
    close() {
      if (closed) return;
      reader.closeScope(nativeScope);
      closed = true;
    },
  };
}

export async function readSecureProjectFile(
  scope: SecureReadScope,
  absolutePath: string,
  options: { signal?: AbortSignal; testHooks?: SecureReadTestHooks } = {},
): Promise<string> {
  return (await readSecureProjectFileBuffer(scope, absolutePath, options)).toString("utf8");
}

export async function readSecureProjectFileBuffer(
  scope: SecureReadScope,
  absolutePath: string,
  options: { signal?: AbortSignal; testHooks?: SecureReadTestHooks } = {},
): Promise<Buffer> {
  const reader = getNativeReader();
  const file = resolve(absolutePath);
  const relativePath = relative(scope.rootPath, file);
  if (!relativePath || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new ProjectPathSecurityError("before-read");
  }
  checkAborted(options.signal);
  await options.testHooks?.beforeOpen?.(file);
  checkAborted(options.signal);
  const handle = await reader.openFile(scope.nativeScope, relativePath);
  try {
    await options.testHooks?.afterOpen?.(file);
    checkAborted(options.signal);
    const nativeBefore = reader.inspectFileHandle(scope.nativeScope, handle);
    if (!nativeBefore.contained) throw new ProjectPathSecurityError("before-read");
    if (nativeBefore.isDirectory || !nativeBefore.isFile) throw new Error("支持源码路径不是普通文件");
    if (!Number.isSafeInteger(nativeBefore.size) || nativeBefore.size > MAX_SOURCE_BYTES) throw new Error("文件在读取前已超过 2 MB 限制");

    const chunks: Buffer[] = [];
    let position = 0;
    for (;;) {
      checkAborted(options.signal);
      const buffer = await reader.readFileChunk(scope.nativeScope, handle, Math.min(READ_CHUNK_BYTES, MAX_SOURCE_BYTES + 1 - position));
      if (buffer.length === 0) break;
      position += buffer.length;
      options.testHooks?.onReadChunk?.(file, buffer.length);
      if (position > MAX_SOURCE_BYTES) throw new Error("文件在读取期间超过 2 MB 限制");
      chunks.push(buffer);
    }

    await options.testHooks?.afterRead?.(file);
    checkAborted(options.signal);
    const nativeAfter = reader.inspectFileHandle(scope.nativeScope, handle);
    if (!nativeAfter.contained || nativeAfter.identity !== nativeBefore.identity) throw new ProjectPathSecurityError("after-read");
    if (!Number.isSafeInteger(nativeAfter.size) || nativeAfter.size !== nativeBefore.size || position !== nativeAfter.size) {
      throw new Error("文件在读取期间发生变化");
    }
    return Buffer.concat(chunks, position);
  } finally {
    reader.closeFile(handle);
  }
}

export async function readProjectFileSecure(
  rootPath: string,
  filePath: string,
  options: { signal?: AbortSignal; testHooks?: SecureReadTestHooks } = {},
): Promise<string> {
  const scope = await createSecureReadScope(rootPath);
  try {
    return await readSecureProjectFile(scope, resolve(scope.rootPath, filePath), options);
  } finally {
    scope.close();
  }
}

export function isProjectPathSecurityError(error: unknown): error is ProjectPathSecurityError {
  return error instanceof ProjectPathSecurityError || (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_PROJECT_PATH_SECURITY");
}

function getNativeReader(): NativeSecureReader {
  if (nativeReader) return nativeReader;
  const moduleDirectory = typeof __dirname === "string" ? __dirname : process.cwd();
  const candidates = [
    process.env.PROJECT_XRAY_SECURE_READER_PATH,
    join(moduleDirectory, "native", "secure_reader.node"),
    join(moduleDirectory, "..", "native", "build", "Release", "secure_reader.node"),
    join(process.cwd(), "native", "build", "Release", "secure_reader.node"),
    join(process.cwd(), "build", "Release", "secure_reader.node"),
    join(process.cwd(), "packages", "analyzer-core", "native", "build", "Release", "secure_reader.node"),
    join(process.cwd(), "..", "analyzer-core", "native", "build", "Release", "secure_reader.node"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of new Set(candidates.map((item) => resolve(item)))) {
    if (!existsSync(candidate)) continue;
    try { nativeReader = REQUIRE(candidate) as NativeSecureReader; }
    catch { throw new SafeDiagnosticError("NATIVE_MODULE_UNAVAILABLE", "ERR_DLOPEN_FAILED"); }
    return nativeReader;
  }
  throw new SafeDiagnosticError("SECURE_READER_UNAVAILABLE");
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("索引任务已取消", "AbortError");
}
