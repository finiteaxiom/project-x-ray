const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const READY = 'WRITE_PROBE_CHILD_READY';
const RESULT = 'WRITE_PROBE_CHILD_RESULT ';
const PREFIX = 'project-xray-write-probe-';
function invariant(ok, code = 'WRITE_PROBE_HARNESS_FAILED') { if (!ok) { const error = new Error(code); error.code = code; throw error; } }
function addon() { return require('../native/upgrade-write-probe/build/Release/windows_upgrade_write_probe.node'); }
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function boundIdentity(root) {
  const result = JSON.parse(addon().run(root, 'identify'));
  invariant(result.closed && result.outcome === 'EXPERIMENT_COMPLETED');
  return result.rows.find(r => r.test === 'containerBinding').id;
}
function supervise(executable, root, mode, deadline) {
  return new Promise(resolve => {
    const started = Date.now();
    if (started >= deadline) { resolve({ transport: 'CHILD_DEADLINE', childClosed: true, ready: false }); return; }
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [__filename, '--child', root, mode], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', ready = false, timedOut = false, closed = false, settled = false, forceTimer, termination = 'CHILD_DEADLINE';
    const finish = value => {
      if (settled) return; settled = true; clearTimeout(readyTimer); clearTimeout(totalTimer); clearTimeout(forceTimer);
      process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); resolve(value);
    };
    const cancel = () => { termination = 'CHILD_CANCELLED'; terminate(); };
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    const terminate = () => {
      if (closed || timedOut) return; timedOut = true;
      // Only this freshly spawned child; never enumerate or kill other processes.
      if (child.pid) child.kill();
      forceTimer = setTimeout(() => finish({ transport: 'UNKNOWN_CHILD_CLOSE', childClosed: false, ready }), 5000);
    };
    const readyTimer = setTimeout(terminate, 5000);
    const totalTimer = setTimeout(terminate, deadline - started);
    child.stdout.on('data', bytes => {
      stdout += bytes.toString('utf8');
      if (stdout.length > 1024 * 1024) { terminate(); return; }
      if (!ready && stdout.split(/\r?\n/).includes(READY)) { ready = true; clearTimeout(readyTimer); }
    });
    // Discard arbitrary runtime diagnostics; only fixed failure classes enter records.
    child.stderr.on('data', () => {});
    child.on('error', () => finish({ transport: 'SPAWN_FAILED', childClosed: false, ready }));
    child.on('close', (code, signal) => {
      closed = true;
      if (timedOut) { finish({ transport: termination, childClosed: true, ready, code, signal }); return; }
      try {
        const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT));
        invariant(ready && code === 0 && signal === null && lines.length === 1);
        const result = JSON.parse(lines[0].slice(RESULT.length));
        invariant(result.phase === mode);
        finish({ ...result, transport: 'COMPLETED', childClosed: true, ready, elapsedMs: Date.now() - started });
      } catch { finish({ transport: 'CHILD_RESULT_FAILED', childClosed: true, ready, code, signal }); }
    });
  });
}
function matrix(result) {
  const rows = result.probe?.rows || [];
  const payloads = rows.filter(r => r.test === 'payloadResult');
  const direct = rows.find(r => r.test === 'readOnlyCreate');
  const reoccupy = rows.filter(r => r.test === 'immediateReoccupy');
  const creates = rows.filter(r => r.test === 'targetCreate');
  const expectedHash = size => {
    const hash = crypto.createHash('sha256');
    for (let offset = 0; offset < size;) {
      const n = Math.min(128 * 1024, size - offset), bytes = Buffer.alloc(n);
      for (let i = 0; i < n; ++i) bytes[i] = (offset + i) % 251;
      hash.update(bytes); offset += n;
    }
    return hash.digest('hex');
  };
  const sizes = [0, 3 * 1024 * 1024 + 17];
  const payloadVerified = ['specific', 'generic'].every(mode => sizes.every(size => {
    const p = payloads.find(r => r.mode === mode && r.size === size);
    return p && p.actualWritten === size && p.readBytes === size && p.exactEOF && p.collisionUnchanged && p.seek &&
      p.expectedHash === expectedHash(size) && p.readHash === p.expectedHash;
  }));
  const sharing = rows.filter(r => ['otherRead', 'otherWrite', 'otherDelete'].includes(r.test));
  const collisions = rows.filter(r => ['duplicateOperation', 'duplicateTarget'].includes(r.test));
  const renames = rows.filter(r => r.test.endsWith('Rename'));
  return {
    normalOutcomeAccepted: (result.probe?.outcome === 'EXPERIMENT_COMPLETED' && direct?.denied === true) ||
      (result.probe?.outcome === 'READ_ONLY_CREATE_ASSUMPTION_FAILED' && direct?.denied === false),
    readOnlyCreateDenied: direct?.denied === true,
    sameRootReopen: rows.some(r => r.test === 'writeRootReopen' && r.sameIdentity && r.result.ntStatus === 0),
    payloadVerified,
    totalPayloadBytes: creates.reduce((sum, r) => sum + r.size, 0),
    exclusiveSharing: sharing.length === 12 && sharing.every(r => r.result.ntStatus === 0xC0000043),
    duplicateCollisions: collisions.length === 6 && collisions.every(r => r.result.ntStatus === 0xC0000035),
    renameSharingDenied: renames.length === 4 && renames.every(r => !r.ok && r.win32 === 32),
    immediateRelease: reoccupy.length === 4 && reoccupy.every(r => r.result.ntStatus === 0),
    specificFlush: payloads.filter(r => r.mode === 'specific').length === 2 && payloads.filter(r => r.mode === 'specific').every(r => r.flush),
    genericFlush: payloads.filter(r => r.mode === 'generic').length === 2 && payloads.filter(r => r.mode === 'generic').every(r => r.flush),
    checkedClose: result.probe?.closed === true && result.probe.closeResults.every(r => r.ok),
  };
}
async function run(runtime) {
  const deadline = Date.now() + 60000;
  invariant(process.platform === 'win32' && ['--node', '--electron'].includes(runtime));
  const executable = runtime === '--node' ? process.execPath : path.resolve(__dirname, '../../../apps/desktop/node_modules/electron/dist/electron.exe');
  invariant(fs.statSync(executable).isFile());
  const expectedRuntime = runtime === '--node' ? 'node' : 'electron';
  const expectedVersion = runtime === '--node' ? process.versions.node : require('../../../apps/desktop/node_modules/electron/package.json').version;
  const fixtureParent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(fixtureParent, PREFIX));
  // No removal interfaces: root identity or a no-reparse scan cannot prove ownership of every child.
  const cleanup = 'RETAINED_NO_DELETE';
  let id, normal, junction, verdict, experimentFinished = false;
  const resources = () => ({ normalChildClosed: normal?.childClosed ?? null, normalHandlesClosed: normal?.probe?.closed ?? null,
    junctionChildClosed: junction?.childClosed ?? null, junctionHandlesClosed: junction?.probe?.closed ?? null });
  try {
    id = boundIdentity(root);
    fs.mkdirSync(path.join(root, 'data')); fs.mkdirSync(path.join(root, 'junction-data')); fs.mkdirSync(path.join(root, 'external'));
    const source = path.join(root, 'data/source-sentinel.bin'), external = path.join(root, 'external/external-sentinel.bin');
    fs.writeFileSync(source, 'self-owned source sentinel: do not write');
    fs.writeFileSync(external, 'self-owned adjacent external sentinel: native must not read');
    const before = { source: digest(source), external: digest(external) };
    // Separate fixed negative fixture. Never replace or recursively clear the normal target tree.
    const junctionParent = path.join(root, 'junction-data/upgrade-preservation');
    fs.symlinkSync(path.join(root, 'external'), junctionParent, 'junction');
    normal = await supervise(executable, root, 'normal', deadline);
    invariant(normal.transport === 'COMPLETED' && normal.childClosed && normal.probe?.closed === true);
    invariant(normal.runtime === expectedRuntime && normal.version === expectedVersion, 'RUNTIME_MISMATCH');
    invariant(normal.probe.rows.find(r => r.test === 'containerBinding')?.id === id, 'FIXTURE_IDENTITY_CHANGED');
    verdict = matrix(normal);
    invariant(verdict.normalOutcomeAccepted, 'NATIVE_NORMAL_OUTCOME_REJECTED');
    verdict.sentinelsUnchanged = before.source === digest(source) && before.external === digest(external);
    invariant(verdict.sentinelsUnchanged, 'SENTINEL_CHANGED');
    junction = await supervise(executable, root, 'junction', deadline);
    invariant(junction.transport === 'COMPLETED' && junction.childClosed && junction.probe?.closed === true);
    invariant(junction.runtime === expectedRuntime && junction.version === expectedVersion, 'RUNTIME_MISMATCH');
    invariant(junction.probe.rows.find(r => r.test === 'containerBinding')?.id === id, 'FIXTURE_IDENTITY_CHANGED');
    verdict.junctionRejected = junction.probe.outcome === 'REPARSE_REJECTED';
    invariant(verdict.junctionRejected, 'NATIVE_JUNCTION_OUTCOME_REJECTED');
    verdict.externalUnchangedAfterJunction = before.external === digest(external);
    verdict.sourceUnchangedAfterJunction = before.source === digest(source);
    invariant(verdict.externalUnchangedAfterJunction && verdict.sourceUnchangedAfterJunction, 'SENTINEL_CHANGED');
    invariant(fs.lstatSync(junctionParent).isSymbolicLink() && fs.realpathSync(junctionParent) === path.join(root, 'external'));
    invariant(boundIdentity(root) === id, 'FIXTURE_IDENTITY_CHANGED');
    experimentFinished = true; // Complete sequence is separate from the required assertion's failed result.
    const passed = Object.entries(verdict).every(([key, value]) => key === 'totalPayloadBytes' ? value <= 8 * 1024 * 1024 : value === true);
    process.stdout.write(JSON.stringify({ scope: 'ISOLATED_PERMISSION_EXPERIMENT', passed, runtime: normal.runtime, version: normal.version,
      fixtureIdentity: id, fixtureName: path.basename(root), experimentFinished, resources: resources(), verdict, cleanup, normal, junction,
      aclDenial: 'NOT_EXPERIMENTED_NO_ACL_CHANGE', fileSymlink: 'PRIOR_EPERM_GATE_UNVERIFIED' }) + '\n');
    if (!passed) process.exitCode = 1;
  } catch (error) {
    const fixed = ['NATIVE_NORMAL_OUTCOME_REJECTED', 'NATIVE_JUNCTION_OUTCOME_REJECTED', 'RUNTIME_MISMATCH', 'FIXTURE_IDENTITY_CHANGED', 'SENTINEL_CHANGED'];
    const failure = fixed.includes(error?.code) ? error.code : 'HARNESS_OR_ENVIRONMENT_FAILED';
    process.stdout.write(JSON.stringify({ scope: 'ISOLATED_PERMISSION_EXPERIMENT', passed: false, failure, fixtureIdentity: id, fixtureName: path.basename(root),
      experimentFinished, resources: resources(), cleanup, normal, junction, verdict }) + '\n'); process.exitCode = 2;
  }
}
function child(root, mode) {
  invariant(process.platform === 'win32' && ['normal', 'junction'].includes(mode));
  process.stdout.write(READY + '\n');
  const probe = JSON.parse(addon().run(root, mode));
  process.stdout.write(RESULT + JSON.stringify({ phase: mode, runtime: process.versions.electron ? 'electron' : 'node', version: process.versions.electron || process.versions.node, probe }) + '\n');
  if (process.versions.electron) require('electron').app.exit(0);
}
module.exports = { run };
// Normal imports have no fixture, addon, child, or filesystem effects.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  if (process.argv.length === 5 && process.argv[2] === '--child') {
    try { child(process.argv[3], process.argv[4]); }
    catch { process.stderr.write('WRITE_PROBE_CHILD_FAILED\n'); if (process.versions.electron) require('electron').app.exit(2); else process.exitCode = 2; }
  } else if (process.argv.length === 3) {
    run(process.argv[2]).catch(() => { process.stderr.write('WRITE_PROBE_HARNESS_FAILED\n'); process.exitCode = 2; });
  } else { process.stderr.write('WRITE_PROBE_INVALID_CLI\n'); process.exitCode = 2; }
}
