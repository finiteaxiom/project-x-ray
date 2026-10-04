import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type ReaderError = Error & {
  code: string;
  cleanupSafe: boolean;
  processStarted: boolean;
  closeConfirmed: boolean;
  exitCode: number | null;
  signal: string | null;
  priorCode: string | null;
  testOnlyCloseObservationSuppressed: boolean;
};
type ReadyPayload = Readonly<Record<string, unknown>>;
type ConsumerContext = Readonly<{ protocolVersion: 1; runId: string; token: string; signal: AbortSignal }>;
type Launch = Readonly<{ executable: string; fixedArgs: readonly string[]; helperPath: string; cwd: string }>;
type ReaderOptions = Readonly<{ signal?: AbortSignal; timeoutMs?: number; readyTimeoutMs?: number; closeTimeoutMs?: number; testOnlyDeferCloseConfirmation?: boolean }>;
type ReaderResult = Readonly<{
  status: "released";
  runId: string;
  ready: ReadyPayload;
  processStarted: true;
  exitCode: 0;
  signal: null;
  closeConfirmed: true;
  cleanupSafe: true;
  testOnlyCloseObservationSuppressed: false;
}>;
type ProcessApi = {
  LIMITS: Readonly<Record<string, number>>;
  OwnedReaderProcessError: new (code: string, details?: Readonly<Record<string, unknown>>) => ReaderError;
  withOwnedReaderProcess(
    trustedLaunch: Launch,
    input: Readonly<Record<string, unknown>>,
    consumeReady: (ready: ReadyPayload, context: ConsumerContext) => unknown | Promise<unknown>,
    options?: ReaderOptions,
  ): Promise<ReaderResult>;
};

const cwd = resolve(process.cwd());
const desktopRoot = basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
  ? cwd
  : join(cwd, "apps", "desktop");
const fixturePath = join(desktopRoot, "scripts", "test-fixtures", "windows-artifact-reader-child.cjs");
const processModulePath = join(desktopRoot, "scripts", "windows-artifact-reader-process.cjs");
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const processApi = requireFromDesktop("./scripts/windows-artifact-reader-process.cjs") as ProcessApi;

function launch(helperPath = fixturePath, fixedArgs: readonly string[] = []): Launch {
  return Object.freeze({ executable: process.execPath, fixedArgs, helperPath, cwd: desktopRoot });
}

function launchWithExecutable(executable: string): Launch {
  return Object.freeze({ ...launch(), executable });
}

function runMode(
  mode: string,
  consumeReady: (ready: ReadyPayload, context: ConsumerContext) => unknown | Promise<unknown> = () => undefined,
  options: ReaderOptions = {},
): Promise<ReaderResult> {
  return processApi.withOwnedReaderProcess(launch(), { mode }, consumeReady, {
    timeoutMs: 5_000,
    readyTimeoutMs: 2_000,
    ...options,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function deferred<T>() {
  let resolveValue!: (value: T | PromiseLike<T>) => void;
  let rejectValue!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolveValue = resolvePromise; rejectValue = rejectPromise; });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

async function rejected(promise: Promise<unknown>): Promise<ReaderError> {
  try {
    await promise;
  } catch (error) {
    return error as ReaderError;
  }
  throw new Error("Expected the reader process operation to reject");
}

function runImportCheck(): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; closeConfirmed: boolean }> {
  const env = process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [fixturePath, "--import-check", processModulePath], {
      cwd: desktopRoot,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let closed = false;
    const timer = setTimeout(() => {
      if (!closed) child.kill();
    }, 5_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on("error", () => {
      clearTimeout(timer);
      rejectResult(new Error("IMPORT_CHECK_CHILD_FAILED"));
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      resolveResult({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), code, signal, closeConfirmed: true });
    });
  });
}

