import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  importImage: (buffer: Uint8Array) => ipcRenderer.invoke("image:import", { buffer }),
  detect: (imageId: string) => ipcRenderer.invoke("image:detect", { imageId }),
  inpaint: (imageId: string, maskBase64: string) =>
    ipcRenderer.invoke("image:inpaint", { imageId, maskBase64 }),
});
