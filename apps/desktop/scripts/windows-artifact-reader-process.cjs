"use strict";

const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const { TextDecoder, types } = require("node:util");

const LIMITS = Object.freeze({
  maxInputBytes: 64 * 1024,
  maxFrameBytes: 64 * 1024,
  maxStdoutBytes: 64 * 1024,
  maxStderrBytes: 4 * 1024,
  maxJsonDepth: 32,
  maxJsonNodes: 10_000,
  maxLaunchArgs: 16,
  maxLaunchBytes: 16 * 1024,
  defaultReadyTimeoutMs: 30_000,
  maxRunTimeoutMs: 15 * 60 * 1000,
  maxCloseWaitMs: 5_000,
});

const ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: "Reader process request is invalid",
  CANCELLED_BEFORE_SPAWN: "Reader process request was cancelled before spawn",
  CANCELLED: "Reader process session was cancelled",
  READY_TIMEOUT: "Reader process did not become ready before its deadline",
  DEADLINE_EXCEEDED: "Reader process session exceeded its deadline",
  SPAWN_FAILED: "Reader process could not be started",
  CHILD_ERROR: "Reader process reported a process error",
  CHILD_IO_ERROR: "Reader process control channel failed",
  STDOUT_LIMIT: "Reader process stdout exceeded its byte limit",
  STDERR_LIMIT: "Reader process stderr exceeded its byte limit",
  PROTOCOL_INVALID: "Reader process protocol message is invalid",
  CONSUMER_FAILED: "Reader process consumer failed",
  CHILD_EXIT: "Reader process exited unsuccessfully",
  CHILD_SIGNAL: "Reader process exited by signal",
  TERMINAL_MISSING: "Reader process exited without a release terminal",
  CLOSE_UNCONFIRMED: "Reader process close was not confirmed",
});

const ERROR_CODES = Object.freeze(Object.keys(ERROR_MESSAGES));
const CODE_SET = new Set(ERROR_CODES);
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

class OwnedReaderProcessError extends Error {
  constructor(code, details = {}) {
    const fixedCode = CODE_SET.has(code) ? code : "CHILD_ERROR";
    super(ERROR_MESSAGES[fixedCode]);
    this.name = "OwnedReaderProcessError";
    this.code = fixedCode;
    this.cleanupSafe = details.cleanupSafe === true;
    this.processStarted = details.processStarted === true;
    this.closeConfirmed = details.closeConfirmed === true;
    this.exitCode = Number.isInteger(details.exitCode) ? details.exitCode : null;
    this.signal = typeof details.signal === "string" ? details.signal : null;
    this.priorCode = CODE_SET.has(details.priorCode) ? details.priorCode : null;
    this.testOnlyCloseObservationSuppressed = details.testOnlyCloseObservationSuppressed === true;
  }
}

function fixedError(code, details = {}) {
  return new OwnedReaderProcessError(code, details);
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return false;
  return actual.every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, "value");
  });
}

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, "value");
  });
}

function clonePlainJson(input, maxBytes) {
  const seen = new Set();
  let nodes = 0;
  let textBytes = 0;

  function copy(value, depth) {
    nodes += 1;
    if (nodes > LIMITS.maxJsonNodes || depth > LIMITS.maxJsonDepth) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      textBytes += Buffer.byteLength(value, "utf8");
      if (textBytes > maxBytes) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
      return value;
    }
    if (!value || typeof value !== "object" || types.isProxy(value) || seen.has(value)) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    seen.add(value);

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > LIMITS.maxJsonNodes) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)))) {
        throw fixedError("INVALID_INPUT", { cleanupSafe: true });
      }
      const result = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
        result[index] = copy(descriptor.value, depth + 1);
      }
      seen.delete(value);
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > LIMITS.maxJsonNodes || ownKeys.some((key) => typeof key !== "string" || key === "__proto__")) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    const result = Object.create(null);
    for (const key of ownKeys) {
      textBytes += Buffer.byteLength(key, "utf8");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (textBytes > maxBytes || !descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw fixedError("INVALID_INPUT", { cleanupSafe: true });
      }
      result[key] = copy(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return result;
  }

  const copied = copy(input, 0);
  const serialized = JSON.stringify(copied);
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maxBytes) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  return { value: copied, serialized };
}

function freezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

