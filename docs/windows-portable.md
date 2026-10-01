# Windows x64 portable build

Project X-Ray packages an x64 Windows application in a portable executable. The build keeps the Python analyzer worker as a physical file under `resources/python-analyze.py`; the worker is excluded from `app.asar` because the analyzer checks its bundled directory before `process.resourcesPath`.

## Build

Use a Windows x64 development machine with Node.js, pnpm, Python, and the Visual C++ build tools needed by `node-gyp`. The build compiles the secure reader native addon and electron-builder rebuilds native dependencies for Electron.

From the repository root:

```powershell
pnpm install
pnpm dist:win
pnpm verify:win-portable -- --app-dir dist/win-unpacked
```

The structural acceptance script checks that the packaged ASAR contains the desktop and UI entry points, excludes `python-analyze.py`, and that the worker exists as a physical resource. It also checks that the unpacked application executable, secure reader, and Windows `better-sqlite3` addon are x64 binaries. It reports the outer portable wrapper's PE machine type separately: the current build produced an x86 wrapper around the x64 app payload. The script writes a JSON manifest beside `win-unpacked` with hashes for the portable executable, app executable, ASAR, and Python worker. It does not launch the application or replace interactive portable-app acceptance.

For a configuration and tooling preflight before packaging:

```powershell
pnpm verify:win-portable -- --preflight
```

## Runtime requirements

The portable application does not need Node.js, pnpm, or the Visual C++ build tools installed. Python and Git are external runtime tools and are not bundled:

- Python file analysis invokes `python`; install a Python interpreter whose `python` command is on `PATH`. If it is unavailable, Python files remain part of the index but their analysis reports a safe partial-index diagnostic.
- Git operations invoke `git`; put Git for Windows on `PATH` to use Git import and change comparison. If Git is unavailable, those operations report a safe diagnostic.
- JavaScript and TypeScript static indexing uses the packaged application and does not require Python or Git.

After changing `PATH`, verify the tools in a new terminal, fully exit and restart Project X-Ray, then update the index. Restarting alone restores the saved snapshot; re-indexing produces the currently available analysis result. A recovered or degraded analyzer result has a distinct snapshot identity, while reusing the same result preserves its historical contents and creation time.

Application data is stored in Electron's per-user `userData` directory, not beside the portable executable. Keep that directory when moving or replacing the executable if the saved snapshots are needed.

The coordinator operated the rebuilt outer portable executable on Windows to verify missing Python/Git, safe retry, TS source navigation, dependency recovery, immutable snapshot reuse, and cross-project restart. Exact artifact hashes and limits are in the [independent acceptance record](development-runs/2026-10-01-windows-independent-review.md). The child-process PATH simulation is not clean-machine or installer acceptance.
