import { describe, expect, it, vi } from "vitest";

type Entry = Readonly<{ path: string; file: boolean; unpacked: boolean }>;
type Observation = Readonly<{
  observationStatus: "passed" | "failed";
  failureCode: string | null;
  evidence: Readonly<{ source: "caller-bytes"; scope: "header-only" }>;
  claims: Readonly<{
    snapshot: "incomplete";
    signature: "not-evaluated";
    content: "not-evaluated";
    hash: "not-evaluated";
    sourceIdentity: "not-evaluated";
  }>;
  archiveBytes: number | null;
  sizePickleBytes: number | null;
  headerPickleBytes: number | null;
  counts: Readonly<{ entries: number; directories: number; files: number }>;
  entries: readonly Entry[];
}>;
type Api = Readonly<{
  observeAsarHeader(sizePickle: Uint8Array, headerPickle: Uint8Array, archiveBytes: number): Observation;
}>;
type Pickle = Readonly<{
  writeUInt32(value: number): boolean;
  writeString(value: string): boolean;
  toBuffer(): Buffer;
}>;
type PickleModule = Readonly<{ Pickle: Readonly<{ createEmpty(): Pickle }> }>;
type HeaderNode = Record<string, unknown>;

const modulePath = "../scripts/windows-artifact-asar-header-preflight.cjs";
const repositoryRoot = require("node:path").resolve(__dirname, "../../..") as string;
const asarPackageRoot = require("node:path").join(
  repositoryRoot,
  "node_modules",
  ".pnpm",
  "@electron+asar@3.4.1",
  "node_modules",
  "@electron",
  "asar",
) as string;

function loadApi(): Api {
  return require(modulePath) as Api;
}

function loadProducerPickle(): PickleModule["Pickle"] {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const packageJson = JSON.parse(fs.readFileSync(path.join(asarPackageRoot, "package.json"), "utf8")) as { version?: string };
  if (packageJson.version !== "3.4.1") throw new Error("trusted asar producer version mismatch");
  const entry = path.join(asarPackageRoot, "lib", "pickle.js");
  if (path.relative(repositoryRoot, entry).replace(/\\/gu, "/") !==
      "node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/pickle.js") {
    throw new Error("trusted asar pickle entry mismatch");
  }
  return (require(entry) as PickleModule).Pickle;
}

function producerUInt32(value: number): Buffer {
  const pickle = loadProducerPickle().createEmpty();
  pickle.writeUInt32(value);
  return pickle.toBuffer();
}

function producerString(value: string): Buffer {
  const pickle = loadProducerPickle().createEmpty();
  pickle.writeString(value);
  return pickle.toBuffer();
}

function captureHeaderText(text: string, dataBytes = 0): { sizePickle: Buffer; headerPickle: Buffer; archiveBytes: number } {
  const headerPickle = producerString(text);
  return {
    sizePickle: producerUInt32(headerPickle.length),
    headerPickle,
    archiveBytes: 8 + headerPickle.length + dataBytes,
  };
}

function captureHeader(header: unknown, dataBytes = 0): { sizePickle: Buffer; headerPickle: Buffer; archiveBytes: number } {
  return captureHeaderText(JSON.stringify(header), dataBytes);
}

function rawPickleString(bytes: Buffer): Buffer {
  const padded = bytes.length + ((4 - bytes.length % 4) % 4);
  const payloadSize = 4 + padded;
  const result = Buffer.alloc(4 + payloadSize);
  result.writeUInt32LE(payloadSize, 0);
  result.writeInt32LE(bytes.length, 4);
  bytes.copy(result, 8);
  return result;
}

function makeCapture(headerPickle: Buffer, dataBytes = 0): { sizePickle: Buffer; headerPickle: Buffer; archiveBytes: number } {
  return {
    sizePickle: producerUInt32(headerPickle.length),
    headerPickle,
    archiveBytes: 8 + headerPickle.length + dataBytes,
  };
}

