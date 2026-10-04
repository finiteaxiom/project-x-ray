import type Database from "better-sqlite3";
import { types } from "node:util";
import {
  OWNERSHIP_SEMANTIC_POLICY_VERSION, OWNERSHIP_SEMANTIC_POLICY_PROVIDER, OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
  OWNERSHIP_SEMANTIC_PURPOSE, ownershipSemanticAuthorizationSchema, ownershipSemanticGrantCommandSchema,
  ownershipSemanticRevokeCommandSchema, remoteIdSchema, remoteProviderSettingsSchema, remoteTimeSchema, RemoteExplanationError,
  type OwnershipSemanticAuthorization, type OwnershipSemanticGrantCommand, type OwnershipSemanticRevokeCommand,
} from "@project-xray/contracts";
import { remoteStoreFailure, type GraphStoreRole } from "./remote-explanation-store.js";

type Row = { repository_id: string; provider: string; purpose: string; disclosure_version: string; version: string;
  revision: number; status: string; granted_at: string | null; revoked_at: string | null; payload: string };
// All valid commands/records fit below 2KiB under the frozen field schemas.
const MAX_POLICY_BYTES = 4096;
function invalid(): never { throw new RemoteExplanationError("POLICY_INVALID"); }
function capture<T>(raw: T): T {
  const visited = new Set<object>();
  let nodes = 0, bytes = 0;
  const check = (value: unknown, depth = 0): void => {
    if (++nodes > 128 || depth > 8) invalid();
    if (typeof value === "string") { bytes += Buffer.byteLength(value, "utf8"); if (bytes > MAX_POLICY_BYTES) invalid(); }
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object" || types.isProxy(value) || visited.has(value) || Object.getOwnPropertySymbols(value).length ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid();
    visited.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get || descriptor.set || !descriptor.enumerable && !(Array.isArray(value) && key === "length")) invalid();
      check(descriptor.value, depth + 1);
    }
    visited.delete(value);
  };
  check(raw); return structuredClone(raw);
}

