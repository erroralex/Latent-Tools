import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getSidecarRuntimeDir,
  isSidecarRuntimeInstalled,
  resolveSidecarLaunchTarget,
} from "../src/main/sidecar-launch-target";

describe("resolveSidecarLaunchTarget", () => {
  it("resolves the packaged sidecar exe from userData/sidecar-runtime, not resourcesPath", () => {
    const target = resolveSidecarLaunchTarget({
      isPackaged: true,
      userDataDir: "C:\\Users\\test\\AppData\\Roaming\\latent-tools",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
    });

    expect(target.executable).toBe(
      "C:\\Users\\test\\AppData\\Roaming\\latent-tools\\sidecar-runtime\\sidecar.exe",
    );
    expect(target.cwd).toBe("C:\\Users\\test\\AppData\\Roaming\\latent-tools\\sidecar-runtime");
    expect(target.scriptArgs).toEqual(["--port", "8756"]);
  });

  it("resolves cwd under the source tree, not userData, when unpackaged", () => {
    const existsSync = vi.fn(() => false);

    const target = resolveSidecarLaunchTarget({
      isPackaged: false,
      userDataDir: "C:\\Users\\test\\AppData\\Roaming\\latent-tools",
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
      userDataDir: "C:\\Users\\test\\AppData\\Roaming\\latent-tools",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.executable).toBe(venvPython);
    expect(target.scriptArgs).toEqual(["run.py", "--port", "8756"]);
  });

  it("uses the POSIX venv layout (.venv/bin/python) on non-Windows platforms when unpackaged", () => {
    const venvPython = path.join("C:\\src", "sidecar", ".venv", "bin", "python");
    const existsSync = vi.fn((target: string) => target === venvPython);

    const target = resolveSidecarLaunchTarget({
      isPackaged: false,
      userDataDir: "C:\\Users\\test\\AppData\\Roaming\\latent-tools",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "linux",
      existsSync,
    });

    expect(target.executable).toBe(venvPython);
  });

  it("falls back to bare 'python' when unpackaged and no venv exists", () => {
    const existsSync = vi.fn(() => false);

    const target = resolveSidecarLaunchTarget({
      isPackaged: false,
      userDataDir: "C:\\Users\\test\\AppData\\Roaming\\latent-tools",
      sourceRootDir: "C:\\src",
      port: "8756",
      platform: "win32",
      existsSync,
    });

    expect(target.executable).toBe("python");
    expect(target.scriptArgs).toEqual(["run.py", "--port", "8756"]);
  });
});

describe("isSidecarRuntimeInstalled", () => {
  it("is true when the downloaded exe exists", () => {
    const existsSync = vi.fn(
      (p: string) =>
        p === "C:\\Users\\test\\AppData\\Roaming\\latent-tools\\sidecar-runtime\\sidecar.exe",
    );

    expect(
      isSidecarRuntimeInstalled("C:\\Users\\test\\AppData\\Roaming\\latent-tools", existsSync),
    ).toBe(true);
  });

  it("is false when nothing has been downloaded yet", () => {
    const existsSync = vi.fn(() => false);

    expect(
      isSidecarRuntimeInstalled("C:\\Users\\test\\AppData\\Roaming\\latent-tools", existsSync),
    ).toBe(false);
  });
});

describe("getSidecarRuntimeDir", () => {
  it("joins userData with sidecar-runtime", () => {
    expect(getSidecarRuntimeDir("C:\\Users\\test\\AppData\\Roaming\\latent-tools")).toBe(
      "C:\\Users\\test\\AppData\\Roaming\\latent-tools\\sidecar-runtime",
    );
  });
});
