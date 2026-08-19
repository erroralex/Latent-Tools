import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { downloadSidecarRuntime } from "../src/main/sidecar-downloader";

function fakeZipBytes(): Uint8Array {
  return new TextEncoder().encode("pretend this is zip file contents");
}

function fakeResponse(body: Uint8Array | string, ok = true, status = 200): Response {
  const bodyBytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        controller.enqueue(bodyBytes);
        sent = true;
      } else {
        controller.close();
      }
    },
  });
  return {
    ok,
    status,
    body: stream,
    text: async () => new TextDecoder().decode(bodyBytes),
  } as unknown as Response;
}

describe("downloadSidecarRuntime", () => {
  it("downloads the version-matched zip and checksum from Hugging Face, verifies, and extracts", async () => {
    const zipBytes = fakeZipBytes();
    const expectedHash = createHash("sha256").update(zipBytes).digest("hex");

    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) {
        return fakeResponse(expectedHash);
      }
      if (urlStr.endsWith(".zip")) {
        return fakeResponse(zipBytes);
      }
      throw new Error(`unexpected URL in test: ${urlStr}`);
    });

    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const rm = vi.fn().mockResolvedValue(undefined);
    const extractFn = vi.fn().mockResolvedValue(undefined);
    const progressEvents: Array<{ phase: string; bytesDownloaded: number; totalBytes: number }> =
      [];

    await downloadSidecarRuntime({
      version: "1.0.0",
      destDir: "C:\\fake\\sidecar-runtime",
      fetchFn: fetchFn as unknown as typeof fetch,
      writeFile,
      mkdir,
      rm,
      extractFn,
      onProgress: (p) => progressEvents.push(p),
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://huggingface.co/datasets/erroralex/latent-tools-sidecar/resolve/main/sidecar-cuda-win-x64-1.0.0.zip.sha256",
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "https://huggingface.co/datasets/erroralex/latent-tools-sidecar/resolve/main/sidecar-cuda-win-x64-1.0.0.zip",
    );
    expect(extractFn).toHaveBeenCalledWith(expect.stringContaining("sidecar-runtime"), {
      dir: "C:\\fake\\sidecar-runtime",
    });
    expect(progressEvents.some((p) => p.phase === "downloading")).toBe(true);
    expect(progressEvents.some((p) => p.phase === "extracting")).toBe(true);
    expect(rm).toHaveBeenCalled(); // temp zip cleaned up
  });

  it("throws a specific error and does not extract when the checksum doesn't match", async () => {
    const zipBytes = fakeZipBytes();
    const wrongHash = "0".repeat(64);

    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) return fakeResponse(wrongHash);
      if (urlStr.endsWith(".zip")) return fakeResponse(zipBytes);
      throw new Error(`unexpected URL: ${urlStr}`);
    });

    const extractFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      downloadSidecarRuntime({
        version: "1.0.0",
        destDir: "C:\\fake\\sidecar-runtime",
        fetchFn: fetchFn as unknown as typeof fetch,
        writeFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockResolvedValue(undefined),
        extractFn,
        onProgress: () => {},
      }),
    ).rejects.toThrow(/checksum/i);

    expect(extractFn).not.toHaveBeenCalled();
  });

  it("throws a specific error when the download itself fails (404)", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) return fakeResponse("irrelevant", false, 404);
      throw new Error(`unexpected URL: ${urlStr}`);
    });

    await expect(
      downloadSidecarRuntime({
        version: "9.9.9",
        destDir: "C:\\fake\\sidecar-runtime",
        fetchFn: fetchFn as unknown as typeof fetch,
        writeFile: vi.fn(),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn(),
        extractFn: vi.fn(),
        onProgress: () => {},
      }),
    ).rejects.toThrow(/404|not found/i);
  });
});