describe("windows artifact reader owned process boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("imports with no spawn, filesystem read, or output side effect", async () => {
    const result = await runImportCheck();
    expect(result).toEqual({ stdout: "IMPORT_CLEAN\n", stderr: "", code: 0, signal: null, closeConfirmed: true });
  }, 10_000);

  it("keeps the real child alive through consumer work, then releases and observes exit plus close", async () => {
    const entered = deferred<{ ready: ReadyPayload; context: ConsumerContext }>();
    const gate = deferred<void>();
    const session = runMode("normal", (ready, context) => {
      entered.resolve({ ready, context });
      return gate.promise;
    });
    const { ready, context } = await entered.promise;
    expect(ready).toEqual({ state: "fixture-ready" });
    expect(Object.isFrozen(ready)).toBe(true);
    expect(context.protocolVersion).toBe(1);
    expect(context.runId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(context.token).toMatch(/^[A-Za-z0-9_-]{24,64}$/u);
    expect(context.signal.aborted).toBe(false);
    let settled = false;
    void session.then(() => { settled = true; }, () => { settled = true; });
    await delay(60);
    expect(settled).toBe(false);
    gate.resolve();
    const result = await session;
    expect(result).toMatchObject({ status: "released", processStarted: true, exitCode: 0, signal: null, closeConfirmed: true, cleanupSafe: true });
    expect(result).not.toHaveProperty("manifest");
    expect(result).not.toHaveProperty("scan");
  }, 10_000);

  it("parses a valid ready frame split across real stdout chunks", async () => {
    const result = await runMode("split-ready");
    expect(result.ready).toEqual({ state: "fixture-ready" });
    expect(result.closeConfirmed).toBe(true);
  }, 10_000);

  it("keeps the caller control value on stdin instead of child argv", async () => {
    const marker = "C:\\artifact\\synthetic-control-marker.bin";
    const result = await processApi.withOwnedReaderProcess(launch(), { mode: "input-placement", controlPath: marker }, () => undefined, {
      timeoutMs: 5_000,
      readyTimeoutMs: 2_000,
    });
    expect(result.ready).toEqual({ controlPathWasJsonInput: true, controlPathAppearedInArgv: false });
    expect(result.closeConfirmed).toBe(true);
  }, 10_000);

  it("accepts the exact stdout and stderr byte limits", async () => {
    const stdout = await runMode("stdout-boundary");
    const stderr = await runMode("stderr-boundary");
    expect(stdout.closeConfirmed).toBe(true);
    expect(stderr.closeConfirmed).toBe(true);
  }, 15_000);

  it.each([
    ["stdout-overflow", "STDOUT_LIMIT"],
    ["stderr-overflow", "STDERR_LIMIT"],
  ])("terminates the owned child when %s crosses its byte limit", async (mode, code) => {
    const error = await rejected(runMode(mode));
    expect(error).toMatchObject({ code, processStarted: true, closeConfirmed: true, cleanupSafe: true });
    expect(error.message).not.toContain("FIXTURE");
  }, 10_000);

  it("does not spawn when the caller is already aborted", async () => {
    const error = await rejected(processApi.withOwnedReaderProcess(
      launchWithExecutable(join(desktopRoot, "does-not-exist-reader-exe.exe")),
      { mode: "normal" },
      () => undefined,
      { signal: AbortSignal.abort() },
    ));
    expect(error).toMatchObject({ code: "CANCELLED_BEFORE_SPAWN", processStarted: false, closeConfirmed: false, cleanupSafe: true });
  });

  it("cancels a ready session, aborts its consumer signal, and confirms child close", async () => {
    const controller = new AbortController();
    const entered = deferred<AbortSignal>();
    const errorPromise = rejected(runMode("normal", (_ready, context) => {
      entered.resolve(context.signal);
      return new Promise<void>(() => undefined);
    }, { signal: controller.signal }));
    const consumerSignal = await entered.promise;
    controller.abort();
    const error = await errorPromise;
    expect(consumerSignal.aborted).toBe(true);
    expect(error).toMatchObject({ code: "CANCELLED", processStarted: true, closeConfirmed: true, cleanupSafe: true });
  }, 10_000);

  it("preserves fixed consumer failure information after terminating and closing the child", async () => {
    const error = await rejected(runMode("normal", () => {
      throw new processApi.OwnedReaderProcessError("CHILD_IO_ERROR", { cleanupSafe: true });
    }));
    expect(error).toMatchObject({ code: "CONSUMER_FAILED", priorCode: "CHILD_IO_ERROR", closeConfirmed: true, cleanupSafe: true });
  }, 10_000);

  it("bounds readiness and the total session deadline", async () => {
    const readyError = await rejected(runMode("no-ready", undefined, { readyTimeoutMs: 350, timeoutMs: 2_000 }));
    expect(readyError).toMatchObject({ code: "READY_TIMEOUT", closeConfirmed: true, cleanupSafe: true });

    const entered = deferred<void>();
    const deadlineErrorPromise = rejected(runMode("normal", () => {
      entered.resolve();
      return new Promise<void>(() => undefined);
    }, { timeoutMs: 1_500, readyTimeoutMs: 1_000 }));
    await Promise.race([entered.promise, deadlineErrorPromise.then((error) => { throw error; })]);
    const deadlineError = await deadlineErrorPromise;
    expect(deadlineError).toMatchObject({ code: "DEADLINE_EXCEEDED", closeConfirmed: true, cleanupSafe: true });
  }, 10_000);

  it("reports spawn failure with a fixed code and no process cleanup claim", async () => {
    const error = await rejected(processApi.withOwnedReaderProcess(
      launchWithExecutable(join(desktopRoot, "does-not-exist-reader-exe.exe")),
      { mode: "normal" },
      () => undefined,
    ));
    expect(error).toMatchObject({ code: "SPAWN_FAILED", processStarted: false, cleanupSafe: true });
    expect(error.message).not.toContain("does-not-exist");
  }, 10_000);

  it.each([
    ["bad-json", "PROTOCOL_INVALID"],
    ["duplicate-json-key", "PROTOCOL_INVALID"],
    ["terminal-before-ready", "PROTOCOL_INVALID"],
    ["duplicate-ready", "PROTOCOL_INVALID"],
    ["wrong-run-id", "PROTOCOL_INVALID"],
    ["wrong-token", "PROTOCOL_INVALID"],
    ["duplicate-terminal", "PROTOCOL_INVALID"],
    ["terminal-wrong-run-id", "PROTOCOL_INVALID"],
    ["ready-no-terminal", "TERMINAL_MISSING"],
    ["exit-before-ready", "CHILD_EXIT"],
    ["exit-nonzero", "CHILD_EXIT"],
  ])("fails closed for %s", async (mode, code) => {
    const error = await rejected(runMode(mode));
    expect(error).toMatchObject({ code, closeConfirmed: true, cleanupSafe: true });
  }, 10_000);

  it("does not start the ready consumer after a merged duplicate-ready chunk fails the session", async () => {
    let consumerCalls = 0;
    const error = await rejected(runMode("duplicate-ready", () => { consumerCalls += 1; }));
    expect(error).toMatchObject({ code: "PROTOCOL_INVALID", closeConfirmed: true, cleanupSafe: true });
    expect(consumerCalls).toBe(0);
  }, 10_000);

  it("closes a real child after Windows Node maps self-SIGTERM to a nonzero exit", async () => {
    const error = await rejected(runMode("exit-signal"));
    expect(error).toMatchObject({ code: "CHILD_EXIT", exitCode: 1, signal: null });
    expect(error.closeConfirmed).toBe(true);
    expect(error.cleanupSafe).toBe(true);
  }, 10_000);

  it("models an unobserved close conservatively without claiming the OS child resisted termination", async () => {
    const error = await rejected(runMode("normal", undefined, { closeTimeoutMs: 60, testOnlyDeferCloseConfirmation: true }));
    expect(error).toMatchObject({
      code: "CLOSE_UNCONFIRMED",
      processStarted: true,
      exitCode: 0,
      closeConfirmed: false,
      cleanupSafe: false,
      testOnlyCloseObservationSuppressed: true,
    });
  }, 10_000);

  it("clears session timers and the caller abort listener after a real close", async () => {
    const controller = new AbortController();
    const addAbort = vi.spyOn(controller.signal, "addEventListener");
    const removeAbort = vi.spyOn(controller.signal, "removeEventListener");
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    const result = await runMode("normal", undefined, { signal: controller.signal, timeoutMs: 1_234, readyTimeoutMs: 567 });
    expect(result.closeConfirmed).toBe(true);
    expect(addAbort).toHaveBeenCalledOnce();
    expect(removeAbort).toHaveBeenCalledOnce();
    const ownedTimers = setTimer.mock.results.flatMap((entry, index) =>
      setTimer.mock.calls[index]?.[1] === 1_234 || setTimer.mock.calls[index]?.[1] === 567 ? [entry.value] : []);
    expect(ownedTimers).toHaveLength(2);
    for (const timer of ownedTimers) expect(clearTimer).toHaveBeenCalledWith(timer);
  }, 10_000);

  it("rejects accessors, proxy DTOs, unknown launch fields, and shell options before spawn", async () => {
    const getterInput = Object.defineProperty({}, "mode", { enumerable: true, get() { throw new Error("must-not-run"); } });
    const getterError = await rejected(processApi.withOwnedReaderProcess(launch(), getterInput as Readonly<Record<string, unknown>>, () => undefined));
    expect(getterError).toMatchObject({ code: "INVALID_INPUT", processStarted: false, cleanupSafe: true });

    const proxyError = await rejected(processApi.withOwnedReaderProcess(launch(), new Proxy({ mode: "normal" }, {}), () => undefined));
    expect(proxyError).toMatchObject({ code: "INVALID_INPUT", processStarted: false, cleanupSafe: true });

    const launchWithShell = { ...launch(), shell: true };
    const launchError = await rejected(processApi.withOwnedReaderProcess(launchWithShell as unknown as Launch, { mode: "normal" }, () => undefined));
    expect(launchError).toMatchObject({ code: "INVALID_INPUT", processStarted: false, cleanupSafe: true });
  });
});
