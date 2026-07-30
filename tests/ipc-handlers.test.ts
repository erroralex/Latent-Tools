import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc-handlers";
import type { SidecarClient } from "../src/main/sidecar-client";

describe("registerIpcHandlers", () => {
  function setup(showSaveDialogResult: string | undefined) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    };
    const client = {
      detect: vi.fn().mockResolvedValue(Buffer.from("mask-bytes")),
      inpaint: vi.fn().mockResolvedValue(Buffer.from("result-bytes")),
    } as unknown as SidecarClient;
    const showSaveDialog = vi.fn().mockResolvedValue(showSaveDialogResult);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    registerIpcHandlers(ipcMain, client, showSaveDialog, writeFile);
    return { handlers, client, showSaveDialog, writeFile };
  }

  it("registers image:import, image:detect, image:inpaint, and image:save", () => {
    const { handlers } = setup("C:\\chosen\\output.png");
    expect(handlers.has("image:import")).toBe(true);
    expect(handlers.has("image:detect")).toBe(true);
    expect(handlers.has("image:inpaint")).toBe(true);
    expect(handlers.has("image:save")).toBe(true);
  });

  it("image:import assigns and returns an imageId", async () => {
    const { handlers } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    if (importHandler === undefined) throw new Error("handler not registered");

    const result = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    expect(typeof result.imageId).toBe("string");
    expect(result.imageId.length).toBeGreaterThan(0);
  });

  it("image:detect calls client.detect with the imported image's bytes", async () => {
    const { handlers, client } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    const detectHandler = handlers.get("image:detect");
    if (importHandler === undefined || detectHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    const result = (await detectHandler({}, { imageId })) as { maskBase64: string };

    expect(client.detect).toHaveBeenCalledWith(Buffer.from("png-bytes"));
    expect(Buffer.from(result.maskBase64, "base64").toString()).toBe("mask-bytes");
  });

  it("image:detect rejects an unknown imageId", async () => {
    const { handlers } = setup("C:\\chosen\\output.png");
    const detectHandler = handlers.get("image:detect");
    if (detectHandler === undefined) throw new Error("handler not registered");

    await expect(detectHandler({}, { imageId: "does-not-exist" })).rejects.toThrow(
      /unknown imageId/i,
    );
  });

  it("image:save writes the current image's bytes to the chosen path", async () => {
    const { handlers, showSaveDialog, writeFile } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    const saveHandler = handlers.get("image:save");
    if (importHandler === undefined || saveHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    const result = (await saveHandler({}, { imageId })) as { saved: boolean; filePath?: string };

    expect(showSaveDialog).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith("C:\\chosen\\output.png", Buffer.from("png-bytes"));
    expect(result).toEqual({ saved: true, filePath: "C:\\chosen\\output.png" });
  });

  it("image:save saves the inpainted result, not the original, once inpaint has run", async () => {
    const { handlers, writeFile } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    const inpaintHandler = handlers.get("image:inpaint");
    const saveHandler = handlers.get("image:save");
    if (importHandler === undefined || inpaintHandler === undefined || saveHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    await inpaintHandler({}, { imageId, maskBase64: Buffer.from("mask").toString("base64") });
    await saveHandler({}, { imageId });

    expect(writeFile).toHaveBeenCalledWith("C:\\chosen\\output.png", Buffer.from("result-bytes"));
  });

  it("image:save returns saved:false without writing when the dialog is canceled", async () => {
    const { handlers, writeFile } = setup(undefined);
    const importHandler = handlers.get("image:import");
    const saveHandler = handlers.get("image:save");
    if (importHandler === undefined || saveHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    const result = (await saveHandler({}, { imageId })) as { saved: boolean };

    expect(result).toEqual({ saved: false });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("image:save rejects an unknown imageId", async () => {
    const { handlers } = setup("C:\\chosen\\output.png");
    const saveHandler = handlers.get("image:save");
    if (saveHandler === undefined) throw new Error("handler not registered");

    await expect(saveHandler({}, { imageId: "does-not-exist" })).rejects.toThrow(
      /unknown imageId/i,
    );
  });
});
