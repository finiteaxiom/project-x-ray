import { describe, expect, it, vi } from "vitest";
import { createProductionWindowsCredentials, WindowsCredentials, type NativeCredentialPort } from "./windows-credentials.js";
function port(): NativeCredentialPort {
  return { variant: "production", status: vi.fn(() => ({ code: "missing" })), write: vi.fn(() => ({ code: "ok" })), remove: vi.fn(() => ({ code: "missing" })), read: vi.fn(() => ({ code: "missing" })) };
}
describe("Windows credential adapter, explicit memory-only native ports", () => {
  it("returns bounded non-secret state, missing and idempotent deletion", () => {
    const native = port(); const adapter = new WindowsCredentials(native);
    expect(adapter.status()).toEqual({ availability: "available", configured: false }); expect(adapter.readInternal()).toEqual({ code: "missing" }); expect(adapter.remove()).toEqual({ code: "ok" });
    native.status = () => ({ code: "ok" }); expect(adapter.status()).toEqual({ availability: "available", configured: true });
  });
  it.each(["ascii", "unicode", "boundary"])("roundtrips %s byte data only through a trusted internal port and zeros temporary buffers", kind => {
    const native = port(); const adapter = new WindowsCredentials(native); let held: Buffer | undefined; let stored: Buffer | undefined; let returned: Buffer | undefined;
    const key = kind === "ascii" ? "fixture-only" : kind === "unicode" ? "测试-🙂" : "x".repeat(2048);
    native.write = bytes => { held = bytes; stored = Buffer.from(bytes); return { code: "ok" }; }; native.read = () => { returned = Buffer.from(stored!); return { code: "ok", value: returned }; };
    expect(adapter.write(key)).toEqual({ code: "ok" }); expect(held!.every(byte => byte === 0)).toBe(true);
    expect(adapter.readInternal()).toEqual({ code: "ok", credential: key }); expect(returned!.every(byte => byte === 0)).toBe(true); stored!.fill(0);
  });
  it.each(["", "x".repeat(2049), "中".repeat(683), "two words", "key\n", "key\0", "key\u0085", "\ud800", "\udc00", "a\ud800b"])("rejects invalid scalar/control/byte input before native (%#)", key => {
    const native = port(); expect(new WindowsCredentials(native).write(key)).toEqual({ code: "invalid" }); expect(native.write).not.toHaveBeenCalled();
  });
  it.each(["invalid-utf8", "surrogate-utf8", "oversize", "empty", "control", "unknown-field", "wrong-code"])("rejects %s native read and still zeros blob", kind => {
    const bytes = kind === "invalid-utf8" ? Buffer.from([0xff]) : kind === "surrogate-utf8" ? Buffer.from([0xed, 0xa0, 0x80]) : kind === "oversize" ? Buffer.alloc(2049, 120) : kind === "empty" ? Buffer.alloc(0) : Buffer.from(kind === "control" ? "key\n" : "fixture-only");
    const native = port(); native.read = () => ({ code: kind === "wrong-code" ? "missing" : "ok", value: bytes, ...(kind === "unknown-field" ? { extra: "not accepted" } : {}) });
    expect(new WindowsCredentials(native).readInternal()).toEqual({ code: "unavailable" }); expect(bytes.every(byte => byte === 0)).toBe(true);
  });
  it("zeros write bytes on throw and unexpected result buffers without forwarding exception data", () => {
    const native = port(); let held: Buffer | undefined; native.write = bytes => { held = bytes; throw new Error("private key and path"); };
    const adapter = new WindowsCredentials(native); expect(adapter.write("fixture-only")).toEqual({ code: "unavailable" }); expect(held!.every(byte => byte === 0)).toBe(true);
    for (const method of ["status", "write", "remove"] as const) { const bytes = Buffer.from("unexpected"); native[method] = () => ({ code: "ok", value: bytes }); adapter[method]("fixture-only"); expect(bytes.every(byte => byte === 0)).toBe(true); }
  });
  it("fails closed for missing/module/test variant and accepts no production options", () => {
    const native = port(); Object.assign(native, { variant: "test" }); const adapter = new WindowsCredentials(native);
    expect(adapter.status()).toEqual({ availability: "unavailable", configured: false }); expect(adapter.readInternal()).toEqual({ code: "unavailable" }); expect(adapter.write("fixture-only")).toEqual({ code: "unavailable" }); expect(adapter.remove()).toEqual({ code: "unavailable" }); expect(native.read).not.toHaveBeenCalled(); expect(native.write).not.toHaveBeenCalled();
    expect(Reflect.apply(createProductionWindowsCredentials, undefined, [{ target: "arbitrary" }]).status()).toEqual({ availability: "unavailable", configured: false });
    expect(new WindowsCredentials(null).readInternal()).toEqual({ code: "unavailable" });
  });
  it("rejects accessors and unknown response codes without invoking getters or returning secret metadata", () => {
    const native = port(); const getter = vi.fn(() => "private"); native.read = () => Object.defineProperty({}, "value", { enumerable: true, get: getter });
    expect(new WindowsCredentials(native).readInternal()).toEqual({ code: "unavailable" }); expect(getter).not.toHaveBeenCalled();
    native.status = () => ({ code: "private failure" }); expect(new WindowsCredentials(native).status()).toEqual({ availability: "unavailable", configured: false });
  });
});
