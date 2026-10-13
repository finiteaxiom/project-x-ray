// Actual Windows/PowerShell/HANDLE tests. Run only in root's technical validation window.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync, lstatSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

type Summary = Readonly<{
  version: 1;
  status: string;
  ready: boolean;
  created: boolean;
  snapshotStatus: string;
  signatureStatus: string;
  failureCode: string | null;
  releaseStatus: string;
  releaseFailureCode: string | null;
  released: boolean;
  identityProof: string | null;
  parentHandleCount: number;
  registeredHandleCount: number;
  remainingHandleCount: number;
  borrowedInputHandleCount: number;
  applicationRootExcluded: boolean;
  aclVerified: boolean;
  ownerVerified: boolean;
  daclPresent: boolean;
  daclProtected: boolean;
  aclAceCount: number;
}>;

type Probe = Readonly<{
  fixtureStatus: string;
  fixtureFailureStage:
    | "setup"
    | "acl-before"
    | "open-portable"
    | "mutate-input-identity"
    | "open-application"
    | "new-output"
    | "summary"
    | "rename-check"
    | "delete-check"
    | "close-output"
    | "reopen-after-release"
    | "acl-after"
    | "release-output"
    | "release-application"
    | "release-portable"
    | null;
  opened: Summary | null;
  closed: Summary | null;
  faultReached: boolean;
  renameBlockedWhileHeld: boolean | null;
  deleteBlockedWhileHeld: boolean | null;
  reopenedAfterRelease: boolean;
  inputSessionsStillHeld: boolean;
  existingAclUnchanged: boolean | null;
}>;

type Inputs = Readonly<{ root: string; app: string; portable: string; wrongInput: string }>;

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const helper = join(desktop, "scripts/test-fixtures/windows-artifact-output-directory-probe.ps1");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

function makeInputs(prefix: string): Inputs {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const app = join(root, "application-root");
  const wrongInput = join(root, "other-directory");
  const portable = join(root, "portable input.asar");
  mkdirSync(app);
  mkdirSync(wrongInput);
  writeFileSync(portable, "M8 self-owned fixture bytes\n", "utf8");
  return { root, app, portable, wrongInput };
}

function runProbe(mode: string, outputPath: string, inputs: Inputs): { probe: Probe; stdout: string } {
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-Mode",
      mode,
      "-OutputPath",
      outputPath,
      "-PortablePath",
      inputs.portable,
      "-ApplicationDirectoryPath",
      inputs.app,
      "-WrongInputDirectoryPath",
      inputs.wrongInput,
    ],
    { cwd: desktop, encoding: "utf8", timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) throw new Error("PowerShell fixture could not start");
  if (result.status !== 0) throw new Error("PowerShell fixture exited before returning its fixed result");
  const lines = (result.stdout ?? "").trim().split(/\r?\n/);
  const output = lines[lines.length - 1];
  if (!output) throw new Error("PowerShell fixture returned no result");
  return { probe: JSON.parse(output) as Probe, stdout: result.stdout ?? "" };
}

