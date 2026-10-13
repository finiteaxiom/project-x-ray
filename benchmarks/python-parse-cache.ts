/** Finite, owned fixtures. No imported code execution, network, build, or recursive cleanup. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSnapshotContent } from "../packages/contracts/src/index.js";
import { XRayApplication, type IndexOptions } from "../packages/application/src/index.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Work = Parameters<NonNullable<IndexOptions["onIndexWork"]>>[0];
interface Sample { mode: string; files: number; wallMs: number; nodeCpuUserMs: number; nodeCpuSystemMs: number; nodeSampledPeakRssBytes: number; nodeRssSamples: number; snapshotId: string; contentDigest: string; work: Work }
if (process.argv[2] === "--child") {
  const root = process.argv[3]!, data = process.argv[4]!, mode = process.argv[5]!, files = Number(process.argv[6]);
  mkdirSync(data, { recursive: true });
  const app = new XRayApplication({ databasePath: join(data, "global.sqlite"), projectDatabaseRoot: join(data, "projects"), cacheRoot: join(data, "cache") });
  let peak = process.memoryUsage().rss, samples = 1, work!: Work;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); samples++; }, 10);
  const cpu = process.cpuUsage(), start = performance.now();
  try {
    const snapshot = await app.indexProject(root, "local", { testOnlyDisablePythonParseCache: mode === "cold", onIndexWork: w => { work = w; } });
    const wallMs = performance.now() - start, used = process.cpuUsage(cpu); peak = Math.max(peak, process.memoryUsage().rss); samples++;
    if (snapshot.health.status !== "ready") throw new Error("Measurement fixture did not fully index");
    const sample: Sample = { mode, files, wallMs, nodeCpuUserMs: used.user / 1000, nodeCpuSystemMs: used.system / 1000, nodeSampledPeakRssBytes: peak, nodeRssSamples: samples, snapshotId: snapshot.snapshotId, contentDigest: hash(canonicalSnapshotContent(snapshot)), work };
    process.stdout.write(JSON.stringify(sample));
  } finally { clearInterval(timer); app.close(); }
} else {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "xray-python-cache-measure-"))), script = fileURLToPath(import.meta.url);
  const child = (root: string, data: string, mode: string, files: number): Sample => {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, "--child", root, data, mode, String(files)], { cwd: resolve("."), encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 128 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Measurement child failed: ${result.status ?? "spawn"}`);
    return JSON.parse(result.stdout) as Sample;
  };
  const groups: Array<{ pythonFiles: number; manifestDigest: string; samples: Sample[] }> = [];
  for (const count of [20, 80, 0]) {
    const folder = join(base, `fixture-${count}`), root = join(folder, "source"); mkdirSync(root, { recursive: true }); const manifest: Array<[string, string]> = [];
    for (let i = 0; i < count; i++) {
      const name = `m${String(i).padStart(3, "0")}.py`, next = (i + 1) % count;
      const content = `from m${String(next).padStart(3, "0")} import f as alias\ndef f(x):\n    def inner(value):\n        return value\n    values = [inner(v) for v in x]\n    return alias(values)\n`;
      writeFileSync(join(root, name), content); manifest.push([name, hash(content)]);
    }
    if (!count) { const content = "export function value() { return 1; }\n"; writeFileSync(join(root, "only.ts"), content); manifest.push(["only.ts", hash(content)]); }
    const hot = join(folder, "hot"); child(root, hot, "prime", count); const samples: Sample[] = [];
    for (let pair = 0; pair < 3; pair++) {
      // Alternate order to reduce systematic warm/clock bias. Every invocation is a new process/application.
      for (const mode of pair % 2 ? ["warm", "cold"] : ["cold", "warm"]) {
        const sample = child(root, mode === "warm" ? hot : join(folder, `cold-${pair}`), mode, count);
        if (sample.work.workerRequests !== (count ? mode === "warm" ? 1 : count : 0) || sample.work.hits !== (count && mode === "warm" ? count - 1 : 0)) throw new Error("Actual work-count gate failed");
        samples.push(sample);
      }
    }
    if (new Set(samples.map(s => s.snapshotId)).size !== 1 || new Set(samples.map(s => s.contentDigest)).size !== 1) throw new Error("Cold/warm snapshot equivalence failed");
    groups.push({ pythonFiles: count, manifestDigest: hash(JSON.stringify(manifest)), samples });
  }
  const report = { format: "python-parse-cache-measurement-1", nodeVersion: process.version, platform: process.platform, independentProcessPerSample: true, repeatsPerMode: 3, rssScope: "10ms sampled Node process only; Python children/Electron excluded", cpuScope: "Node process.cpuUsage only; Python children/Electron excluded", oldPreChangeBaselineMeasured: false, materialsRetained: true, groups };
  const file = join(base, "report.json"); writeFileSync(file, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ report: file, groups: groups.map(g => ({ pythonFiles: g.pythonFiles, manifestDigest: g.manifestDigest, samples: g.samples.map(s => ({ mode: s.mode, wallMs: s.wallMs, nodeCpuUserMs: s.nodeCpuUserMs, nodeCpuSystemMs: s.nodeCpuSystemMs, nodeSampledPeakRssBytes: s.nodeSampledPeakRssBytes, workerRequests: s.work.workerRequests, hits: s.work.hits, capturedFiles: s.work.capturedFiles, verifiedFiles: s.work.verifiedFiles, snapshotId: s.snapshotId, contentDigest: s.contentDigest })) })) }, null, 2));
}
