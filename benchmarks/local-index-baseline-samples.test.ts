import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getBaselineSample,
  getGeneratedSampleContent,
  MEDIUM_FILE_COUNT,
  MEDIUM_GENERATOR_VERSION,
  MEDIUM_MAX_FILE_BYTES,
  MEDIUM_MAX_TOTAL_BYTES,
  MEDIUM_PYTHON_FILE_COUNT,
  MEDIUM_SAMPLE_ID,
  MEDIUM_SAMPLE_MANIFEST_SHA256,
  MEDIUM_TYPE_SCRIPT_FILE_COUNT,
  SMALL_SAMPLE_ID,
} from "./local-index-baseline-samples.ts";

describe("local index baseline sample registry", () => {
  it("keeps the original small sample manifest unchanged", () => {
    const small = getBaselineSample("small");
    expect(small).toMatchObject({
      id: SMALL_SAMPLE_ID,
      manifestSha256: "349b98cad20599c35920c5cc3c37aa7d703e4c5410bd49ce1eab86dd634b33c9",
      totalBytes: 307,
    });
    expect(small?.files).toEqual([
      { path: "src/auth.ts", language: "TypeScript", bytes: 146, sha256: "19256989f7e619fa37dee1d2400619a922d8c450867e221bb05a0c5db27f1b5d" },
      { path: "src/validation.ts", language: "TypeScript", bytes: 80, sha256: "3e7980d05fe47137aaac04b76832f0f30ead18f1c7ce101aded9da6623db3722" },
      { path: "worker.py", language: "Python", bytes: 81, sha256: "c4419c8bd43fbc7a768998a9f8ee94d092a91acae1ea1bb89fdd811bc184a8a6" },
    ]);
  });

  it("pins a deterministic bounded 96 TypeScript and 32 Python import/call chains", () => {
    const medium = getBaselineSample("medium");
    expect(medium).toBeDefined();
    expect(medium).toMatchObject({ id: MEDIUM_SAMPLE_ID, generatorVersion: MEDIUM_GENERATOR_VERSION, manifestSha256: MEDIUM_SAMPLE_MANIFEST_SHA256 });
    expect(medium?.files).toHaveLength(MEDIUM_FILE_COUNT);
    expect(medium?.files.filter((file) => file.language === "TypeScript")).toHaveLength(MEDIUM_TYPE_SCRIPT_FILE_COUNT);
    expect(medium?.files.filter((file) => file.language === "Python")).toHaveLength(MEDIUM_PYTHON_FILE_COUNT);
    expect(new Set(medium?.files.map((file) => file.path)).size).toBe(MEDIUM_FILE_COUNT);
    expect(medium?.files.every((file) => /^(src\/ts\/step-\d{3}\.ts|src\/python\/step_\d{3}\.py)$/.test(file.path))).toBe(true);
    expect(medium?.files.every((file) => file.bytes <= MEDIUM_MAX_FILE_BYTES)).toBe(true);
    expect(medium?.totalBytes).toBeLessThanOrEqual(MEDIUM_MAX_TOTAL_BYTES);
    expect(medium?.totalBytes).toBe(medium?.files.reduce((total, file) => total + file.bytes, 0));
    for (const file of medium!.files) {
      const content = getGeneratedSampleContent(MEDIUM_SAMPLE_ID, file.path)!;
      expect(Buffer.byteLength(content, "utf8")).toBe(file.bytes);
      expect(createHash("sha256").update(content).digest("hex")).toBe(file.sha256);
    }

    for (let index = 0; index < MEDIUM_TYPE_SCRIPT_FILE_COUNT; index += 1) {
      const name = "step" + String(index).padStart(3, "0");
      const path = "src/ts/step-" + String(index).padStart(3, "0") + ".ts";
      const content = getGeneratedSampleContent(MEDIUM_SAMPLE_ID, path)!;
      expect(content.match(/export function /g)).toHaveLength(1);
      if (index < MEDIUM_TYPE_SCRIPT_FILE_COUNT - 1) {
        const next = "step" + String(index + 1).padStart(3, "0");
        expect(content).toContain("import { " + next + " } from \"./step-" + String(index + 1).padStart(3, "0") + "\";");
        expect(content).toContain("return " + next + "(value);");
      } else expect(content).toContain("return value + 1;");
      expect(content).toContain("export function " + name + "(");
    }
    for (let index = 0; index < MEDIUM_PYTHON_FILE_COUNT; index += 1) {
      const name = "step_" + String(index).padStart(3, "0");
      const content = getGeneratedSampleContent(MEDIUM_SAMPLE_ID, "src/python/" + name + ".py")!;
      expect(content.match(/^def /gm)).toHaveLength(1);
      if (index < MEDIUM_PYTHON_FILE_COUNT - 1) {
        const next = "step_" + String(index + 1).padStart(3, "0");
        expect(content).toContain("from ." + next + " import " + next);
        expect(content).toContain("return " + next + "(value)");
      } else expect(content).toContain("return value + 1");
      expect(content).toContain("def " + name + "(");
    }
    expect(getGeneratedSampleContent(MEDIUM_SAMPLE_ID, "../outside.ts")).toBeUndefined();
    expect(getGeneratedSampleContent("unregistered-sample", "src/ts/step-000.ts")).toBeUndefined();
  });
});
