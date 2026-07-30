import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  importImage: (buffer: Uint8Array) => ipcRenderer.invoke("image:import", { buffer }),
  detect: (imageId: string) => ipcRenderer.invoke("image:detect", { imageId }),
  inpaint: (imageId: string, maskBase64?: string) =>
    ipcRenderer.invoke("image:inpaint", { imageId, maskBase64 }),
  updateMask: (imageId: string, maskBase64: string) =>
    ipcRenderer.invoke("mask:update", { imageId, maskBase64 }),
  save: (imageId: string) => ipcRenderer.invoke("image:save", { imageId }),

  captionImage: (imageId: string) => ipcRenderer.invoke("image:caption", { imageId }),
  exportImage: (
    imageId: string,
    options?: {
      format?: string;
      quality?: number;
      lossless?: boolean;
      compressLevel?: number;
      metadataMode?: string;
      flattenColor?: string;
      caption?: string;
    },
  ) => ipcRenderer.invoke("image:export", { imageId, ...options }),
});


