import { createRequire } from "node:module";
import { join } from "node:path";
import { remoteKeySchema } from "@project-xray/contracts";

export type CredentialState = { availability: "available" | "unavailable"; configured: boolean };
export type CredentialMutation = { code: "ok" | "invalid" | "unavailable" };
export type InternalCredentialRead = { code: "ok"; credential: string } | { code: "missing" | "unavailable" };
/** Trusted worker-only port. Never expose it, its native module, or readInternal via IPC/preload. */
export interface NativeCredentialPort { variant: "production"; status(): unknown; write(bytes: Buffer): unknown; remove(): unknown; read(): unknown }
const unavailable: CredentialState = { availability: "unavailable", configured: false };
function validKey(value: unknown): value is string {
  if (!remoteKeySchema.safeParse(value).success || typeof value !== "string") return false;
  // TextEncoder/Buffer replace lone surrogates; reject them before encoding instead.
  for (const point of value) { const code = point.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) return false; }
  return true;
}
function response(raw: unknown): { code: "ok" | "missing" | "unavailable" | "invalid"; value?: Buffer } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fields = Object.getOwnPropertyDescriptors(raw); if (Object.values(fields).some(field => !Object.hasOwn(field, "value"))) return null;
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "code" && key !== "value") || typeof record.code !== "string" || !["ok", "missing", "unavailable", "invalid"].includes(record.code)) return null;
  if ("value" in record && !Buffer.isBuffer(record.value)) return null;
  return record as { code: "ok" | "missing" | "unavailable" | "invalid"; value?: Buffer };
}
function wipeResponse(raw: unknown): void {
  try { if (raw && typeof raw === "object") for (const field of Object.values(Object.getOwnPropertyDescriptors(raw))) if (Buffer.isBuffer(field.value)) field.value.fill(0); } catch { /* Fixed failure already returned. */ }
}
export class WindowsCredentials {
  constructor(private readonly native: NativeCredentialPort | null) {}
  private usable(): NativeCredentialPort | null { return this.native?.variant === "production" ? this.native : null; }
  status(): CredentialState {
    let raw: unknown;
    try {
      const native = this.usable(); if (!native) return { ...unavailable }; raw = native.status(); const result = response(raw);
      if (!result || result.value || (result.code !== "ok" && result.code !== "missing")) return { ...unavailable };
      return { availability: "available", configured: result.code === "ok" };
    } catch { return { ...unavailable }; } finally { wipeResponse(raw); }
  }
  write(credential: unknown): CredentialMutation {
    let bytes: Buffer | undefined; let raw: unknown;
    try {
      if (!validKey(credential)) return { code: "invalid" }; const native = this.usable(); if (!native) return { code: "unavailable" };
      bytes = Buffer.from(credential, "utf8"); raw = native.write(bytes); const result = response(raw);
      return { code: result && !result.value && result.code === "ok" ? "ok" : "unavailable" };
    } catch { return { code: "unavailable" }; } finally { bytes?.fill(0); wipeResponse(raw); }
  }
  remove(): CredentialMutation {
    let raw: unknown;
    try {
      const native = this.usable(); if (!native) return { code: "unavailable" }; raw = native.remove(); const result = response(raw);
      return { code: result && !result.value && (result.code === "ok" || result.code === "missing") ? "ok" : "unavailable" };
    } catch { return { code: "unavailable" }; } finally { wipeResponse(raw); }
  }
  readInternal(): InternalCredentialRead {
    let raw: unknown; let bytes: Buffer | undefined;
    try {
      const native = this.usable(); if (!native) return { code: "unavailable" }; raw = native.read();
      if (raw && typeof raw === "object") { const value = Object.getOwnPropertyDescriptor(raw, "value")?.value; if (Buffer.isBuffer(value)) bytes = value; }
      const result = response(raw); if (!result) return { code: "unavailable" };
      if (result.code === "missing" && !bytes) return { code: "missing" };
      if (result.code !== "ok" || !bytes || bytes.length < 1 || bytes.length > 2048) return { code: "unavailable" };
      const credential = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      return validKey(credential) ? { code: "ok", credential } : { code: "unavailable" };
    } catch { return { code: "unavailable" }; } finally { bytes?.fill(0); wipeResponse(raw); }
  }
}

/** Fixed production module only, no path/target/platform options or ordinary storage fallback. */
export function createProductionWindowsCredentials(): WindowsCredentials {
  if (arguments.length !== 0 || process.platform !== "win32") return new WindowsCredentials(null);
  try {
    const requireNative = createRequire(__filename);
    const raw: unknown = requireNative(join(__dirname, "native", "windows_credentials.node"));
    if (!raw || typeof raw !== "object") return new WindowsCredentials(null);
    const native = raw as NativeCredentialPort;
    if (native.variant !== "production" || [native.status, native.write, native.remove, native.read].some(method => typeof method !== "function")) return new WindowsCredentials(null);
    return new WindowsCredentials(native);
  } catch { return new WindowsCredentials(null); }
}
