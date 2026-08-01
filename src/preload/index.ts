import { contextBridge, ipcRenderer, webFrame, shell, webUtils } from "electron";

contextBridge.exposeInMainWorld("api", {
  // External link opener
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", { url }),

  // File Path Utilities for drag and drop
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Sidecar State Listener

  onSidecarStateChange: (callback: (state: string) => void) => {
    ipcRenderer.on("sidecar:state", (_event, data: { state: string }) => callback(data.state));
  },

  // UI Zoom Factor Controls
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),

  // GPU Status
  getGpuStatus: () => ipcRenderer.invoke("gpu:status"),


  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),


  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:isMaximized"),

  // Bulk & Folder
  selectFolder: () => ipcRenderer.invoke("folder:select"),
  listImagesInFolder: (folderPath: string) =>
    ipcRenderer.invoke("folder:list-images", { folderPath }),
  processBulkItem: (options: {
    inputPath: string;
    outputFolder: string;
    autoRemoveWatermark?: boolean;
    generateCaption?: boolean;
    format?: string;
    quality?: number;
    lossless?: boolean;
    compressLevel?: number;
    metadataMode?: string;
    flattenColor?: string;
    systemPrompt?: string;
    modelId?: string;
  }) => ipcRenderer.invoke("bulk:process-item", options),

  // Single Image Operations
  importImage: (buffer: Uint8Array) => ipcRenderer.invoke("image:import", { buffer }),
  detect: (imageId: string) => ipcRenderer.invoke("image:detect", { imageId }),
  inpaint: (imageId: string, maskBase64?: string) =>
    ipcRenderer.invoke("image:inpaint", { imageId, maskBase64 }),
  updateMask: (imageId: string, maskBase64: string) =>
    ipcRenderer.invoke("mask:update", { imageId, maskBase64 }),
  save: (imageId: string) => ipcRenderer.invoke("image:save", { imageId }),

  captionImage: (imageId: string, systemPrompt?: string, modelId?: string) =>
    ipcRenderer.invoke("image:caption", { imageId, systemPrompt, modelId }),

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



