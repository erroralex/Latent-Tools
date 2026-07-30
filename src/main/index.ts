import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { SidecarClient } from "./sidecar-client";
import { SidecarProcess } from "./sidecar-process";
import { registerIpcHandlers } from "./ipc-handlers";

const SIDECAR_URL = "http://127.0.0.1:8756";
const SIDECAR_CWD = path.join(__dirname, "../../sidecar");

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
    pythonExecutable: "python",
    scriptArgs: ["run.py"],
  });
  sidecarProcess.onStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("sidecar:state", { state });
    }
  });

  registerIpcHandlers(ipcMain, client);

  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });
  void window.loadFile("src/renderer/index.html");

  await sidecarProcess.start();

  app.on("before-quit", () => {
    void sidecarProcess.stop();
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
