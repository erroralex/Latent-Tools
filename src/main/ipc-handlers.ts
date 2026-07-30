import { randomUUID } from "node:crypto";
import type { SidecarClient } from "./sidecar-client";

export type IpcMainLike = {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
};

export type ShowSaveDialogFn = (defaultPath: string) => Promise<string | undefined>;
export type WriteFileFn = (path: string, data: Buffer) => Promise<void>;

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  client: SidecarClient,
  showSaveDialog: ShowSaveDialogFn,
  writeFile: WriteFileFn,
): void {
  const images = new Map<string, { normalized: Buffer; original: Buffer }>();

  ipcMain.handle("image:import", async (_event, args) => {
    const { buffer } = args as { buffer: Uint8Array };
    const original = Buffer.from(buffer);
    const normalized = await client.normalize(original);
    const imageId = randomUUID();
    images.set(imageId, { normalized, original });
    return { imageId, previewBase64: normalized.toString("base64") };
  });

  ipcMain.handle("image:detect", async (_event, args) => {
    const { imageId } = args as { imageId: string };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = await client.detect(entry.normalized);
    return { maskBase64: mask.toString("base64") };
  });

  ipcMain.handle("image:inpaint", async (_event, args) => {
    const { imageId, maskBase64 } = args as { imageId: string; maskBase64: string };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = Buffer.from(maskBase64, "base64");
    const result = await client.inpaint(entry.normalized, mask);
    images.set(imageId, { ...entry, normalized: result });
    return { resultBase64: result.toString("base64") };
  });

  ipcMain.handle("image:caption", async (_event, args) => {
    const { imageId } = args as { imageId: string };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const caption = await client.caption(entry.normalized);
    return { caption };
  });

  ipcMain.handle("image:export", async (_event, args) => {
    const {
      imageId,
      format = "png",
      quality = 90,
      lossless = false,
      compressLevel = 6,
      metadataMode = "strip",
      flattenColor = "#FFFFFF",
      caption,
    } = args as {
      imageId: string;
      format?: string;
      quality?: number;
      lossless?: boolean;
      compressLevel?: number;
      metadataMode?: string;
      flattenColor?: string;
      caption?: string;
    };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const ext = format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase();
    const filePath = await showSaveDialog(`output.${ext}`);
    if (filePath === undefined) {
      return { saved: false };
    }
    const { result } = await client.convert(entry.normalized, {
      format,
      quality,
      lossless,
      compressLevel,
      metadataMode,
      originalBase64: entry.original.toString("base64"),
      flattenColor,
    });
    await writeFile(filePath, result);
    if (caption && caption.trim().length > 0) {
      const txtPath = filePath.replace(/\.[^/.]+$/, ".txt");
      await writeFile(txtPath, Buffer.from(caption.trim(), "utf-8"));
    }
    return { saved: true, filePath };
  });

  ipcMain.handle("image:save", async (_event, args) => {
    const { imageId } = args as { imageId: string };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const filePath = await showSaveDialog("output.png");
    if (filePath === undefined) {
      return { saved: false };
    }
    await writeFile(filePath, entry.normalized);
    return { saved: true, filePath };
  });
}


