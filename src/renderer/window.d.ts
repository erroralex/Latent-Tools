interface Window {
  api: {
    importImage: (buffer: Uint8Array) => Promise<{ imageId: string }>;
    detect: (imageId: string) => Promise<{ maskBase64: string }>;
    inpaint: (imageId: string, maskBase64: string) => Promise<{ resultBase64: string }>;
  };
}
