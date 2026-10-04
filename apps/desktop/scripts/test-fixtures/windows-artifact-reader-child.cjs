"use strict";

const IMPORT_CHECK = "--import-check";
const SESSION_MODES = new Set([
  "normal",
  "split-ready",
  "stdout-boundary",
  "stdout-overflow",
  "stderr-boundary",
  "stderr-overflow",
  "no-ready",
  "exit-before-ready",
  "ready-no-terminal",
  "terminal-before-ready",
  "terminal-wrong-run-id",
  "duplicate-json-key",
  "duplicate-ready",
  "wrong-run-id",
  "wrong-token",
  "duplicate-terminal",
  "terminal-wrong-run-id",
  "bad-json",
  "exit-nonzero",
  "exit-signal",
  "input-placement",
]);
const FIXTURE_OUTPUT_LIMIT = 64 * 1024;
const FIXTURE_STDERR_LIMIT = 4 * 1024;
const MAX_CONTROL_BYTES = 64 * 1024;

function importSideEffectCheck(modulePath) {
  const childProcess = require("node:child_process");
  const Module = require("node:module");
  const fs = require("node:fs");
  const source = fs.readFileSync(modulePath, "utf8");
  const calls = [];
  const original = {
    spawn: childProcess.spawn,
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
    fs: new Map(),
  };
  for (const name of ["readFileSync", "openSync", "createReadStream", "statSync", "existsSync", "readdirSync"]) {
    if (typeof fs[name] === "function") {
      original.fs.set(name, fs[name]);
      fs[name] = () => { calls.push(`fs:${name}`); throw new Error("fixture-import-side-effect"); };
    }
  }
  childProcess.spawn = () => { calls.push("spawn"); throw new Error("fixture-import-side-effect"); };
  process.stdout.write = function writeDuringImport(chunk, ...args) { calls.push("stdout"); return original.stdoutWrite.call(this, chunk, ...args); };
  process.stderr.write = function writeDuringImport(chunk, ...args) { calls.push("stderr"); return original.stderrWrite.call(this, chunk, ...args); };
  try {
    const loaded = new Module(modulePath);
    loaded.filename = modulePath;
    loaded.paths = Module._nodeModulePaths(require("node:path").dirname(modulePath));
    loaded._compile(source, modulePath);
  } catch {
    calls.push("import-error");
  } finally {
    childProcess.spawn = original.spawn;
    for (const [name, method] of original.fs) fs[name] = method;
    process.stdout.write = original.stdoutWrite;
    process.stderr.write = original.stderrWrite;
  }
  if (calls.length > 0) {
    process.stderr.write("IMPORT_SIDE_EFFECT\n");
    process.exitCode = 21;
  } else {
    process.stdout.write("IMPORT_CLEAN\n");
  }
}

if (process.argv[2] === IMPORT_CHECK) {
  importSideEffectCheck(process.argv[3]);
} else {
  runSessionFixture();
}

