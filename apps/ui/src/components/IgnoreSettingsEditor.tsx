import { useEffect, useRef, useState, type ReactElement } from "react";
import { ignoreRulesSchema, type IgnoreSettingsResponse, type ProjectOverview } from "@project-xray/contracts";

export function IgnoreSettingsEditor({ project, indexing, onSaved, reindex, configurationUnavailable = false }: { project: ProjectOverview; indexing: boolean; onSaved: () => Promise<void>; reindex: () => void; configurationUnavailable?: boolean }): ReactElement {
  const [value, setValue] = useState<IgnoreSettingsResponse | null>(null);
  const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const generation = useRef(0); const [reload, setReload] = useState(0);
  useEffect(() => {
    const current = ++generation.current; setValue(null); setDraft(""); setError(""); setNotice(""); setBusy(false);
    void (async () => { try { const result = await window.xray.getIgnoreSettings({ repositoryId: project.repositoryId, snapshotId: project.snapshotId }); if (result.repositoryId !== project.repositoryId || result.snapshotId !== project.snapshotId) throw new Error("配置项目不匹配"); if (generation.current === current) { setValue(result); setDraft(result.settings.rules.join("\n")); } } catch { if (generation.current === current) setError("无法读取项目排除配置；已停止编辑。请刷新后重试。"); } })();
    return () => { generation.current += 1; };
  }, [project.repositoryId, project.snapshotId, reload]);
  const save = async (withIndex: boolean): Promise<void> => {
    if (!value || busy || indexing || configurationUnavailable) return;
    const parsed = ignoreRulesSchema.safeParse(draft.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    if (!parsed.success) { setError("规则无效：仅支持根目录相对路径及 *、?、独立路径段 **；最多 100 条，每条 256 字符。"); return; }
    const current = generation.current; setBusy(true); setError(""); setNotice("");
    try {
      const saved = await window.xray.saveIgnoreSettings({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, expectedRevision: value.settings.revision, rules: parsed.data });
      if (generation.current !== current) return;
      if (saved.repositoryId !== project.repositoryId || saved.snapshotId !== project.snapshotId) throw new Error("配置项目不匹配");
      setValue(saved); setDraft(saved.settings.rules.join("\n")); setNotice(saved.settings.revision === value.settings.revision ? "规则未变化。" : "规则已保存；请重新索引以使用新的排除范围。");
      await onSaved(); if (generation.current === current && withIndex) reindex();
    } catch (reason) { if (generation.current === current) setError(reason instanceof Error ? reason.message : "保存失败，请重试。"); }
    finally { if (generation.current === current) setBusy(false); }
  };
  return <section className="panel" data-testid="ignore-settings"><h3>项目排除规则</h3><p>规则只保存在本机。默认安全排除不可关闭，自定义规则只能追加排除。规则保存后需重新索引；取消或失败可再次更新索引。</p>
    {value && <><details><summary>默认排除规则（不可关闭）</summary><div className="rule-tags">{value.defaultRules.map(rule => <code key={rule}>{rule}</code>)}</div></details>
      <label htmlFor="project-ignore-rules">自定义排除规则（每行一条）</label><textarea id="project-ignore-rules" rows={5} value={draft} disabled={busy || indexing || configurationUnavailable} onChange={event => setDraft(event.target.value)} placeholder={"src/generated/**\n**/*.test.ts"} />
      <p>路径从项目根目录开始，使用 /；* 和 ? 匹配一段路径，** 匹配任意层级。目录可写为 generated/。不支持 ! 重包含或根外路径。</p>
      <p>已保存：{value.settings.rules.join("、") || "无自定义排除"}</p><p>当前快照使用：{value.snapshotPolicy?.rules.join("、") || "默认排除规则"}</p>
      <button className="button secondary" disabled={busy || indexing || configurationUnavailable} onClick={() => void save(false)}>保存规则</button>{" "}<button className="button primary" disabled={busy || indexing || configurationUnavailable} onClick={() => void save(true)}>保存并重新索引</button></>}
    {configurationUnavailable && <p role="alert">项目排除配置无法校验；编辑已停止。历史源码仍可查看。</p>}
    {error && <><p role="alert">{error}</p><button className="button secondary" disabled={busy || indexing} onClick={() => setReload(count => count + 1)}>刷新规则</button></>}{notice && <p role="status">{notice}</p>}
  </section>;
}