windowsDescribe("M8 private output directory HANDLE behavior", () => {
  it("creates a Unicode directory with exact handle-verified ACL, holds it against rename, then releases and reopens", () => {
    const inputs = makeInputs("xray-m8-create-");
    const outputPath = join(inputs.root, "private-output-雪");
    const result = runProbe("ordinary", outputPath, inputs);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.opened).toMatchObject({
      status: "ready",
      ready: true,
      created: true,
      failureCode: null,
      snapshotStatus: "incomplete",
      signatureStatus: "not-evaluated",
      aclVerified: true,
      ownerVerified: true,
      daclPresent: true,
      daclProtected: true,
      applicationRootExcluded: true,
    });
    expect(result.probe.opened?.aclAceCount).toBeGreaterThanOrEqual(1);
    expect(result.probe.opened?.aclAceCount).toBeLessThanOrEqual(2);
    expect(result.probe.opened?.identityProof).toMatch(/^[0-9A-F]{64}$/);
    expect(result.probe.renameBlockedWhileHeld).toBe(true);
    expect(result.probe.deleteBlockedWhileHeld).toBe(true);
    expect(result.probe.closed).toMatchObject({ status: "released", ready: false, releaseStatus: "released", released: true });
    expect(result.probe.reopenedAfterRelease).toBe(true);
    expect(result.probe.inputSessionsStillHeld).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    expect(result.stdout).not.toContain(outputPath);
    expect(result.stdout).not.toMatch(/S-1-\d/);
  }, 60000);

  it("rejects a target whose parent chain contains the application input root", () => {
    const inputs = makeInputs("xray-m8-overlap-");
    const outputPath = join(inputs.app, "private-output");
    const result = runProbe("overlap", outputPath, inputs);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "OUTPUT_OVERLAP" });
    expect(result.probe.closed?.releaseStatus).toBe("released");
    expect(existsSync(outputPath)).toBe(false);
    expect(result.probe.inputSessionsStillHeld).toBe(true);
  }, 60000);

  it("rejects a parent reparse point before creating beneath it", () => {
    const inputs = makeInputs("xray-m8-parent-link-");
    const outsideParent = join(inputs.root, "linked-parent-target");
    const junction = join(inputs.root, "linked-parent");
    mkdirSync(outsideParent);
    symlinkSync(outsideParent, junction, "junction");
    const outputPath = join(junction, "private-output");
    const result = runProbe("parent-link", outputPath, inputs);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "REPARSE_REJECTED" });
    expect(result.probe.closed?.releaseStatus).toBe("released");
    expect(existsSync(join(outsideParent, "private-output"))).toBe(false);
  }, 60000);

  it.each(["existing-directory", "existing-file"] as const)("leaves an existing %s and its ACL unchanged", (mode) => {
    const inputs = makeInputs("xray-m8-existing-");
    const outputPath = join(inputs.root, "already-owned");
    const marker = join(outputPath, "unknown-user-material");
    const original = Buffer.from("preserve this fixture exactly\n", "utf8");
    if (mode === "existing-directory") {
      mkdirSync(outputPath);
      writeFileSync(marker, original);
    } else {
      writeFileSync(outputPath, original);
    }
    const identityBefore = statSync(outputPath);
    const bytesBefore = mode === "existing-file" ? readFileSync(outputPath) : readFileSync(marker);
    const result = runProbe(mode, outputPath, inputs);
    const identityAfter = statSync(outputPath);
    const bytesAfter = mode === "existing-file" ? readFileSync(outputPath) : readFileSync(marker);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "TARGET_CREATE_REJECTED" });
    expect(result.probe.closed?.releaseStatus).toBe("released");
    expect(result.probe.existingAclUnchanged).toBe(true);
    expect(identityAfter.ino).toBe(identityBefore.ino);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
  }, 60000);

  it("rejects an existing junction without replacing or following it", () => {
    const inputs = makeInputs("xray-m8-existing-link-");
    const outputPath = join(inputs.root, "already-linked");
    symlinkSync(inputs.app, outputPath, "junction");
    const linkBefore = readlinkSync(outputPath);
    const identityBefore = lstatSync(outputPath);
    const result = runProbe("existing-link", outputPath, inputs);
    const identityAfter = lstatSync(outputPath);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "TARGET_CREATE_REJECTED" });
    expect(lstatSync(outputPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(outputPath)).toBe(linkBefore);
    expect(identityAfter.ino).toBe(identityBefore.ino);
  }, 60000);

  it("rejects invalid paths and sessions whose portable input is a directory", () => {
    const inputs = makeInputs("xray-m8-inputs-");
    const invalid = runProbe("ordinary", "C:relative-output", inputs);
    expect(invalid.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "OUTPUT_PATH_REJECTED" });

    const wrong = runProbe("wrong-input", join(inputs.root, "should-not-exist"), inputs);
    expect(wrong.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "TYPE_REJECTED" });
    expect(existsSync(join(inputs.root, "should-not-exist"))).toBe(false);
  }, 120000);

  it("rejects a borrowed input session whose saved identity disagrees with the live HANDLE", () => {
    const inputs = makeInputs("xray-m8-wrong-identity-");
    const outputPath = join(inputs.root, "identity-mismatch-output");
    const result = runProbe("wrong-identity", outputPath, inputs);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.opened).toMatchObject({ ready: false, created: false, failureCode: "OUTPUT_IDENTITY_REJECTED" });
    expect(existsSync(outputPath)).toBe(false);
    expect(result.probe.inputSessionsStillHeld).toBe(true);
  }, 60000);

  it.each([
    ["native-create-failure", "TARGET_CREATE_REJECTED"],
    ["acl-query-failure", "ACL_QUERY_FAILED"],
    ["extra-ace", "OUTPUT_ACL_ACE_COUNT_REJECTED"],
    ["null-dacl", "OUTPUT_ACL_DACL_REJECTED"],
  ] as const)("fails closed with retained identity and release evidence for %s", (mode, failureCode) => {
    const inputs = makeInputs("xray-m8-failure-");
    const outputPath = join(inputs.root, "failure-output");
    const result = runProbe(mode, outputPath, inputs);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.faultReached).toBe(true);
    expect(result.probe.opened).toMatchObject({ ready: false, failureCode });
    expect(result.probe.closed?.ready).toBe(false);
    expect(result.probe.closed?.releaseStatus).toBe("released");
    expect(result.probe.closed?.released).toBe(true);
    if (mode === "native-create-failure") {
      expect(result.probe.closed?.created).toBe(false);
      expect(existsSync(outputPath)).toBe(false);
    } else {
      expect(result.probe.closed?.created).toBe(true);
      expect(result.probe.closed?.identityProof).toMatch(/^[0-9A-F]{64}$/);
      expect(existsSync(outputPath)).toBe(true);
    }
  }, 60000);

  it("never reports ready or released when a registered handle close is unconfirmed", () => {
    const inputs = makeInputs("xray-m8-close-failure-");
    const outputPath = join(inputs.root, "close-failure-output");
    const result = runProbe("close-failure", outputPath, inputs);

    expect(result.probe.fixtureStatus).toBe("completed");
    expect(result.probe.faultReached).toBe(true);
    expect(result.probe.opened?.ready).toBe(true);
    expect(result.probe.closed).toMatchObject({
      status: "rejected",
      ready: false,
      failureCode: "HANDLE_CLOSE_UNCONFIRMED",
      releaseStatus: "unconfirmed",
      releaseFailureCode: "HANDLE_CLOSE_UNCONFIRMED",
      released: false,
    });
    expect(result.probe.closed?.remainingHandleCount).toBeGreaterThan(0);
  }, 60000);
});