function runSessionFixture() {
  const readline = require("node:readline");
  let inputBytes = 0;
  let pending = Buffer.alloc(0);
  let started = false;
  let session;
  let releaseListener;

  const failFixture = (code) => {
    process.stderr.write(`${code}\n`);
    process.exitCode = 22;
    process.stdin.destroy();
  };
  const sendFrame = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
  const makeReady = (start, payload = { state: "fixture-ready" }, overrides = {}) => ({
    protocolVersion: 1,
    type: "ready",
    runId: overrides.runId ?? start.runId,
    token: overrides.token ?? start.token,
    payload,
  });
  const makeTerminal = (start, overrides = {}) => ({
    protocolVersion: 1,
    type: "terminal",
    runId: overrides.runId ?? start.runId,
    token: overrides.token ?? start.token,
    status: "released",
  });

  const interfaceForInput = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  interfaceForInput.on("line", (line) => {
    if (Buffer.byteLength(line, "utf8") + 1 > MAX_CONTROL_BYTES) { failFixture("FIXTURE_CONTROL_LIMIT"); return; }
    let frame;
    try { frame = JSON.parse(line); } catch { failFixture("FIXTURE_CONTROL_INVALID"); return; }
    if (!started) {
      const keys = frame && typeof frame === "object" && !Array.isArray(frame) ? Reflect.ownKeys(frame) : [];
      if (keys.length !== 5 || !["protocolVersion", "type", "runId", "token", "input"].every((key) => Object.prototype.hasOwnProperty.call(frame, key)) ||
          frame.protocolVersion !== 1 || frame.type !== "start" || !/^[0-9a-f-]{36}$/u.test(frame.runId) ||
          typeof frame.token !== "string" || !/^[A-Za-z0-9_-]{24,64}$/u.test(frame.token) ||
          !frame.input || typeof frame.input !== "object" || Array.isArray(frame.input) ||
          frame.input.mode !== undefined && (!Object.prototype.hasOwnProperty.call(frame.input, "mode") || typeof frame.input.mode !== "string")) {
        failFixture("FIXTURE_START_INVALID"); return;
      }
      const modeKeys = Reflect.ownKeys(frame.input);
      const expectedModeKeys = frame.input.mode === "input-placement" ? ["mode", "controlPath"] : ["mode"];
      if (modeKeys.length !== expectedModeKeys.length || expectedModeKeys.some((key) => !modeKeys.includes(key)) ||
          !SESSION_MODES.has(frame.input.mode) || (frame.input.mode === "input-placement" && typeof frame.input.controlPath !== "string")) {
        failFixture("FIXTURE_MODE_INVALID"); return;
      }
      started = true;
      session = frame;
      beginMode(frame);
      return;
    }

    const keys = frame && typeof frame === "object" && !Array.isArray(frame) ? Reflect.ownKeys(frame) : [];
    if (keys.length !== 4 || !["protocolVersion", "type", "runId", "token"].every((key) => Object.prototype.hasOwnProperty.call(frame, key)) ||
        frame.protocolVersion !== 1 || frame.type !== "release" || frame.runId !== session.runId || frame.token !== session.token || !releaseListener) {
      failFixture("FIXTURE_RELEASE_INVALID"); return;
    }
    const current = releaseListener;
    releaseListener = undefined;
    current();
  });
  interfaceForInput.on("close", () => {
    if (started && !releaseListener && process.exitCode === undefined) process.exitCode = 0;
  });
  process.stdin.on("data", (chunk) => {
    inputBytes += chunk.length;
    if (inputBytes > MAX_CONTROL_BYTES) failFixture("FIXTURE_CONTROL_LIMIT");
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    if (pending.length > MAX_CONTROL_BYTES) failFixture("FIXTURE_CONTROL_LIMIT");
    const newline = pending.lastIndexOf(0x0a);
    pending = newline < 0 ? pending : pending.subarray(newline + 1);
  });

  function beginMode(start) {
    const mode = start.input.mode;
    if (mode === "no-ready") return;
    if (mode === "exit-before-ready") { process.exitCode = 23; process.stdin.destroy(); return; }
    if (mode === "input-placement") {
      sendFrame(makeReady(start, { controlPathWasJsonInput: typeof start.input.controlPath === "string", controlPathAppearedInArgv: process.argv.includes(start.input.controlPath) }));
      waitForRelease(start, mode);
      return;
    }
    if (mode === "bad-json") { process.stdout.write("{bad-json}\n"); return; }
    if (mode === "duplicate-json-key") { process.stdout.write('{"protocolVersion":1,"type":"ready","runId":"wrong","runId":"wrong","token":"wrong","payload":{}}\n'); return; }
    if (mode === "terminal-before-ready") { sendFrame(makeTerminal(start)); process.stdin.destroy(); return; }
    if (mode === "stdout-overflow") { process.stdout.write(Buffer.alloc(FIXTURE_OUTPUT_LIMIT + 1, 0x78)); return; }
    if (mode === "stderr-overflow") { process.stderr.write(Buffer.alloc(FIXTURE_STDERR_LIMIT + 1, 0x78)); return; }
    if (mode === "stderr-boundary") process.stderr.write(Buffer.alloc(FIXTURE_STDERR_LIMIT, 0x78));
    if (mode === "stdout-boundary") {
      const terminal = `${JSON.stringify(makeTerminal(start))}\n`;
      const emptyReady = `${JSON.stringify(makeReady(start, { padding: "" }))}\n`;
      const paddingBytes = FIXTURE_OUTPUT_LIMIT - Buffer.byteLength(terminal, "utf8") - Buffer.byteLength(emptyReady, "utf8");
      if (paddingBytes < 0) { failFixture("FIXTURE_BOUNDARY_SETUP_FAILED"); return; }
      const readyLine = `${JSON.stringify(makeReady(start, { padding: "x".repeat(paddingBytes) }))}\n`;
      if (Buffer.byteLength(readyLine, "utf8") + Buffer.byteLength(terminal, "utf8") !== FIXTURE_OUTPUT_LIMIT) { failFixture("FIXTURE_BOUNDARY_SETUP_FAILED"); return; }
      sendReadyLine(readyLine, mode === "stdout-boundary" ? "normal" : "overflow", start, terminal);
      return;
    }
    if (mode === "wrong-run-id") { sendFrame(makeReady(start, undefined, { runId: "00000000-0000-0000-0000-000000000000" })); return; }
    if (mode === "wrong-token") { sendFrame(makeReady(start, undefined, { token: "wrong-token-value-000000000000" })); return; }
    if (mode === "duplicate-ready") {
      const readyLine = `${JSON.stringify(makeReady(start))}\n`;
      process.stdout.write(Buffer.from(readyLine + readyLine, "utf8"));
      return;
    }
    if (mode === "split-ready") {
      const bytes = Buffer.from(`${JSON.stringify(makeReady(start))}\n`, "utf8");
      waitForRelease(start, mode);
      process.stdout.write(bytes.subarray(0, 4));
      setTimeout(() => process.stdout.write(bytes.subarray(4, 11)), 15);
      setTimeout(() => process.stdout.write(bytes.subarray(11)), 30);
      return;
    }
    sendFrame(makeReady(start));
    waitForRelease(start, mode);
  }

  function sendReadyLine(line, finishMode, start, terminal) {
    process.stdout.write(line);
    waitForRelease(start, finishMode, terminal);
  }

  function waitForRelease(start, mode, preparedTerminal) {
    releaseListener = () => {
      if (mode === "ready-no-terminal") { process.stdin.destroy(); return; }
      const terminal = preparedTerminal ?? `${JSON.stringify(mode === "terminal-wrong-run-id"
        ? makeTerminal(start, { runId: "00000000-0000-0000-0000-000000000000" })
        : makeTerminal(start))}\n`;
      process.stdout.write(terminal);
      if (mode === "duplicate-terminal") process.stdout.write(terminal);
      if (mode === "stdout-overflow") process.stdout.write("x");
      if (mode === "exit-nonzero") { process.exitCode = 23; process.stdin.destroy(); return; }
      if (mode === "exit-signal") { setTimeout(() => process.kill(process.pid, "SIGTERM"), 50); return; }
      if (mode !== "no-ready" && mode !== "duplicate-terminal" && mode !== "stdout-overflow") process.stdin.destroy();
    };
  }
}