function validateLaunch(launch) {
  if (!hasExactKeys(launch, ["executable", "fixedArgs", "helperPath", "cwd"])) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  const isLocalAbsolutePath = (value) => typeof value === "string" && /^[A-Za-z]:\\/u.test(value) && !value.includes("/") && path.isAbsolute(value) && !value.includes("\0");
  if (!isLocalAbsolutePath(launch.executable) || !isLocalAbsolutePath(launch.helperPath) || !isLocalAbsolutePath(launch.cwd)) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  if (!Array.isArray(launch.fixedArgs) || types.isProxy(launch.fixedArgs) || Object.getPrototypeOf(launch.fixedArgs) !== Array.prototype || launch.fixedArgs.length > LIMITS.maxLaunchArgs) {
    throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  }
  const argKeys = Reflect.ownKeys(launch.fixedArgs);
  if (argKeys.length !== launch.fixedArgs.length + 1 || argKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)))) {
    throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  }
  const args = [];
  for (let index = 0; index < launch.fixedArgs.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(launch.fixedArgs, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value") || typeof descriptor.value !== "string" || descriptor.value.includes("\0")) {
      throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    }
    args.push(descriptor.value);
  }
  const launchBytes = [launch.executable, launch.helperPath, launch.cwd, ...args].reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0);
  if (launchBytes > LIMITS.maxLaunchBytes) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  return {
    executable: launch.executable,
    fixedArgs: [...args, launch.helperPath],
    cwd: launch.cwd,
  };
}

function validateOptions(options) {
  const optionKeys = ["signal", "timeoutMs", "readyTimeoutMs", "closeTimeoutMs", "testOnlyDeferCloseConfirmation"];
  if (!hasOnlyKeys(options, optionKeys)) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  const read = (key) => Object.prototype.hasOwnProperty.call(options, key) ? Object.getOwnPropertyDescriptor(options, key).value : undefined;
  const signal = read("signal");
  const requestedTimeout = read("timeoutMs");
  const requestedReadyTimeout = read("readyTimeoutMs");
  const requestedCloseTimeout = read("closeTimeoutMs");
  const testOnlyDeferCloseConfirmation = read("testOnlyDeferCloseConfirmation");
  const timeoutMs = requestedTimeout === undefined ? LIMITS.maxRunTimeoutMs : requestedTimeout;
  const readyTimeoutMs = requestedReadyTimeout === undefined ? Math.min(LIMITS.defaultReadyTimeoutMs, timeoutMs) : requestedReadyTimeout;
  const closeTimeoutMs = requestedCloseTimeout === undefined ? LIMITS.maxCloseWaitMs : requestedCloseTimeout;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.maxRunTimeoutMs ||
      !Number.isInteger(readyTimeoutMs) || readyTimeoutMs < 1 || readyTimeoutMs > timeoutMs ||
      !Number.isInteger(closeTimeoutMs) || closeTimeoutMs < 1 || closeTimeoutMs > LIMITS.maxCloseWaitMs) {
    throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  }
  if (signal !== undefined && (!(signal instanceof AbortSignal) || typeof signal.aborted !== "boolean")) {
    throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  }
  if (testOnlyDeferCloseConfirmation !== undefined && typeof testOnlyDeferCloseConfirmation !== "boolean") throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  return { signal, timeoutMs, readyTimeoutMs, closeTimeoutMs, testOnlyDeferCloseConfirmation: testOnlyDeferCloseConfirmation === true };
}

function frameLine(frame) {
  const json = JSON.stringify(frame);
  const line = `${json}\n`;
  if (Buffer.byteLength(line, "utf8") > LIMITS.maxInputBytes) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
  return line;
}

function minimalChildEnvironment() {
  const environment = Object.create(null);
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot === "string" && /^[A-Za-z]:\\/u.test(systemRoot) && !systemRoot.includes("/") && path.isAbsolute(systemRoot) && !systemRoot.includes("\0")) environment.SystemRoot = systemRoot;
  return environment;
}

