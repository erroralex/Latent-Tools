interface Window {
  api: {
    importImage: (buffer: Uint8Array) => Promise<{ imageId: string; previewBase64?: string }>;
    detect: (imageId: string) => Promise<{ maskBase64: string }>;
    inpaint: (imageId: string, maskBase64: string) => Promise<{ resultBase64: string }>;
    captionImage: (imageId: string) => Promise<{ caption: string | null }>;
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