/** Internal persistence only. No user-action proof, dispatch permit, lease or transport. */
export class OwnershipSemanticPolicyStore {
  #closed = false;
  constructor(private readonly db: Database.Database, private readonly role: GraphStoreRole) {}
  migrate(): void {
    try {
      if (this.role === "project") return;
      this.open();
      this.db.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS ownership_semantic_authorizations (
          repository_id TEXT NOT NULL, provider TEXT NOT NULL, purpose TEXT NOT NULL, disclosure_version TEXT NOT NULL,
          version TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991),
          status TEXT NOT NULL CHECK(status IN ('denied','granted')), granted_at TEXT, revoked_at TEXT, payload TEXT NOT NULL,
          PRIMARY KEY(repository_id,provider,purpose,disclosure_version)
        )`);
        this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(13,?)").run(new Date().toISOString());
      }).immediate();
    } catch (error) { throw remoteStoreFailure(error); }
  }
  close(): void { this.#closed = true; }
  private open(): void { if (this.#closed || !this.db.open || this.role !== "global") invalid(); }
  private key(repositoryId: string): readonly string[] {
    return [repositoryId, OWNERSHIP_SEMANTIC_POLICY_PROVIDER, OWNERSHIP_SEMANTIC_PURPOSE, OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION];
  }
  private read(repositoryId: string): OwnershipSemanticAuthorization {
    const row = this.db.prepare("SELECT * FROM ownership_semantic_authorizations WHERE repository_id=? AND provider=? AND purpose=? AND disclosure_version=?").get(...this.key(repositoryId)) as Row | undefined;
    if (!row) return { version: OWNERSHIP_SEMANTIC_POLICY_VERSION, repositoryId, provider: OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
      purpose: OWNERSHIP_SEMANTIC_PURPOSE, disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
      revision: 0, status: "denied", categories: [], grantedAt: null, revokedAt: null };
    if (typeof row.payload !== "string" || Buffer.byteLength(row.payload, "utf8") > MAX_POLICY_BYTES) invalid();
    const record = ownershipSemanticAuthorizationSchema.parse(JSON.parse(row.payload));
    if (record.repositoryId !== repositoryId || row.repository_id !== record.repositoryId || row.provider !== record.provider ||
      row.purpose !== record.purpose || row.disclosure_version !== record.disclosureVersion || row.version !== record.version ||
      row.revision !== record.revision || row.status !== record.status || row.granted_at !== record.grantedAt || row.revoked_at !== record.revokedAt) invalid();
    return record;
  }
  load(repositoryId: string): OwnershipSemanticAuthorization {
    try { this.open(); remoteIdSchema.parse(repositoryId); return this.read(repositoryId); }
    catch (error) { throw remoteStoreFailure(error); }
  }
  private nextRevision(old: OwnershipSemanticAuthorization, expected: number): number {
    if (old.revision !== expected || old.revision === Number.MAX_SAFE_INTEGER) throw new RemoteExplanationError("REVISION_CONFLICT");
    return old.revision + 1;
  }
  private providerRevision(): number {
    // Same authoritative global SQLite connection, never a caller-supplied provider DTO.
    const row = this.db.prepare("SELECT payload FROM remote_provider_settings WHERE id=1").get() as { payload: string } | undefined;
    if (row && (typeof row.payload !== "string" || Buffer.byteLength(row.payload, "utf8") > MAX_POLICY_BYTES)) invalid();
    return row ? remoteProviderSettingsSchema.parse(JSON.parse(row.payload)).revision : 0;
  }
  private time(old: OwnershipSemanticAuthorization): string {
    const now = remoteTimeSchema.parse(new Date().toISOString());
    const previous = old.revokedAt ?? old.grantedAt;
    if (!Number.isFinite(Date.parse(now)) || previous !== null && (!Number.isFinite(Date.parse(previous)) || Date.parse(now) < Date.parse(previous))) invalid();
    return now;
  }
  private write(next: OwnershipSemanticAuthorization): OwnershipSemanticAuthorization {
    const record = ownershipSemanticAuthorizationSchema.parse(next);
    this.db.prepare(`INSERT INTO ownership_semantic_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(repository_id,provider,purpose,disclosure_version) DO UPDATE SET
      version=excluded.version,revision=excluded.revision,status=excluded.status,granted_at=excluded.granted_at,
      revoked_at=excluded.revoked_at,payload=excluded.payload`).run(...this.key(record.repositoryId), record.version,
      record.revision, record.status, record.grantedAt, record.revokedAt, JSON.stringify(record));
    const stored = this.read(record.repositoryId);
    if (JSON.stringify(stored) !== JSON.stringify(record)) invalid();
    return stored;
  }
  grant(raw: OwnershipSemanticGrantCommand): OwnershipSemanticAuthorization {
    try {
      this.open(); const command = ownershipSemanticGrantCommandSchema.parse(capture(raw));
      return this.db.transaction(() => {
        const old = this.read(command.repositoryId), revision = this.nextRevision(old, command.expectedRevision);
        if (this.providerRevision() !== command.expectedProviderRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
        return this.write({ ...old, revision, status: "granted", categories: command.categories, grantedAt: this.time(old), revokedAt: null });
      }).immediate();
    } catch (error) { throw remoteStoreFailure(error); }
  }
  revoke(raw: OwnershipSemanticRevokeCommand): OwnershipSemanticAuthorization {
    try {
      this.open(); const command = ownershipSemanticRevokeCommandSchema.parse(capture(raw));
      return this.db.transaction(() => {
        const old = this.read(command.repositoryId), revision = this.nextRevision(old, command.expectedRevision);
        return this.write({ ...old, revision, status: "denied", categories: [], revokedAt: old.grantedAt === null ? null : this.time(old) });
      }).immediate();
    } catch (error) { throw remoteStoreFailure(error); }
  }
}