function integrity(): HeaderNode {
  const digest = "a".repeat(64);
  return { algorithm: "SHA256", hash: digest, blockSize: 4 * 1024 * 1024, blocks: [digest] };
}

function packedFile(size: number, offset: string): HeaderNode {
  return { size, offset, integrity: integrity() };
}

function unpackedFile(size: number): HeaderNode {
  return { size, unpacked: true, integrity: integrity() };
}

function emptyFiles(): HeaderNode {
  return Object.create(null) as HeaderNode;
}

function observe(capture: { sizePickle: Buffer; headerPickle: Buffer; archiveBytes: number }): Observation {
  return loadApi().observeAsarHeader(capture.sizePickle, capture.headerPickle, capture.archiveBytes);
}

function expectFailure(result: Observation, code: string): void {
  expect(result.observationStatus).toBe("failed");
  expect(result.failureCode).toBe(code);
  expect(result.counts).toEqual({ entries: 0, directories: 0, files: 0 });
  expect(result.entries).toEqual([]);
}

describe("Windows artifact ASAR header preflight", () => {
  it("loads as a pure module with one bounded observation entry point", () => {
    const childProcess = require("node:child_process") as typeof import("node:child_process");
    const fs = require("node:fs") as typeof import("node:fs");
    const resolved = require.resolve(modulePath) as string;
    delete require.cache[resolved];
    const spawn = vi.spyOn(childProcess, "spawn");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    const processOn = vi.spyOn(process, "on");
    const processOnce = vi.spyOn(process, "once");

    try {
      const api = loadApi();
      expect(Object.keys(api)).toEqual(["observeAsarHeader"]);
      expect(spawn).not.toHaveBeenCalled();
      expect(readFileSync.mock.calls).toEqual([[resolved, "utf8"]]);
      expect(processOn).not.toHaveBeenCalled();
      expect(processOnce).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("uses the installed @electron/asar 3.4.1 pickle producer entry for fixture bytes", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const packageJson = JSON.parse(fs.readFileSync(path.join(asarPackageRoot, "package.json"), "utf8")) as { version?: string };
    const fixture = captureHeader({ files: emptyFiles() });

    expect(packageJson.version).toBe("3.4.1");
    expect(path.relative(repositoryRoot, path.join(asarPackageRoot, "lib", "pickle.js")).replace(/\\/gu, "/"))
      .toBe("node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/pickle.js");
    expect(fixture.sizePickle.length).toBe(8);
    expect(fixture.sizePickle.readUInt32LE(0)).toBe(4);
    expect(fixture.sizePickle.readUInt32LE(4)).toBe(fixture.headerPickle.length);
  });

  it("observes an empty producer-shaped files tree as header-only metadata", () => {
    const result = observe(captureHeader({ files: emptyFiles() }));

    expect(result).toMatchObject({
      observationStatus: "passed",
      failureCode: null,
      evidence: { source: "caller-bytes", scope: "header-only" },
      claims: {
        snapshot: "incomplete",
        signature: "not-evaluated",
        content: "not-evaluated",
        hash: "not-evaluated",
        sourceIdentity: "not-evaluated",
      },
      counts: { entries: 0, directories: 0, files: 0 },
      entries: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.claims)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
  });

  it("preserves Unicode, packed and unpacked files, zero lengths, directory flags, and stable ordering", () => {
    const files = emptyFiles();
    files["zeta.txt"] = packedFile(2, "1");
    files["λ.ts"] = packedFile(1, "0");
    files["empty.bin"] = packedFile(0, "3");
    files["loose.bin"] = unpackedFile(5);
    const unpackedChildren = emptyFiles();
    unpackedChildren["child.dat"] = unpackedFile(1);
    files["目录"] = { unpacked: true, files: unpackedChildren };

    const result = observe(captureHeader({ files }, 3));

    expect(result.observationStatus).toBe("passed");
    expect(result.counts).toEqual({ entries: 6, directories: 1, files: 5 });
    expect(result.entries).toEqual([
      { path: "empty.bin", file: true, unpacked: false },
      { path: "loose.bin", file: true, unpacked: true },
      { path: "zeta.txt", file: true, unpacked: false },
      { path: "λ.ts", file: true, unpacked: false },
      { path: "目录", file: false, unpacked: false },
      { path: "目录/child.dat", file: true, unpacked: true },
    ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  });

  it("accepts constructor and __proto__ as ordinary own file names", () => {
    const files = emptyFiles();
    files["constructor"] = packedFile(0, "0");
    files["__proto__"] = packedFile(0, "0");

    const result = observe(captureHeader({ files }));

    expect(result.observationStatus).toBe("passed");
    expect(result.entries).toEqual([
      { path: "__proto__", file: true, unpacked: false },
      { path: "constructor", file: true, unpacked: false },
    ]);
  });

  it("accepts a path exactly 64 components deep and rejects the next level", () => {
    function deepHeader(depth: number): HeaderNode {
      const files = emptyFiles();
      let current = files;
      for (let index = 0; index < depth; index += 1) {
        const child = emptyFiles();
        current[`d${index}`] = { files: child };
        current = child;
      }
      return { files };
    }

    const accepted = observe(captureHeader(deepHeader(64)));
    expect(accepted.observationStatus).toBe("passed");
    expect(accepted.counts.directories).toBe(64);

    expectFailure(observe(captureHeader(deepHeader(65))), "invalid-path");
  });

  it("enforces the producer path component and full UTF-8 length limits", () => {
    const exactComponent = emptyFiles();
    exactComponent["a".repeat(255)] = packedFile(0, "0");
    expect(observe(captureHeader({ files: exactComponent })).observationStatus).toBe("passed");

    const longComponent = emptyFiles();
    longComponent["a".repeat(256)] = packedFile(0, "0");
    expectFailure(observe(captureHeader({ files: longComponent })), "invalid-path");

    const exactPathFiles = emptyFiles();
    const finalFile = emptyFiles();
    finalFile.c = packedFile(0, "0");
    const middle = emptyFiles();
    middle["b".repeat(255)] = { files: finalFile };
    exactPathFiles["a".repeat(254)] = { files: middle };
    expect(observe(captureHeader({ files: exactPathFiles })).observationStatus).toBe("passed");

    finalFile.cc = packedFile(0, "0");
    expectFailure(observe(captureHeader({ files: exactPathFiles })), "invalid-path");
  });

  it("rejects size and header pickles that disagree with producer framing", () => {
    const good = captureHeader({ files: emptyFiles() });
    const shortSize = { ...good, sizePickle: good.sizePickle.subarray(0, 7) };
    expectFailure(observe(shortSize), "invalid-size-pickle");

    const badSizePayload = Buffer.from(good.sizePickle);
    badSizePayload.writeUInt32LE(8, 0);
    expectFailure(observe({ ...good, sizePickle: badSizePayload }), "invalid-size-pickle");

    const mismatchedSize = Buffer.from(good.sizePickle);
    mismatchedSize.writeUInt32LE(good.headerPickle.length + 4, 4);
    expectFailure(observe({ ...good, sizePickle: mismatchedSize }), "header-size-mismatch");

    const outsideArchive = { ...good, archiveBytes: 8 + good.headerPickle.length - 1 };
    expectFailure(observe(outsideArchive), "header-out-of-bounds");

    const overDeclaredCap = Buffer.from(good.sizePickle);
    overDeclaredCap.writeUInt32LE(8 * 1024 * 1024 + 1, 4);
    expectFailure(observe({ ...good, sizePickle: overDeclaredCap }), "header-size-limit-exceeded");

    const invalidPayload = Buffer.from(good.headerPickle);
    invalidPayload.writeUInt32LE(invalidPayload.readUInt32LE(0) + 4, 0);
    expectFailure(observe(makeCapture(invalidPayload)), "invalid-pickle-layout");
  });

  it("rejects nonzero padding and unconsumed pickle bytes", () => {
    const producer = captureHeader({ files: emptyFiles() });
    const textBytes = Buffer.from("{}", "utf8");
    const raw = rawPickleString(textBytes);
    const stringLength = raw.readInt32LE(4);
    const padIndex = 8 + stringLength;
    expect(padIndex).toBeLessThan(raw.length);
    raw[padIndex] = 1;
    expectFailure(observe(makeCapture(raw)), "invalid-pickle-padding");

    const appended = Buffer.concat([producer.headerPickle, Buffer.alloc(4)]);
    appended.writeUInt32LE(appended.readUInt32LE(0) + 4, 0);
    expectFailure(observe(makeCapture(appended)), "invalid-pickle-layout");
  });

  it("rejects invalid UTF-8, a BOM, malformed JSON, and non-scalar Unicode escapes", () => {
    const prefix = Buffer.from('{"files":{"', "utf8");
    const suffix = Buffer.from('":{}}', "utf8");
    const invalidUtf8 = Buffer.concat([prefix, Buffer.from([0xff]), suffix]);
    expectFailure(observe(makeCapture(rawPickleString(invalidUtf8))), "invalid-header-utf8");

    const bom = rawPickleString(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"files":{}}', "utf8")]));
    expectFailure(observe(makeCapture(bom)), "invalid-json");
    expectFailure(observe(captureHeaderText('{"files":{} trailing}')), "invalid-json");
    expectFailure(observe(captureHeaderText('{"files":{"\\ud800":{}}}')), "invalid-json");
  });

  it("rejects exact and escaped duplicate keys before JSON.parse can overwrite them", () => {
    expectFailure(observe(captureHeaderText('{"files":{"a":{"size":0,"size":0}}}')), "duplicate-json-key");
    expectFailure(observe(captureHeaderText('{"files":{"a":{"size":0,"si\\u007ae":0}}}')), "duplicate-json-key");
    expectFailure(observe(captureHeaderText('{"files":{},"fi\\u006ces":{}}')), "duplicate-json-key");
  });

  it("bounds JSON nesting, value nodes, and decoded string size", () => {
    const deep = "[".repeat(140) + "0" + "]".repeat(140);
    expectFailure(observe(captureHeaderText(deep)), "json-depth-limit-exceeded");

    const manyValues = "[" + "0,".repeat(200000) + "0]";
    expectFailure(observe(captureHeaderText(manyValues)), "json-node-limit-exceeded");

    const largeString = JSON.stringify({ files: { ["x".repeat(4097)]: {} } });
    expectFailure(observe(captureHeaderText(largeString)), "json-string-limit-exceeded");
  });

  it("accepts 5,000 entries and rejects the next entry with no partial DTO", () => {
    function manyEntries(count: number): HeaderNode {
      const files = emptyFiles();
      for (let index = 0; index < count; index += 1) files[`f${String(index).padStart(5, "0")}`] = packedFile(0, "0");
      return { files };
    }

    const accepted = observe(captureHeader(manyEntries(5000)));
    expect(accepted.observationStatus).toBe("passed");
    expect(accepted.counts).toEqual({ entries: 5000, directories: 0, files: 5000 });
    expect(Buffer.byteLength(JSON.stringify(accepted), "utf8")).toBeLessThanOrEqual(32 * 1024 * 1024);

    expectFailure(observe(captureHeader(manyEntries(5001))), "entry-count-limit-exceeded");
  });

  it("rejects links and mixed directory/file shapes explicitly", () => {
    expectFailure(observe(captureHeader({ files: { link: { link: "target" } } })), "unsupported-link");
    expectFailure(observe(captureHeader({ files: { mixed: { files: emptyFiles(), size: 0 } } })), "invalid-directory-shape");
    expectFailure(observe(captureHeader({ files: { malformed: { size: 0, offset: "0" } } })), "invalid-entry-shape");
  });

  it("checks file and integrity fields without claiming that integrity values were verified", () => {
    const noBlocks: HeaderNode = { ...integrity(), blocks: [] };
    expectFailure(observe(captureHeader({ files: { file: { size: 0, offset: "0", integrity: noBlocks } } })), "invalid-integrity");

    const valid = observe(captureHeader({ files: { file: packedFile(0, "0") } }));
    expect(valid.observationStatus).toBe("passed");
    expect(valid.claims.hash).toBe("not-evaluated");
    expect(valid.claims.content).toBe("not-evaluated");
  });

  it("rejects unsafe, noncanonical, out-of-range, and overlapping packed ranges", () => {
    expectFailure(observe(captureHeader({ files: { file: packedFile(-1, "0") } })), "invalid-file-size");
    expectFailure(observe(captureHeader({ files: { file: packedFile(0, "00") } })), "invalid-file-offset");
    expectFailure(observe(captureHeader({ files: { file: packedFile(2, "1") } }, 2)), "packed-range-out-of-bounds");

    const files = emptyFiles();
    files.first = packedFile(3, "0");
    files.second = packedFile(2, "2");
    expectFailure(observe(captureHeader({ files }, 4)), "overlapping-packed-ranges");
  });

  it.each([
    ["../outside", "invalid-path"],
    ["/absolute", "invalid-path"],
    ["C:stream", "invalid-path"],
    ["file:stream", "invalid-path"],
    ["back\\slash", "invalid-path"],
    ["trailing.", "invalid-path"],
    ["CON", "invalid-path"],
  ] as const)("rejects Windows-ambiguous path %s", (name, code) => {
    const files = emptyFiles();
    files[name] = packedFile(0, "0");
    expectFailure(observe(captureHeader({ files })), code);
  });

  it("rejects case-fold collisions across file and directory paths", () => {
    const files = emptyFiles();
    files.Readme = packedFile(0, "0");
    files.readme = packedFile(0, "0");
    expectFailure(observe(captureHeader({ files })), "ambiguous-case-path");
  });

  it("checks all byte caps and caller input types before parsing", () => {
    const good = captureHeader({ files: emptyFiles() });
    expectFailure(observe({ ...good, archiveBytes: 7 }), "invalid-archive-length");
    expectFailure(observe({ ...good, archiveBytes: 2 * 1024 * 1024 * 1024 + 1 }), "archive-size-limit-exceeded");
    expectFailure(loadApi().observeAsarHeader(Buffer.alloc(9), good.headerPickle, good.archiveBytes), "byte-capture-limit-exceeded");
    expectFailure(loadApi().observeAsarHeader(Buffer.alloc(8), Buffer.alloc(8 * 1024 * 1024 + 1), 8 * 1024 * 1024 + 100), "byte-capture-limit-exceeded");
    expectFailure(loadApi().observeAsarHeader({} as Uint8Array, good.headerPickle, good.archiveBytes), "invalid-byte-capture");

    let proxyTraps = 0;
    const proxy = new Proxy(Buffer.alloc(8), {
      get: () => { proxyTraps += 1; throw new Error("capture proxy must not run"); },
      getPrototypeOf: () => { proxyTraps += 1; throw new Error("capture proxy must not run"); },
    });
    expectFailure(loadApi().observeAsarHeader(proxy, good.headerPickle, good.archiveBytes), "invalid-byte-capture");
    expect(proxyTraps).toBe(0);
  });

  it("returns only fixed diagnostics and discards partial entries on late failure", () => {
    const files = emptyFiles();
    files.a = packedFile(0, "0");
    files.z = { link: "secret-project-target" };
    const result = observe(captureHeader({ files }));
    const serialized = JSON.stringify(result);

    expectFailure(result, "unsupported-link");
    expect(serialized).not.toContain("secret-project-target");
    expect(result.evidence).toEqual({ source: "caller-bytes", scope: "header-only" });
  });
});
