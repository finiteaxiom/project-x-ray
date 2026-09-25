export interface CapturedHunk { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number }
export interface CapturedChange { status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked"; oldPath?: string; newPath?: string; similarity?: number; additions: number; deletions: number; binary: boolean; hunks: CapturedHunk[] }

export function parseNameStatus(raw: string, assertPath: (path: string) => void): Array<Omit<CapturedChange, "additions" | "deletions" | "binary" | "hunks">> {
  const parts = raw.split("\0").filter((item) => item.length > 0); const changes: Array<Omit<CapturedChange, "additions" | "deletions" | "binary" | "hunks">> = [];
  for (let index = 0; index < parts.length;) {
    const token = parts[index++]!; const code = token[0]!; const similarity = token.length > 1 ? Number(token.slice(1)) : undefined; const first = parts[index++];
    if (!first) throw new Error("Git name-status 缺少文件路径"); const second = code === "R" || code === "C" ? parts[index++] : undefined; if ((code === "R" || code === "C") && !second) throw new Error("Git 重命名/复制状态缺少目标路径");
    assertPath(first); if (second) assertPath(second);
    const statusMap: Record<string, CapturedChange["status"]> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "modified" }; const status = statusMap[code] ?? "modified";
    changes.push({ status, ...(status === "added" ? {} : { oldPath: first }), ...(status === "deleted" ? {} : { newPath: second ?? first }), ...(similarity !== undefined && Number.isFinite(similarity) ? { similarity } : {}) });
  }
  return changes;
}

export function splitPatchSections(patch: string): string[] {
  const starts: number[] = []; const pattern = /^diff --git /gm; for (let match = pattern.exec(patch); match; match = pattern.exec(patch)) starts.push(match.index);
  return starts.map((start, index) => patch.slice(start, starts[index + 1] ?? patch.length));
}

export function parsePatch(patch: string): Pick<CapturedChange, "additions" | "deletions" | "binary" | "hunks"> {
  const hunks: CapturedHunk[] = []; let additions = 0; let deletions = 0; let inHunk = false;
  for (const line of patch.split(/\r?\n/)) { const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/); if (match) { inHunk = true; hunks.push({ header: line, oldStart: Number(match[1]), oldLines: Number(match[2] ?? 1), newStart: Number(match[3]), newLines: Number(match[4] ?? 1) }); } else if (inHunk && line.startsWith("+")) additions += 1; else if (inHunk && line.startsWith("-")) deletions += 1; }
  return { additions, deletions, binary: /Binary files|GIT binary patch/.test(patch), hunks };
}

export function attachPatchSections(changes: Array<Omit<CapturedChange, "additions" | "deletions" | "binary" | "hunks">>, patch: string): CapturedChange[] {
  const sections = splitPatchSections(patch); if (sections.length !== changes.length) throw new Error(`Git 文件状态与补丁数量不一致（${changes.length}/${sections.length}），未发布可能混合的比较`);
  return changes.map((change, index) => ({ ...change, ...parsePatch(sections[index]!) }));
}
