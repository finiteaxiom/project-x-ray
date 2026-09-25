import { describe, expect, it } from "vitest";
import { TypeScriptAnalyzer } from "./index.js";

describe("TypeScriptAnalyzer", () => {
  it("提取函数和直接调用", async () => {
    const analyzer = new TypeScriptAnalyzer();
    const result = await analyzer.analyze("C:\\repo\\src\\app.ts", "function a(){ b() } function b(){ return 1 }", {
      rootPath: "C:\\repo",
      repositoryId: "repo",
      snapshotId: "snap",
    });
    expect(result.nodes.filter((node) => node.kind === "function")).toHaveLength(2);
    expect(result.edges.some((edge) => edge.kind === "CALLS" && edge.confidence === "verified")).toBe(true);
  });

  it("使用 TypeChecker 解析跨文件导入、参数流和路由入口", async () => {
    const analyzer = new TypeScriptAnalyzer();
    const result = await analyzer.analyzeProject([
      { absolutePath: "C:\\repo\\service.ts", content: "export const validate = (token: string) => token.length > 2\n" },
      { absolutePath: "C:\\repo\\app.ts", content: "import { validate } from './service'\nlet token = 'abc'\nfunction login(input: string){ token = input; return validate(input) }\napp.post('/login', login)\n" },
    ], { rootPath: "C:\\repo", repositoryId: "repo", snapshotId: "snap" });

    const login = result.nodes.find((node) => node.name === "login");
    const validate = result.nodes.find((node) => node.name === "validate");
    expect(login).toBeDefined();
    expect(validate).toBeDefined();
    expect(result.edges).toContainEqual(expect.objectContaining({ kind: "CALLS", source: login!.id, target: validate!.id, confidence: "verified" }));
    expect(result.edges.some((edge) => edge.kind === "PASSES_TO")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "WRITES")).toBe(true);
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: "endpoint", name: "POST /login" }));
  });

  it("把 React 事件属性记录为推断入口", async () => {
    const analyzer = new TypeScriptAnalyzer();
    const result = await analyzer.analyzeProject([
      { absolutePath: "C:\\repo\\View.tsx", content: "function submit(){}\nconst View = () => <button onClick={submit}>Go</button>\n" },
    ], { rootPath: "C:\\repo", repositoryId: "repo", snapshotId: "snap" });
    const endpoint = result.nodes.find((node) => node.kind === "endpoint" && node.name === "UI onClick");
    const submit = result.nodes.find((node) => node.name === "submit");
    expect(endpoint).toBeDefined();
    expect(result.edges).toContainEqual(expect.objectContaining({ source: endpoint!.id, target: submit!.id, kind: "HANDLES", confidence: "inferred" }));
  });

  it("动态调用只记录表达式，不伪造已确认目标", async () => {
    const analyzer = new TypeScriptAnalyzer();
    const result = await analyzer.analyze("C:\\repo\\dynamic.ts", "function run(target: Function){ return target() }", { rootPath: "C:\\repo", repositoryId: "repo", snapshotId: "snap" });
    expect(result.edges).toContainEqual(expect.objectContaining({ kind: "CALLS", confidence: "unknown", unresolvedTarget: "target" }));
    expect(result.evidence).toContainEqual(expect.objectContaining({ kind: "call-expression", confidence: "unknown" }));
  });
});