function hasDuplicateJsonKeys(source) {
  let offset = 0;
  const skipWhitespace = () => { while (offset < source.length && /[\u0009\u000a\u000d\u0020]/u.test(source[offset])) offset += 1; };
  const readString = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) { offset += 1; return source.slice(start, offset); }
      if (code === 0x5c) {
        offset += 1;
        if (source[offset] === "u") offset += 5;
        else offset += 1;
      } else {
        offset += 1;
      }
    }
    throw new Error("invalid-json-string");
  };
  const parseValue = (depth) => {
    if (depth > LIMITS.maxJsonDepth) throw new Error("json-depth-limit");
    skipWhitespace();
    const current = source[offset];
    if (current === "{") {
      offset += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[offset] === "}") { offset += 1; return; }
      for (;;) {
        skipWhitespace();
        if (source[offset] !== '"') throw new Error("invalid-json-object");
        const key = JSON.parse(readString());
        if (keys.has(key)) throw new Error("duplicate-json-key");
        keys.add(key);
        skipWhitespace();
        if (source[offset] !== ":") throw new Error("invalid-json-object");
        offset += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (source[offset] === "}") { offset += 1; return; }
        if (source[offset] !== ",") throw new Error("invalid-json-object");
        offset += 1;
      }
    }
    if (current === "[") {
      offset += 1;
      skipWhitespace();
      if (source[offset] === "]") { offset += 1; return; }
      for (;;) {
        parseValue(depth + 1);
        skipWhitespace();
        if (source[offset] === "]") { offset += 1; return; }
        if (source[offset] !== ",") throw new Error("invalid-json-array");
        offset += 1;
      }
    }
    if (current === '"') { readString(); return; }
    const start = offset;
    while (offset < source.length && !/[\u0009\u000a\u000d\u0020,\]}]/u.test(source[offset])) offset += 1;
    if (offset === start) throw new Error("invalid-json-value");
  };
  parseValue(0);
  skipWhitespace();
  if (offset !== source.length) throw new Error("invalid-json-tail");
  return false;
}

