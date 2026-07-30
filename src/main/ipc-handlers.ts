import { randomUUID } from "node:crypto";
import type { SidecarClient } from "./sidecar-client";

export type IpcMainLike = {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
};

export function registerIpcHandlers(ipcMain: IpcMainLike, client: SidecarClient): void {
  const images = new Map<string, Buffer>();

  ipcMain.handle("image:import", (_event, args) => {
    const { buffer } = args as { buffer: Buffer };
    const imageId = randomUUID();
    images.set(imageId, buffer);
    return { imageId };
  });

  ipcMain.handle("image:detect", async (_event, args) => {
    const { imageId } = args as { imageId: string };
    const image = images.get(imageId);
    if (image === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = await client.detect(image);
    return { maskBase64: mask.toString("base64") };
  });

  ipcMain.handle("image:inpaint", async (_event, args) => {
    const { imageId, maskBase64 } = args as { imageId: string; maskBase64: string };
    const image = images.get(imageId);
    if (image === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = Buffer.from(maskBase64, "base64");
    const result = await client.inpaint(image, mask);
    images.set(imageId, result);
    return { resultBase64: result.toString("base64") };
  });
}
