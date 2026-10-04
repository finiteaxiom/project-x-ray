const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function buildWindowsUpgradeWriteProbe() {
  if (process.platform !== 'win32' || process.argv.length !== 2) throw new Error('WRITE_PROBE_BUILD_FAILED');
  const native = fs.realpathSync(path.join(__dirname, '../native/upgrade-write-probe'));
  const output = path.join(native, 'build');
  if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || fs.realpathSync(output) !== output)) throw new Error('WRITE_PROBE_BUILD_FAILED');
  const tool = require.resolve('node-gyp/bin/node-gyp.js', { paths: [path.resolve(__dirname, '../../../apps/desktop')] });
  const result = spawnSync(process.execPath, [tool, 'rebuild', '--directory', native], { windowsHide: true, timeout: 300000, stdio: 'pipe' });
  if (result.error || result.status !== 0 || !fs.statSync(path.join(output, 'Release/windows_upgrade_write_probe.node')).isFile()) throw new Error('WRITE_PROBE_BUILD_FAILED');
}
module.exports = { buildWindowsUpgradeWriteProbe };
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try { buildWindowsUpgradeWriteProbe(); process.stdout.write('WRITE_PROBE_BUILD_OK\n'); }
  catch { process.stderr.write('WRITE_PROBE_BUILD_FAILED\n'); process.exitCode = 1; }
}
