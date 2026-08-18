import * as fs from "node:fs";
import * as path from "node:path";

export type SidecarLaunchTarget = {
  cwd: string;
  executable: string;
  scriptArgs: string[];
};

export type ResolveSidecarLaunchTargetOptions = {
  isPackaged: boolean;
  resourcesPath: string;
  sourceRootDir: string;
  port: string;
  platform: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
};

export function resolveSidecarLaunchTarget(
  options: ResolveSidecarLaunchTargetOptions,
): SidecarLaunchTarget {
  const existsSync = options.existsSync ?? fs.existsSync;
  const cwd = options.isPackaged
    ? path.join(options.resourcesPath, "sidecar")
    : path.join(options.sourceRootDir, "sidecar");

  // electron-builder's extraResources copies the whole sidecar/ directory verbatim,
  // so PyInstaller's onedir output lands at dist/sidecar/sidecar.exe under cwd, not
  // directly under cwd.
  const standaloneExe = path.join(cwd, "dist", "sidecar", "sidecar.exe");
  if (existsSync(standaloneExe)) {
    return { cwd, executable: standaloneExe, scriptArgs: ["--port", options.port] };
  }

  const venvPython =
    options.platform === "win32"
      ? path.join(cwd, ".venv", "Scripts", "python.exe")
      : path.join(cwd, ".venv", "bin", "python");
  const pythonExec = existsSync(venvPython) ? venvPython : "python";
  return { cwd, executable: pythonExec, scriptArgs: ["run.py", "--port", options.port] };
}
