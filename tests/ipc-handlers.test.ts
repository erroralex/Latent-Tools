import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc-handlers";
import type { SidecarClient } from "../src/main/sidecar-client";

describe("registerIpcHandlers", () => {
  function setup() {
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

    registerIpcHandlers(ipcMain, client);
    return { handlers, client };
  }

  it("registers image:import, image:detect, and image:inpaint", () => {
    const { handlers } = setup();
    expect(handlers.has("image:import")).toBe(true);
    expect(handlers.has("image:detect")).toBe(true);
    expect(handlers.has("image:inpaint")).toBe(true);
  });

  it("image:import assigns and returns an imageId", async () => {
    const { handlers } = setup();
    const importHandler = handlers.get("image:import");
    if (importHandler === undefined) throw new Error("handler not registered");

    const result = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    expect(typeof result.imageId).toBe("string");
    expect(result.imageId.length).toBeGreaterThan(0);
  });

  it("image:detect calls client.detect with the imported image's bytes", async () => {
    const { handlers, client } = setup();
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
    const { handlers } = setup();
    const detectHandler = handlers.get("image:detect");
    if (detectHandler === undefined) throw new Error("handler not registered");

    await expect(detectHandler({}, { imageId: "does-not-exist" })).rejects.toThrow(
      /unknown imageId/i,
    );
  });
});
