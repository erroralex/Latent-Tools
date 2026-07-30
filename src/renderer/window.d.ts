interface Window {
  api: {
    // Sidecar Listener
    onSidecarStateChange: (callback: (state: string) => void) => void;

    // GPU Status
    getGpuStatus: () => Promise<{
      name: string;
      vram_used_mb: number;
      vram_total_mb: number;
      vram_used_gb: number;
      vram_total_gb: number;
      vram_pct: number;
      temperature_c: number | null;
      status: string;
    }>;

    // Window Controls
    minimizeWindow: () => Promise<{ success: boolean }>;


    maximizeWindow: () => Promise<{ isMaximized: boolean }>;
    closeWindow: () => Promise<{ success: boolean }>;
    isWindowMaximized: () => Promise<{ isMaximized: boolean }>;

    // Bulk & Folder
    selectFolder: () => Promise<{ folderPath?: string }>;
    listImagesInFolder: (folderPath: string) => Promise<{ files: string[] }>;
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
    }) => Promise<{ success: boolean; outputPath: string }>;

    // Single Image Operations
    importImage: (buffer: Uint8Array) => Promise<{ imageId: string; previewBase64?: string }>;
    detect: (imageId: string) => Promise<{ maskBase64: string }>;
    inpaint: (imageId: string, maskBase64?: string) => Promise<{ resultBase64: string }>;
    updateMask: (imageId: string, maskBase64: string) => Promise<{ success: boolean }>;
    captionImage: (imageId: string, systemPrompt?: string) => Promise<{ caption: string | null }>;


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
    ) => Promise<{ saved: boolean; filePath?: string }>;
  };
}



