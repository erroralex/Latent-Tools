import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell } from "electron";
import { SidecarClient } from "./sidecar-client";
import { SidecarProcess } from "./sidecar-process";
import {
  resolveSidecarLaunchTarget,
  isSidecarRuntimeInstalled,
  getSidecarRuntimeDir,
} from "./sidecar-launch-target";
import { downloadSidecarRuntime, type DownloadProgress } from "./sidecar-downloader";
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

function getSidecarLaunchTarget() {
  return resolveSidecarLaunchTarget({
    isPackaged: app.isPackaged,
    userDataDir: app.getPath("userData"),
    sourceRootDir: path.join(__dirname, "../.."),
    port: SIDECAR_PORT,
    platform: process.platform,
  });
}

function spawnSidecarProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, { ...options, cwd: getSidecarLaunchTarget().cwd });
}

function broadcastSidecarState(state: string, reason?: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("sidecar:state", { state, reason });
  }
}

async function createWindow(): Promise<void> {
  const client = new SidecarClient(SIDECAR_URL);
  let sidecarProcess: SidecarProcess | undefined;

  async function startSidecar(): Promise<void> {
    const { executable, scriptArgs } = getSidecarLaunchTarget();
    sidecarProcess = new SidecarProcess({
      spawnFn: spawnSidecarProcess,
      client,
      pythonExecutable: executable,
      scriptArgs,
    });
    sidecarProcess.onStateChange((state, reason) => broadcastSidecarState(state, reason));
    await sidecarProcess.start();
  }

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
    async (url) => {
      await shell.openExternal(url);
    },
  );

  ipcMain.handle("sidecar:download", async () => {
    try {
      broadcastSidecarState("downloading");
      await downloadSidecarRuntime({
        version: app.getVersion(),
        destDir: getSidecarRuntimeDir(app.getPath("userData")),
        onProgress: (progress: DownloadProgress) => {
          window.webContents.send("sidecar:download-progress", progress);
        },
      });
      await startSidecar();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Sidecar runtime download/start failed:", err);
      broadcastSidecarState("error", message);
      return { success: false, error: message };
    }
  });

  // Await the page load before sending any sidecar state: window.webContents.send()
  // only reaches a listener once the renderer has called onSidecarStateChange(), which
  // races a fire-and-forget loadFile(). On a fresh packaged install the "not_installed"
  // broadcast below is a single synchronous message with no follow-up, so losing that
  // race left the status pill stuck on its static "Starting..." HTML forever.
  await window.loadFile(path.join(__dirname, "../renderer/index.html"));

  if (app.isPackaged && !isSidecarRuntimeInstalled(app.getPath("userData"))) {
    broadcastSidecarState("not_installed");
  } else {
    await startSidecar();
  }

  let isQuitting = false;
  app.on("before-quit", (event) => {
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    void (sidecarProcess?.stop() ?? Promise.resolve()).finally(() => app.quit());
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
