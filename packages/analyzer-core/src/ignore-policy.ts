import { createHash } from "node:crypto";
import { IGNORE_POLICY_VERSION, ignoreRulesSchema, type IgnorePolicy } from "@project-xray/contracts";

export function createIgnorePolicy(rules: string[] = []): IgnorePolicy {
  const normalized = ignoreRulesSchema.parse(rules);
  const hash = createHash("sha256").update(JSON.stringify([IGNORE_POLICY_VERSION, normalized])).digest("hex");
  return { version: IGNORE_POLICY_VERSION, rules: normalized, hash };
}

// Segment matching keeps * and ? inside a path segment; ** alone spans zero or more segments.
export function matchesIgnoreRule(path: string, rule: string): boolean {
  const parts = path.replaceAll("\\", "/").split("/"); const pattern = rule.split("/");
  const memo = new Map<string, boolean>();
  const visit = (i: number, j: number): boolean => {
    const key = `${i}:${j}`; const cached = memo.get(key); if (cached !== undefined) return cached;
    let result: boolean;
    if (j === pattern.length) result = i === parts.length;
    else if (pattern[j] === "**") result = visit(i, j + 1) || (i < parts.length && visit(i + 1, j));
    else { const expression = pattern[j]!.split("").map(char => char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(""); result = i < parts.length && new RegExp(`^${expression}$`, "i").test(parts[i]!) && visit(i + 1, j + 1); }
    memo.set(key, result); return result;
  };
  return visit(0, 0);
}

export function isCustomIgnored(path: string, policy: IgnorePolicy): boolean {
  return policy.rules.some(rule => matchesIgnoreRule(path, rule));
}

export function configurationFingerprint(manifestFingerprint: string, policy: IgnorePolicy): string {
  return createHash("sha256").update(JSON.stringify([manifestFingerprint, policy.hash])).digest("hex");
}
