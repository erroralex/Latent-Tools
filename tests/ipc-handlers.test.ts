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
      normalize: vi.fn().mockImplementation((buf: Buffer) => Promise.resolve(Buffer.from(`normalized-${buf.toString()}`))),
      detect: vi.fn().mockResolvedValue(Buffer.from("mask-bytes")),
      inpaint: vi.fn().mockResolvedValue(Buffer.from("result-bytes")),
      caption: vi.fn().mockResolvedValue("A detailed caption of the image."),
      convert: vi.fn().mockResolvedValue({
        result: Buffer.from("converted-bytes"),
        contentType: "image/webp",
      }),
      process: vi.fn().mockResolvedValue({
        result: Buffer.from("converted-bytes"),
        contentType: "image/webp",
        caption: "A detailed caption of the image.",
      }),
    } as unknown as SidecarClient;
    const showSaveDialog = vi.fn().mockResolvedValue(showSaveDialogResult);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const showOpenDialog = vi.fn().mockResolvedValue("C:\\chosen\\input_dir");
    const readDir = vi.fn().mockResolvedValue(["img1.png", "img2.jpg", "doc.pdf", "notes.txt"]);
    const readFile = vi.fn().mockResolvedValue(Buffer.from("input-image-data"));
    const dummyWindow = {
      isMinimized: vi.fn().mockReturnValue(false),
      isMaximized: vi.fn().mockReturnValue(true),
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
    };

    registerIpcHandlers(
      ipcMain,
      client,
      showSaveDialog,
      writeFile,
      showOpenDialog,
      readDir,
      readFile,
      () => dummyWindow,
    );
    return { handlers, client, showSaveDialog, writeFile, showOpenDialog, readDir, readFile, dummyWindow };
  }

  it("window controls minimize, maximize, and close call target window methods", async () => {
    const { handlers, dummyWindow } = setup("C:\\chosen\\output.png");
    const minHandler = handlers.get("window:minimize");
    const maxHandler = handlers.get("window:maximize");
    const closeHandler = handlers.get("window:close");

    if (!minHandler || !maxHandler || !closeHandler) throw new Error("handlers missing");

    await minHandler({});
    expect(dummyWindow.minimize).toHaveBeenCalled();

    await maxHandler({});
    expect(dummyWindow.unmaximize).toHaveBeenCalled();

    await closeHandler({});
    expect(dummyWindow.close).toHaveBeenCalled();
  });

  it("folder:list-images filters only supported image extensions", async () => {
    const { handlers } = setup("C:\\chosen\\output.png");
    const listHandler = handlers.get("folder:list-images");
    if (!listHandler) throw new Error("folder:list-images missing");

    const { files } = (await listHandler({}, { folderPath: "C:\\my_folder" })) as { files: string[] };
    expect(files).toEqual(["img1.png", "img2.jpg"]);
  });

  it("bulk:process-item runs the full pipeline in a single sidecar /process call", async () => {
    const { handlers, client, readFile, writeFile } = setup("C:\\chosen\\output.png");
    const bulkHandler = handlers.get("bulk:process-item");
    if (!bulkHandler) throw new Error("bulk:process-item missing");

    const result = (await bulkHandler(
      {},
      {
        inputPath: "C:\\my_folder\\photo.png",
        outputFolder: "C:\\out_folder",
        autoRemoveWatermark: true,
        generateCaption: true,
        format: "webp",
      },
    )) as { success: boolean; outputPath: string };

    expect(client.normalize).not.toHaveBeenCalled();
    expect(client.detect).not.toHaveBeenCalled();
    expect(client.inpaint).not.toHaveBeenCalled();
    expect(client.caption).not.toHaveBeenCalled();
    expect(client.convert).not.toHaveBeenCalled();
    expect(client.process).toHaveBeenCalledWith(await readFile.mock.results[0]!.value, {
      autoRemoveWatermark: true,
      generateCaption: true,
      systemPrompt: undefined,
      modelId: undefined,
      format: "webp",
      quality: 90,
      lossless: false,
      compressLevel: 6,
      metadataMode: "strip",
      flattenColor: "#FFFFFF",
    });
    expect(writeFile).toHaveBeenCalledWith(
      "C:\\out_folder\\photo.webp",
      Buffer.from("converted-bytes"),
    );
    expect(writeFile).toHaveBeenCalledWith(
      "C:\\out_folder\\photo.txt",
      Buffer.from("A detailed caption of the image.", "utf-8"),
    );
    expect(result.success).toBe(true);
  });


  it("mask:update stores currentMask and image:inpaint uses stored mask when not passed", async () => {
    const { handlers, client } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    const updateMaskHandler = handlers.get("mask:update");
    const inpaintHandler = handlers.get("image:inpaint");
    if (importHandler === undefined || updateMaskHandler === undefined || inpaintHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    await updateMaskHandler({}, { imageId, maskBase64: Buffer.from("edited-mask").toString("base64") });
    await inpaintHandler({}, { imageId });

    expect(client.inpaint).toHaveBeenCalledWith(
      Buffer.from("normalized-png-bytes"),
      Buffer.from("edited-mask"),
    );
  });


  it("image:caption calls client.caption with normalized image", async () => {
    const { handlers, client } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    const captionHandler = handlers.get("image:caption");
    if (importHandler === undefined || captionHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    const result = (await captionHandler({}, { imageId })) as { caption: string | null };

    expect(client.caption).toHaveBeenCalledWith(Buffer.from("normalized-png-bytes"));
    expect(result.caption).toBe("A detailed caption of the image.");

    await captionHandler({}, { imageId, systemPrompt: "Include trigger word 'ohwx man'." });
    expect(client.caption).toHaveBeenCalledWith(
      Buffer.from("normalized-png-bytes"),
      "Include trigger word 'ohwx man'.",
    );

    await captionHandler({}, { imageId, modelId: "Qwen/Qwen2-VL-7B-Instruct" });
    expect(client.caption).toHaveBeenCalledWith(
      Buffer.from("normalized-png-bytes"),
      undefined,
      "Qwen/Qwen2-VL-7B-Instruct",
    );
  });


  it("image:export writes sidecar .txt file when caption option is passed", async () => {
    const { handlers, writeFile } = setup("C:\\chosen\\output.jpg");
    const importHandler = handlers.get("image:import");
    const exportHandler = handlers.get("image:export");
    if (importHandler === undefined || exportHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("raw-bytes") })) as {
      imageId: string;
    };
    await exportHandler(
      {},
      { imageId, format: "jpeg", caption: "Photo of a scenic mountain sunset" },
    );

    expect(writeFile).toHaveBeenCalledWith("C:\\chosen\\output.jpg", Buffer.from("converted-bytes"));
    expect(writeFile).toHaveBeenCalledWith(
      "C:\\chosen\\output.txt",
      Buffer.from("Photo of a scenic mountain sunset", "utf-8"),
    );
  });


  it("image:import calls client.normalize and returns imageId and previewBase64", async () => {
    const { handlers, client } = setup("C:\\chosen\\output.png");
    const importHandler = handlers.get("image:import");
    if (importHandler === undefined) throw new Error("handler not registered");

    const result = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
      previewBase64?: string;
    };
    expect(typeof result.imageId).toBe("string");
    expect(client.normalize).toHaveBeenCalledWith(Buffer.from("png-bytes"));
    expect(result.previewBase64).toBe(Buffer.from("normalized-png-bytes").toString("base64"));
  });

  it("image:detect calls client.detect with the normalized image's bytes", async () => {
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

    expect(client.detect).toHaveBeenCalledWith(Buffer.from("normalized-png-bytes"));
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

  it("image:export calls client.convert with format options and writes converted bytes", async () => {
    const { handlers, client, showSaveDialog, writeFile } = setup("C:\\chosen\\output.webp");
    const importHandler = handlers.get("image:import");
    const exportHandler = handlers.get("image:export");
    if (importHandler === undefined || exportHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("raw-bytes") })) as {
      imageId: string;
    };
    const result = (await exportHandler(
      {},
      { imageId, format: "webp", quality: 85, metadataMode: "strip" },
    )) as { saved: boolean; filePath?: string };

    expect(showSaveDialog).toHaveBeenCalledWith("output.webp");
    expect(client.convert).toHaveBeenCalledWith(Buffer.from("normalized-raw-bytes"), {
      format: "webp",
      quality: 85,
      lossless: false,
      compressLevel: 6,
      metadataMode: "strip",
      originalBase64: Buffer.from("raw-bytes").toString("base64"),
      flattenColor: "#FFFFFF",
    });
    expect(writeFile).toHaveBeenCalledWith("C:\\chosen\\output.webp", Buffer.from("converted-bytes"));
    expect(result).toEqual({ saved: true, filePath: "C:\\chosen\\output.webp" });
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
    expect(writeFile).toHaveBeenCalledWith("C:\\chosen\\output.png", Buffer.from("normalized-png-bytes"));
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

