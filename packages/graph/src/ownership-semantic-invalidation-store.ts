import type Database from "better-sqlite3";
import { RemoteExplanationError, type RemoteFailureCode } from "@project-xray/contracts";
import { OwnershipSemanticTaskStore } from "./ownership-semantic-task-store.js";

type Target = { kind: "all" } | { kind: "owner"; ownerSessionId: string } | { kind: "repository"; repositoryId: string };
/** Internal policy transaction only. Never releases resources/lease, compensates,
 * dispatches, recovers, or changes reserved/completed/other terminal history. */
export function invalidateOwnershipSemanticTasks(db: Database.Database, target: Target, code: RemoteFailureCode): void {
  if (!db.open || !db.inTransaction) throw new RemoteExplanationError("POLICY_INVALID");
  const installed = db.prepare("SELECT 1 FROM schema_migrations WHERE version=17").get();
  if (!installed) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='ownership_semantic_tasks' OR name LIKE 'semantic_task_%'").get()) throw new RemoteExplanationError("POLICY_INVALID");
    return;
  }
  const tasks = new OwnershipSemanticTaskStore(db, "global");
  // Validate all shared state even if the filter happens to select no rows.
  tasks.read("00000000-0000-4000-8000-000000000000");
  const rows = db.prepare("SELECT task_id FROM ownership_semantic_tasks WHERE phase='dispatched'").all() as { task_id: string }[];
  for (const row of rows) {
    const task = tasks.read(row.task_id); if (!task || task.phase !== "dispatched") throw new RemoteExplanationError("POLICY_INVALID");
    if (target.kind === "all" || target.kind === "owner" && task.identity.ownerSessionId === target.ownerSessionId
      || target.kind === "repository" && task.identity.repositoryId === target.repositoryId) tasks.finish(task.identity, code);
  }
}
