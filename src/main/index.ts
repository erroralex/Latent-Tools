import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } from "electron";
import { SidecarClient } from "./sidecar-client";
import { SidecarProcess } from "./sidecar-process";
import { registerIpcHandlers } from "./ipc-handlers";

const SIDECAR_PORT = process.env.LATENT_SIDECAR_PORT || process.env.PORT || "8756";
const SIDECAR_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

let tray: Tray | undefined;

function getAppIconPath(): string {
  return path.join(__dirname, "../renderer/assets/lt_icon.png");
}

function createTray(window: BrowserWindow): void {
  const trayIcon = nativeImage.createFromPath(getAppIconPath()).resize({ width: 32, height: 32 });
  tray = new Tray(trayIcon);
  tray.setToolTip("Latent Tools");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Latent Tools",
        click: () => {
          window.show();
          window.focus();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("double-click", () => {
    window.show();
    window.focus();
  });
}

function getSidecarCwd(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sidecar")
    : path.join(__dirname, "../../sidecar");
}

function resolvePythonExecutable(): { executable: string; scriptArgs: string[] } {
  const cwd = getSidecarCwd();
  const standaloneExe = path.join(cwd, "sidecar.exe");
  const standaloneExeSub = path.join(cwd, "sidecar", "sidecar.exe");

  if (fs.existsSync(standaloneExe)) {
    return { executable: standaloneExe, scriptArgs: ["--port", SIDECAR_PORT] };
  }
  if (fs.existsSync(standaloneExeSub)) {
    return { executable: standaloneExeSub, scriptArgs: ["--port", SIDECAR_PORT] };
  }

  const venvPython =
    process.platform === "win32"
      ? path.join(cwd, ".venv", "Scripts", "python.exe")
      : path.join(cwd, ".venv", "bin", "python");
  const pythonExec = fs.existsSync(venvPython) ? venvPython : "python";
  return { executable: pythonExec, scriptArgs: ["run.py", "--port", SIDECAR_PORT] };
}

function spawnSidecarProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, { ...options, cwd: getSidecarCwd() });
}

async function createWindow(): Promise<void> {
  const { executable, scriptArgs } = resolvePythonExecutable();
  const client = new SidecarClient(SIDECAR_URL);
  const sidecarProcess = new SidecarProcess({
    spawnFn: spawnSidecarProcess,
    client,
    pythonExecutable: executable,
    scriptArgs,
  });

  sidecarProcess.onStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("sidecar:state", { state });
    }
  });

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    frame: false,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });

  createTray(window);


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
