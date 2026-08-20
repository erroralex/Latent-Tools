import * as fs from "node:fs";
import * as path from "node:path";

export type SidecarLaunchTarget = {
  cwd: string;
  executable: string;
  scriptArgs: string[];
};

export type ResolveSidecarLaunchTargetOptions = {
  isPackaged: boolean;
  userDataDir: string;
  sourceRootDir: string;
  port: string;
  platform: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
};

export function getSidecarRuntimeDir(userDataDir: string): string {
  return path.join(userDataDir, "sidecar-runtime");
}

export function isSidecarRuntimeInstalled(
  userDataDir: string,
  existsSync: (path: string) => boolean = fs.existsSync,
): boolean {
  return existsSync(sidecarExePath(getSidecarRuntimeDir(userDataDir)));
}

function sidecarExePath(runtimeDir: string): string {
  // CI zips dist/sidecar/* directly (Compress-Archive -Path dist\sidecar\*), so the
  // downloaded archive's root already is the PyInstaller onedir output - sidecar.exe
  // sits straight under runtimeDir, not nested under dist/sidecar/.
  return path.join(runtimeDir, "sidecar.exe");
}

export function resolveSidecarLaunchTarget(
  options: ResolveSidecarLaunchTargetOptions,
): SidecarLaunchTarget {
  const existsSync = options.existsSync ?? fs.existsSync;

  if (options.isPackaged) {
    // Packaged builds never bundle the sidecar - it's downloaded on demand
    // into userData (see sidecar-downloader.ts). Callers must check
    // isSidecarRuntimeInstalled() before starting the process; this always
    // points at where a download would have placed it.
    const cwd = getSidecarRuntimeDir(options.userDataDir);
    return {
      cwd,
      executable: sidecarExePath(cwd),
      scriptArgs: ["--port", options.port],
    };
  }

  // Unpackaged (local dev): resolve against the source tree's own venv,
  // same as before this change.
  const cwd = path.join(options.sourceRootDir, "sidecar");
  const venvPython =
    options.platform === "win32"
      ? path.join(cwd, ".venv", "Scripts", "python.exe")
      : path.join(cwd, ".venv", "bin", "python");
  const pythonExec = existsSync(venvPython) ? venvPython : "python";

  return { cwd, executable: pythonExec, scriptArgs: ["run.py", "--port", options.port] };
}
