import { describe, expect, it, vi } from "vitest";

type PeObservation = Readonly<{
  peStatus: "pe" | "non-pe" | "unknown";
  machine: string | null;
  architecture: "x64" | "x86" | "unknown" | null;
  issue: string | null;
}>;

type PeHeaderRequest = Readonly<{ offset: number; byteLength: 24 }>;

type PeObservationApi = Readonly<{
  derivePeHeaderRange(fileBytes: number, dosHeaderCapture: Uint8Array): PeObservation | PeHeaderRequest;
  observePeHeader(fileBytes: number, request: PeHeaderRequest, peHeaderCapture: Uint8Array): PeObservation;
}>;

const modulePath = "../scripts/windows-artifact-pe-observation.cjs";

function loadApi(): PeObservationApi {
  return require(modulePath) as PeObservationApi;
}

function dosHeader(offset: number): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(offset, 0x3c);
  return bytes;
}

function peHeader(machine: number, signature = "PE\0\0"): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.write(signature, 0, "binary");
  bytes.writeUInt16LE(machine, 4);
  return bytes;
}

function isRequest(value: PeObservation | PeHeaderRequest): value is PeHeaderRequest {
  return "offset" in value;
}

describe("Windows artifact PE header observation", () => {
  it("loads as a pure module and exports only the bounded observation API", () => {
    const childProcess = require("node:child_process") as typeof import("node:child_process");
    const fs = require("node:fs") as typeof import("node:fs");
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    const spawn = vi.spyOn(childProcess, "spawn");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    const processOn = vi.spyOn(process, "on");
    const processOnce = vi.spyOn(process, "once");

    try {
      const api = loadApi();
      expect(Object.keys(api).sort()).toEqual(["derivePeHeaderRange", "observePeHeader"]);
      expect(spawn).not.toHaveBeenCalled();
      expect(readFileSync.mock.calls).toEqual([[resolved, "utf8"]]);
      expect(processOn).not.toHaveBeenCalled();
      expect(processOnce).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([
    { machine: 0x8664, code: "8664", architecture: "x64" },
    { machine: 0x014c, code: "014C", architecture: "x86" },
  ] as const)("requests the full 24-byte PE header and observes $architecture", ({ machine, code, architecture }) => {
    const api = loadApi();
    const range = api.derivePeHeaderRange(88, dosHeader(64));

    expect(range).toEqual({ offset: 64, byteLength: 24 });
    expect(Object.isFrozen(range)).toBe(true);
    if (!isRequest(range)) throw new Error("expected a bounded PE header request");

    expect(api.observePeHeader(88, range, peHeader(machine))).toEqual({
      peStatus: "pe",
      machine: code,
      architecture,
      issue: null,
    });
  });

  it("reports a DOS signature mismatch as non-PE without requesting more bytes", () => {
    const api = loadApi();
    const dos = dosHeader(64);
    dos.write("NZ", 0, "ascii");

    expect(api.derivePeHeaderRange(88, dos)).toEqual({
      peStatus: "non-pe",
      machine: null,
      architecture: null,
      issue: "dos-signature-mismatch",
    });
  });

  it("keeps a syntactically valid but unknown machine code as PE with unknown architecture", () => {
    const api = loadApi();
    const range = api.derivePeHeaderRange(88, dosHeader(64));
    if (!isRequest(range)) throw new Error("expected a bounded PE header request");

    expect(api.observePeHeader(88, range, peHeader(0xaa64))).toEqual({
      peStatus: "pe",
      machine: "AA64",
      architecture: "unknown",
      issue: "unknown-machine",
    });
  });

  it("fails closed as unknown for short DOS/PE captures, bad PE signatures, and invalid offsets", () => {
    const api = loadApi();
    expect(api.derivePeHeaderRange(64, Buffer.alloc(63))).toMatchObject({ peStatus: "unknown", issue: "short-dos-header" });
    expect(api.derivePeHeaderRange(32, Buffer.alloc(32))).toMatchObject({ peStatus: "unknown", issue: "short-dos-header" });
    expect(api.derivePeHeaderRange(88, dosHeader(0))).toMatchObject({ peStatus: "unknown", issue: "invalid-pe-header-offset" });
    expect(api.derivePeHeaderRange(87, dosHeader(64))).toMatchObject({ peStatus: "unknown", issue: "pe-header-range-out-of-file" });

    const range = api.derivePeHeaderRange(88, dosHeader(64));
    if (!isRequest(range)) throw new Error("expected a bounded PE header request");
    expect(api.observePeHeader(88, range, Buffer.alloc(23))).toMatchObject({ peStatus: "unknown", issue: "short-pe-header" });
    expect(api.observePeHeader(88, range, peHeader(0x8664, "PX\0\0"))).toMatchObject({ peStatus: "unknown", issue: "pe-signature-mismatch" });
  });

  it("rejects unsafe file lengths, oversized captures, and captures beyond the explicit file length", () => {
    const api = loadApi();
    expect(() => api.derivePeHeaderRange(Number.MAX_SAFE_INTEGER + 1, dosHeader(64))).toThrowError("invalid-file-length");
    expect(() => api.derivePeHeaderRange(88, Buffer.alloc(65))).toThrowError("invalid-byte-capture-length");
    expect(() => api.derivePeHeaderRange(63, Buffer.alloc(64))).toThrowError("capture-exceeds-file-length");
  });

  it("copies captured inputs and binds the second read to the exact issued range and file length", () => {
    const api = loadApi();
    const dos = dosHeader(64);
    const range = api.derivePeHeaderRange(88, dos);
    dos.writeUInt32LE(0, 0x3c);
    if (!isRequest(range)) throw new Error("expected a bounded PE header request");
    expect(range.offset).toBe(64);

    const capture = peHeader(0x8664);
    const result = api.observePeHeader(88, range, capture);
    capture.fill(0);
    expect(result).toMatchObject({ peStatus: "pe", machine: "8664", architecture: "x64" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => api.observePeHeader(89, range, peHeader(0x8664))).toThrowError("pe-header-request-file-length-mismatch");
    expect(() => api.observePeHeader(88, { ...range }, peHeader(0x8664))).toThrowError("invalid-pe-header-request");
  });

  it("rejects accessor-shaped and proxied captures without invoking their traps", () => {
    const api = loadApi();
    let getterCalls = 0;
    const accessorCapture = Object.defineProperty({}, "length", {
      get: () => {
        getterCalls += 1;
        throw new Error("capture getter must not run");
      },
    });
    let proxyTrapCalls = 0;
    const proxyCapture = new Proxy(Buffer.alloc(64), {
      get: () => {
        proxyTrapCalls += 1;
        throw new Error("capture proxy must not run");
      },
      getPrototypeOf: () => {
        proxyTrapCalls += 1;
        throw new Error("capture proxy must not run");
      },
    });

    expect(() => api.derivePeHeaderRange(88, accessorCapture as unknown as Uint8Array)).toThrowError("invalid-byte-capture");
    expect(() => api.derivePeHeaderRange(88, proxyCapture as unknown as Uint8Array)).toThrowError("invalid-byte-capture");
    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });
});
