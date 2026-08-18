import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveSidecarLaunchTarget } from "../src/main/sidecar-launch-target";

describe("resolveSidecarLaunchTarget", () => {
  it("uses the PyInstaller onedir output at dist/sidecar/sidecar.exe when packaged", () => {
    const pyinstallerOutput = "C:\\resources\\sidecar\\dist\\sidecar\\sidecar.exe";
    const existsSync = vi.fn((target: string) => target === pyinstallerOutput);

    const target = resolveSidecarLaunchTarget({
      isPackaged: true,
      resourcesPath: "C:\\resources",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.executable).toBe(pyinstallerOutput);
    expect(target.scriptArgs).toEqual(["--port", "8756"]);
    expect(target.cwd).toBe("C:\\resources\\sidecar");
  });

  it("falls back to the venv python when packaged but the compiled exe is missing", () => {
    const venvPython = "C:\\resources\\sidecar\\.venv\\Scripts\\python.exe";
    const existsSync = vi.fn((target: string) => target === venvPython);

    const target = resolveSidecarLaunchTarget({
      isPackaged: true,
      resourcesPath: "C:\\resources",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.executable).toBe(venvPython);
    expect(target.scriptArgs).toEqual(["run.py", "--port", "8756"]);
  });

  it("falls back to bare 'python' on PATH when neither the exe nor a venv exists", () => {
    const existsSync = vi.fn(() => false);

    const target = resolveSidecarLaunchTarget({
      isPackaged: true,
      resourcesPath: "C:\\resources",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.executable).toBe("python");
    expect(target.scriptArgs).toEqual(["run.py", "--port", "8756"]);
  });

  it("resolves cwd under the source tree, not resourcesPath, when unpackaged", () => {
    const existsSync = vi.fn(() => false);

    const target = resolveSidecarLaunchTarget({
      isPackaged: false,
      resourcesPath: "C:\\resources",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.cwd).toBe("C:\\src\\sidecar");
  });

  it("uses the source tree's venv python for local dev when unpackaged", () => {
    const venvPython = "C:\\src\\sidecar\\.venv\\Scripts\\python.exe";
    const existsSync = vi.fn((target: string) => target === venvPython);

    const target = resolveSidecarLaunchTarget({
      isPackaged: false,
      resourcesPath: "C:\\resources",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.executable).toBe(venvPython);
    expect(target.scriptArgs).toEqual(["run.py", "--port", "8756"]);
  });

  it("uses the POSIX venv layout (.venv/bin/python) on non-Windows platforms", () => {
    const venvPython = path.join("C:\\src", "sidecar", ".venv", "bin", "python");
    const existsSync = vi.fn((target: string) => target === venvPython);

    const target = resolveSidecarLaunchTarget({
      isPackaged: false,
      resourcesPath: "C:\\resources",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "linux",
      existsSync,
    });

    expect(target.executable).toBe(venvPython);
  });
});
