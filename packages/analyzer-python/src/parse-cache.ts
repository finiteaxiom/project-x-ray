import { createHash } from "node:crypto";

export const PYTHON_PARSE_CACHE_FORMAT = "1";
export interface PythonParseCacheRecord { filePath: string; contentHash: string; identity: string; payload: string; digest: string }
export interface PythonParseCacheScope { repositoryId: string; rootPath: string; configurationHash: string; ignoreRevision: number; analyzerVersion: string }
export interface PythonParseWork { workerRequests: number; hits: number; misses: number; normalizedFiles: number; semanticPasses: number; payloadReadBytes: number; payloadWriteBytes: number; fallbackPasses: number }
export const parseHash = (s: string): string => createHash("sha256").update(s).digest("hex");
type ToolResult = { runtimeFingerprint: string; workerDigest: string };
const ROWS = 2048, TOTAL = 32 * 1024 * 1024, ROW = 1024 * 1024;

/** One attempt, no snapshot IDs or mutable analysis facts. Caller records are copied. */
export class PythonParseReuseSession {
  readonly stats: PythonParseWork = { workerRequests: 0, hits: 0, misses: 0, normalizedFiles: 0, semanticPasses: 0, payloadReadBytes: 0, payloadWriteBytes: 0, fallbackPasses: 0 };
  private candidates = new Map<string, PythonParseCacheRecord>();
  private staged: PythonParseCacheRecord[] = [];
  private used = false;
  constructor(private scope: PythonParseCacheScope, records: PythonParseCacheRecord[], private enabled = true) {
    this.scope = { ...scope }; let bytes = 0;
    for (const r of records.slice(0, ROWS)) {
      if (typeof r.payload !== "string" || typeof r.identity !== "string" || r.identity.length > 4096) continue;
      const size = Buffer.byteLength(r.payload); if (size > ROW || bytes + size > TOTAL) continue;
      bytes += size; this.candidates.set(r.filePath, { ...r });
    }
  }
  records(): PythonParseCacheRecord[] { return this.staged.map(r => ({ ...r })); }
  async prepare<T extends ToolResult>(sources: Array<{ absolutePath: string; content: string }>, pathOf: (p: string) => string,
    run: (path: string, content: string) => Promise<T>, decode: (json: string, content: string) => T | undefined,
    currentDigest: () => string, aborted: () => void): Promise<Map<string, T | Error>> {
    if (this.used) throw new Error("Parse session already consumed"); this.used = true;
    const captured = sources.map(s => ({ ...s }));
    const output = new Map<string, T | Error>(); this.staged = [];
    const key = (s: { absolutePath: string; content: string }, tool: ToolResult): string => JSON.stringify({ ...this.scope, format: PYTHON_PARSE_CACHE_FORMAT, workerDigest: tool.workerDigest, runtimeFingerprint: tool.runtimeFingerprint, filePath: pathOf(s.absolutePath), contentHash: parseHash(s.content) });
    const execute = async (s: { absolutePath: string; content: string }): Promise<T | Error> => {
      aborted(); this.stats.workerRequests++;
      try { return await run(s.absolutePath, s.content); } catch (e) { aborted(); return e instanceof Error ? e : new Error("Python analysis failed"); }
    };
    if (!captured.length) return output;
    let digest: string | undefined; try { digest = currentDigest(); } catch { /* Probe reports fixed environment diagnostic. */ }
    const sorted = captured.sort((a, b) => pathOf(a.absolutePath).localeCompare(pathOf(b.absolutePath)));
    const probeSource = sorted.find(s => {
      const r = this.candidates.get(pathOf(s.absolutePath));
      if (!r || r.contentHash !== parseHash(s.content)) return true;
      try { const id = JSON.parse(r.identity) as Record<string, unknown>; return id.workerDigest !== digest || id.configurationHash !== this.scope.configurationHash || id.ignoreRevision !== this.scope.ignoreRevision || id.analyzerVersion !== this.scope.analyzerVersion; } catch { return true; }
    }) ?? sorted[0]!;
    const probe = await execute(probeSource); output.set(probeSource.absolutePath, probe);
    let unstable = false;
    // Probe failure forbids hits for this attempt. Every other file remains a real cold parse.
    const remaining = sorted.filter(s => s !== probeSource); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, remaining.length) }, async () => { while (cursor < remaining.length) {
      const s = remaining[cursor++]!;
      aborted(); const r = this.candidates.get(pathOf(s.absolutePath)); let cached: T | undefined;
      if (this.enabled && !(probe instanceof Error) && r && r.contentHash === parseHash(s.content) && r.identity === key(s, probe) && r.digest === parseHash(r.payload)) {
        try { if (currentDigest() === probe.workerDigest) cached = decode(r.payload, s.content); else unstable = true; } catch { unstable = true; }
      }
      if (cached && !(probe instanceof Error) && cached.runtimeFingerprint === probe.runtimeFingerprint && cached.workerDigest === probe.workerDigest) {
        this.stats.hits++; this.stats.payloadReadBytes += Buffer.byteLength(r!.payload); output.set(s.absolutePath, cached);
      } else {
        const result = await execute(s); output.set(s.absolutePath, result);
        if (!(probe instanceof Error) && !(result instanceof Error) && (result.runtimeFingerprint !== probe.runtimeFingerprint || result.workerDigest !== probe.workerDigest)) unstable = true;
        if (!(probe instanceof Error) && result instanceof Error && (result as Error & { kind?: string }).kind !== "syntax") unstable = true;
      }
    } }));
    try { if (!(probe instanceof Error) && currentDigest() !== probe.workerDigest) unstable = true; } catch { if (!(probe instanceof Error)) unstable = true; }
    if (unstable) {
      this.stats.fallbackPasses++; this.stats.hits = 0; output.clear(); let tool: T | undefined;
      for (const s of sorted) {
        const result = await execute(s); output.set(s.absolutePath, result);
        if (result instanceof Error) continue;
        if (tool && (result.runtimeFingerprint !== tool.runtimeFingerprint || result.workerDigest !== tool.workerDigest)) throw new Error("Python tool identity changed"); tool = result;
      }
      if (tool && currentDigest() !== tool.workerDigest) throw new Error("Python tool identity changed");
    }
    this.stats.misses = captured.length - this.stats.hits;
    // Parsed objects remain attempt-local; drop the old string bank before staging the new bounded bank.
    this.candidates.clear();
    let bytes = 0;
    if (this.enabled && !(probe instanceof Error)) for (const s of sorted) {
      const result = output.get(s.absolutePath); if (!result || result instanceof Error) continue;
      const payload = JSON.stringify(result), size = Buffer.byteLength(payload);
      if (size > ROW || bytes + size > TOTAL || this.staged.length >= ROWS) continue;
      bytes += size; this.staged.push({ filePath: pathOf(s.absolutePath), contentHash: parseHash(s.content), identity: key(s, result), payload, digest: parseHash(payload) });
    }
    this.stats.payloadWriteBytes = bytes; return output;
  }
}