function withOwnedReaderProcess(trustedLaunch, input, consumeReady, options = {}) {
  let launch;
  let safeInput;
  let limits;
  try {
    launch = validateLaunch(trustedLaunch);
    const copied = clonePlainJson(input, LIMITS.maxInputBytes);
    if (!copied.value || typeof copied.value !== "object" || Array.isArray(copied.value)) throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    safeInput = copied.value;
    if (typeof consumeReady !== "function") throw fixedError("INVALID_INPUT", { cleanupSafe: true });
    limits = validateOptions(options);
  } catch (error) {
    return Promise.reject(error instanceof OwnedReaderProcessError ? error : fixedError("INVALID_INPUT", { cleanupSafe: true }));
  }

  if (limits.signal?.aborted) return Promise.reject(fixedError("CANCELLED_BEFORE_SPAWN", { cleanupSafe: true }));

  const runId = randomUUID();
  const token = randomBytes(24).toString("base64url");
  let startLine;
  try {
    startLine = frameLine({ protocolVersion: 1, type: "start", runId, token, input: safeInput });
  } catch (error) {
    return Promise.reject(error instanceof OwnedReaderProcessError ? error : fixedError("INVALID_INPUT", { cleanupSafe: true }));
  }

  return new Promise((resolve, reject) => {
    let child;
    let state = "spawning";
    let spawnSeen = false;
    let closeSeen = false;
    let exitCode = null;
    let exitSignal = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutPending = Buffer.alloc(0);
    let readyPayload;
    let failure;
    let settled = false;
    let overallTimer;
    let readyTimer;
    let closeTimer;
    let normalCloseTimer;
    let rejectInterrupted;
    const consumerAbort = new AbortController();
    const interrupted = new Promise((_, rejectPromise) => { rejectInterrupted = rejectPromise; });
    interrupted.catch(() => undefined);

    const clearTimers = () => {
      clearTimeout(overallTimer);
      clearTimeout(readyTimer);
      clearTimeout(closeTimer);
      clearTimeout(normalCloseTimer);
    };
    const removeListeners = () => {
      limits.signal?.removeEventListener("abort", onAbort);
      child?.removeListener("spawn", onSpawn);
      child?.removeListener("error", onChildError);
      child?.removeListener("exit", onExit);
      child?.removeListener("close", onClose);
      child?.stdout?.removeListener("data", onStdout);
      child?.stdout?.removeListener("error", onIoError);
      child?.stderr?.removeListener("data", onStderr);
      child?.stderr?.removeListener("error", onIoError);
      child?.stdin?.removeListener("error", onIoError);
    };
    const rejectWith = (code, cleanupSafe, priorCode = null) => {
      if (settled) return;
      settled = true;
      clearTimers();
      removeListeners();
      reject(fixedError(code, {
        cleanupSafe,
        processStarted: spawnSeen,
        closeConfirmed: closeSeen,
        exitCode,
        signal: exitSignal,
        priorCode,
        testOnlyCloseObservationSuppressed: code === "CLOSE_UNCONFIRMED" && limits.testOnlyDeferCloseConfirmation,
      }));
    };
    const resolveWith = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      removeListeners();
      resolve(Object.freeze({
        status: "released",
        runId,
        ready: readyPayload,
        processStarted: spawnSeen,
        exitCode,
        signal: exitSignal,
        closeConfirmed: closeSeen,
        cleanupSafe: true,
        testOnlyCloseObservationSuppressed: false,
      }));
    };
    const terminateChild = () => {
      if (!child) return;
      try { if (child.stdin && !child.stdin.destroyed) child.stdin.destroy(); } catch { /* fixed process error below */ }
      if (!spawnSeen || closeSeen || child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill(); } catch { /* close confirmation remains the safety gate */ }
    };
    const fail = (code, priorCode = null) => {
      if (settled || failure) return;
      failure = { code, priorCode };
      state = "terminating";
      consumerAbort.abort();
      rejectInterrupted(fixedError(code, { cleanupSafe: false, processStarted: spawnSeen, closeConfirmed: closeSeen, exitCode, signal: exitSignal, priorCode }));
      clearTimeout(readyTimer);
      if (closeSeen) {
        rejectWith(code, true, priorCode);
        return;
      }
      closeTimer = setTimeout(() => rejectWith("CLOSE_UNCONFIRMED", false, code), limits.closeTimeoutMs);
      terminateChild();
    };
    const sendLine = (line, end = false) => new Promise((resolveWrite, rejectWrite) => {
      if (!child?.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
        rejectWrite(fixedError("CHILD_IO_ERROR", { cleanupSafe: false, processStarted: spawnSeen }));
        return;
      }
      child.stdin.write(line, "utf8", (error) => {
        if (error) { rejectWrite(error); return; }
        if (end) child.stdin.end();
        resolveWrite();
      });
    });
    const sendRelease = () => {
      state = "awaiting-terminal";
      const line = frameLine({ protocolVersion: 1, type: "release", runId, token });
      void sendLine(line, true).catch(() => fail("CHILD_IO_ERROR"));
    };
    const processReady = (frame) => {
      if (state !== "awaiting-ready" || !hasExactKeys(frame, ["protocolVersion", "type", "runId", "token", "payload"]) ||
          frame.protocolVersion !== 1 || frame.type !== "ready" || frame.runId !== runId || frame.token !== token ||
          !frame.payload || typeof frame.payload !== "object" || Array.isArray(frame.payload)) {
        fail("PROTOCOL_INVALID");
        return;
      }
      let payload;
      try { payload = freezeJson(clonePlainJson(frame.payload, LIMITS.maxFrameBytes).value); }
      catch { fail("PROTOCOL_INVALID"); return; }
      clearTimeout(readyTimer);
      readyPayload = payload;
      state = "consuming";
      const consumerContext = Object.freeze({ protocolVersion: 1, runId, token, signal: consumerAbort.signal });
      Promise.race([
        Promise.resolve().then(() => {
          if (state !== "consuming" || failure || settled || consumerAbort.signal.aborted) return;
          return consumeReady(payload, consumerContext);
        }),
        interrupted,
      ]).then(() => {
        if (failure || settled) return;
        sendRelease();
      }).catch((error) => {
        if (failure || settled) return;
        const priorCode = error instanceof OwnedReaderProcessError ? error.code : null;
        fail("CONSUMER_FAILED", priorCode);
      });
    };
    const processTerminal = (frame) => {
      if (state !== "awaiting-terminal" || !hasExactKeys(frame, ["protocolVersion", "type", "runId", "token", "status"]) ||
          frame.protocolVersion !== 1 || frame.type !== "terminal" || frame.runId !== runId || frame.token !== token || frame.status !== "released") {
        fail("PROTOCOL_INVALID");
        return;
      }
      state = "terminal";
    };
    const processLine = (bytes) => {
      if (bytes.length === 0 || bytes.length > LIMITS.maxFrameBytes) { fail("PROTOCOL_INVALID"); return; }
      let frame;
      try {
        const source = TEXT_DECODER.decode(bytes);
        if (hasDuplicateJsonKeys(source)) { fail("PROTOCOL_INVALID"); return; }
        frame = JSON.parse(source);
      } catch {
        fail("PROTOCOL_INVALID");
        return;
      }
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) { fail("PROTOCOL_INVALID"); return; }
      if (frame.type === "ready") processReady(frame);
      else if (frame.type === "terminal") processTerminal(frame);
      else fail("PROTOCOL_INVALID");
    };
    function onStdout(chunk) {
      if (settled || failure) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > LIMITS.maxStdoutBytes) { fail("STDOUT_LIMIT"); return; }
      stdoutPending = stdoutPending.length === 0 ? Buffer.from(bytes) : Buffer.concat([stdoutPending, bytes]);
      for (;;) {
        const newline = stdoutPending.indexOf(0x0a);
        if (newline < 0) break;
        const line = stdoutPending.subarray(0, newline);
        stdoutPending = stdoutPending.subarray(newline + 1);
        processLine(line);
        if (failure || settled) return;
      }
      if (stdoutPending.length > LIMITS.maxFrameBytes) fail("PROTOCOL_INVALID");
    }
    function onStderr(chunk) {
      if (settled || failure) return;
      stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), "utf8");
      if (stderrBytes > LIMITS.maxStderrBytes) fail("STDERR_LIMIT");
    }
    function onIoError() { if (!failure && !settled) fail("CHILD_IO_ERROR"); }
    function onSpawn() {
      spawnSeen = true;
      if (failure) { terminateChild(); return; }
      state = "awaiting-ready";
      readyTimer = setTimeout(() => fail("READY_TIMEOUT"), limits.readyTimeoutMs);
      void sendLine(startLine).catch(() => fail("CHILD_IO_ERROR"));
    }
    function onChildError() {
      if (settled) return;
      if (!spawnSeen) {
        failure = failure || { code: "SPAWN_FAILED", priorCode: null };
        state = "terminating";
        consumerAbort.abort();
        rejectInterrupted(fixedError(failure.code, { cleanupSafe: true, processStarted: false, closeConfirmed: false, priorCode: failure.priorCode }));
        rejectWith(failure.code, true, failure.priorCode);
        return;
      }
      if (!failure) fail("CHILD_ERROR");
    }
    function onExit(code, signal) {
      exitCode = Number.isInteger(code) ? code : null;
      exitSignal = typeof signal === "string" ? signal : null;
      if (failure || settled) return;
      if (exitSignal !== null) { fail("CHILD_SIGNAL"); return; }
      if (exitCode !== 0) { fail("CHILD_EXIT"); return; }
      if (state !== "terminal") { fail("TERMINAL_MISSING"); return; }
      normalCloseTimer = setTimeout(() => {
        if (!settled && !closeSeen && !failure) rejectWith("CLOSE_UNCONFIRMED", false);
      }, limits.closeTimeoutMs);
    }
    function onClose(code, signal) {
      if (limits.testOnlyDeferCloseConfirmation) return;
      closeSeen = true;
      if (exitCode === null && Number.isInteger(code)) exitCode = code;
      if (exitSignal === null && typeof signal === "string") exitSignal = signal;
      clearTimeout(closeTimer);
      clearTimeout(normalCloseTimer);
      if (!failure && stdoutPending.length > 0) fail("PROTOCOL_INVALID");
      if (failure) { rejectWith(failure.code, true, failure.priorCode); return; }
      if (signal != null) { fail("CHILD_SIGNAL"); return; }
      if (code !== 0) { fail("CHILD_EXIT"); return; }
      if (state !== "terminal") { fail("TERMINAL_MISSING"); return; }
      resolveWith();
    }
    function onAbort() { fail("CANCELLED"); }

    try {
      child = spawn(launch.executable, launch.fixedArgs, {
        cwd: launch.cwd,
        env: minimalChildEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      reject(fixedError("SPAWN_FAILED", { cleanupSafe: true, processStarted: false, closeConfirmed: false }));
      return;
    }

    child.on("spawn", onSpawn);
    child.on("error", onChildError);
    child.on("exit", onExit);
    child.on("close", onClose);
    child.stdout.on("data", onStdout);
    child.stdout.on("error", onIoError);
    child.stderr.on("data", onStderr);
    child.stderr.on("error", onIoError);
    child.stdin.on("error", onIoError);
    overallTimer = setTimeout(() => fail("DEADLINE_EXCEEDED"), limits.timeoutMs);
    limits.signal?.addEventListener("abort", onAbort, { once: true });
    if (limits.signal?.aborted) onAbort();
  });
}

module.exports = Object.freeze({
  ERROR_CODES,
  LIMITS,
  OwnedReaderProcessError,
  withOwnedReaderProcess,
});
