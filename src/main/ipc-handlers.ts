import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { SidecarClient } from "./sidecar-client";

export type IpcMainLike = {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
};

export type ShowSaveDialogFn = (defaultPath: string) => Promise<string | undefined>;
export type WriteFileFn = (filePath: string, data: Buffer) => Promise<void>;
export type ShowOpenDialogFn = () => Promise<string | undefined>;
export type ReadDirFn = (folderPath: string) => Promise<string[]>;
export type ReadFileFn = (filePath: string) => Promise<Buffer>;
export type GetWindowFn = () => {
  isMinimized: () => boolean;
  isMaximized: () => boolean;
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  close: () => void;
} | null;

function callCaption(
  client: SidecarClient,
  image: Buffer,
  systemPrompt?: string,
  modelId?: string,
): Promise<string | null> {
  if (modelId) return client.caption(image, systemPrompt, modelId);
  if (systemPrompt) return client.caption(image, systemPrompt);
  return client.caption(image);
}

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  client: SidecarClient,
  showSaveDialog: ShowSaveDialogFn,
  writeFile: WriteFileFn,
  showOpenDialog?: ShowOpenDialogFn,
  readDir?: ReadDirFn,
  readFile?: ReadFileFn,
  getWindow?: GetWindowFn,
): void {
  const images = new Map<string, { normalized: Buffer; original: Buffer; currentMask?: Buffer }>();

  // Window Controls
  ipcMain.handle("window:minimize", async () => {
    const win = getWindow?.();
    win?.minimize();
    return { success: true };
  });

  ipcMain.handle("window:maximize", async () => {
    const win = getWindow?.();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return { isMaximized: win?.isMaximized() ?? false };
  });

  ipcMain.handle("window:close", async () => {
    const win = getWindow?.();
    win?.close();
    return { success: true };
  });

  ipcMain.handle("window:isMaximized", async () => {
    const win = getWindow?.();
    return { isMaximized: win?.isMaximized() ?? false };
  });

  // Bulk Processing & Folders
  ipcMain.handle("folder:select", async () => {
    if (!showOpenDialog) {
      return { folderPath: undefined };
    }
    const folderPath = await showOpenDialog();
    return { folderPath };
  });

  ipcMain.handle("folder:list-images", async (_event, args) => {
    const { folderPath } = args as { folderPath: string };
    if (!readDir) {
      return { files: [] };
    }
    const entries = await readDir(folderPath);
    const files = entries.filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));
    return { files };
  });

  ipcMain.handle("bulk:process-item", async (_event, args) => {
    const {
      inputPath,
      outputFolder,
      autoRemoveWatermark = false,
      generateCaption = false,
      format = "png",
      quality = 90,
      lossless = false,
      compressLevel = 6,
      metadataMode = "strip",
      flattenColor = "#FFFFFF",
      systemPrompt,
      modelId,
    } = args as {
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
    };

    if (!readFile) throw new Error("readFile handler not configured");

    const rawBuffer = await readFile(inputPath);
    let workingNormalized = await client.normalize(rawBuffer);

    if (autoRemoveWatermark) {
      const mask = await client.detect(workingNormalized);
      workingNormalized = await client.inpaint(workingNormalized, mask);
    }

    let captionText: string | null = null;
    if (generateCaption) {
      captionText = await callCaption(client, workingNormalized, systemPrompt, modelId);
    }



    const { result } = await client.convert(workingNormalized, {
      format,
      quality,
      lossless,
      compressLevel,
      metadataMode,
      originalBase64: rawBuffer.toString("base64"),
      flattenColor,
    });

    const parsedPath = path.parse(inputPath);
    const ext = format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase();
    const outputFilename = `${parsedPath.name}.${ext}`;
    const outputImagePath = path.join(outputFolder, outputFilename);

    await writeFile(outputImagePath, result);

    if (captionText && captionText.trim().length > 0) {
      const txtFilename = `${parsedPath.name}.txt`;
      const outputTxtPath = path.join(outputFolder, txtFilename);
      await writeFile(outputTxtPath, Buffer.from(captionText.trim(), "utf-8"));
    }

    return { success: true, outputPath: outputImagePath };
  });

  // Single Image Operations
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
    images.set(imageId, { ...entry, currentMask: mask });
    return { maskBase64: mask.toString("base64") };
  });

  ipcMain.handle("mask:update", async (_event, args) => {
    const { imageId, maskBase64 } = args as { imageId: string; maskBase64: string };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const currentMask = Buffer.from(maskBase64, "base64");
    images.set(imageId, { ...entry, currentMask });
    return { success: true };
  });

  ipcMain.handle("image:inpaint", async (_event, args) => {
    const { imageId, maskBase64 } = args as { imageId: string; maskBase64?: string };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = maskBase64 ? Buffer.from(maskBase64, "base64") : entry.currentMask;
    if (mask === undefined) {
      throw new Error(`No mask available for imageId: ${imageId}`);
    }
    const result = await client.inpaint(entry.normalized, mask);
    images.set(imageId, { ...entry, normalized: result });
    return { resultBase64: result.toString("base64") };
  });

  ipcMain.handle("image:caption", async (_event, args) => {
    const { imageId, systemPrompt, modelId } = args as {
      imageId: string;
      systemPrompt?: string;
      modelId?: string;
    };
    const entry = images.get(imageId);
    if (entry === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const caption = await callCaption(client, entry.normalized, systemPrompt, modelId);
    return { caption };
  });

  ipcMain.handle("gpu:status", async () => {
    return await client.gpuStatus();
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



