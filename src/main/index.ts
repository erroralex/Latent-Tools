import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { SidecarClient } from "./sidecar-client";
import { SidecarProcess } from "./sidecar-process";
import { registerIpcHandlers } from "./ipc-handlers";

const SIDECAR_URL = "http://127.0.0.1:8756";
const SIDECAR_CWD = path.join(__dirname, "../../sidecar");

// The sidecar's dependencies (iopaint, transformers, cv2, ...) are installed
// into sidecar/.venv, not into whatever "python" resolves to on PATH — a
// system Python has none of them and the spawned process crashes on import
// before it ever binds the health-check port. Prefer the venv interpreter;
// only fall back to bare "python" if the venv hasn't been created yet.
function resolvePythonExecutable(): string {
  const venvPython =
    process.platform === "win32"
      ? path.join(SIDECAR_CWD, ".venv", "Scripts", "python.exe")
      : path.join(SIDECAR_CWD, ".venv", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python";
}

// SidecarProcess always invokes spawnFn with `{}` as the options argument
// (see sidecar-process.ts), so the only way to control the spawned
// process's cwd is to bake it into the spawnFn passed in here. Without
// this, `python run.py` would resolve relative to Electron's own cwd
// instead of `sidecar/`, and the sidecar process would fail to find
// run.py / the `app` package at runtime.
function spawnSidecarProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, { ...options, cwd: SIDECAR_CWD });
}

async function createWindow(): Promise<void> {
  const client = new SidecarClient(SIDECAR_URL);
  const sidecarProcess = new SidecarProcess({
    spawnFn: spawnSidecarProcess,
    client,
    pythonExecutable: resolvePythonExecutable(),
    scriptArgs: ["run.py"],
  });
  sidecarProcess.onStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("sidecar:state", { state });
    }
  });

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });
  window.maximize();

  registerIpcHandlers(
    ipcMain,
    client,
    async (defaultPath) => {
      const result = await dialog.showSaveDialog(window, { defaultPath });
      return result.canceled ? undefined : result.filePath;
    },
    (filePath, data) => fsPromises.writeFile(filePath, data),
    async () => {
      const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    (folderPath) => fsPromises.readdir(folderPath),
    (filePath) => fsPromises.readFile(filePath),
    () => window,
  );

  void window.loadFile(path.join(__dirname, "../renderer/index.html"));


  await sidecarProcess.start();

  let isQuitting = false;
  app.on("before-quit", (event) => {
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    void sidecarProcess.stop().finally(() => app.quit());
  });
}

app.whenReady().then(() => {
  void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
