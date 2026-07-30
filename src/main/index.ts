import { app, BrowserWindow } from "electron";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: `${__dirname}/../preload/index.js`,
    },
  });
  void window.loadFile("src/renderer/index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
