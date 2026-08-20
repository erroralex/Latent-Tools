import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { downloadSidecarRuntime, type FileWriter } from "../src/main/sidecar-downloader";

function fakeZipBytes(): Uint8Array {
  return new TextEncoder().encode("pretend this is zip file contents");
}

function fakeResponse(chunks: Uint8Array[], ok = true, status = 200): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
  const text = new TextDecoder().decode(concat(chunks));
  return {
    ok,
    status,
    body: stream,
    text: async () => text,
  } as unknown as Response;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function fakeWriter(): FileWriter & { chunks: Uint8Array[]; closed: boolean } {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    closed: false,
    write: vi.fn(async (chunk: Uint8Array) => {
      chunks.push(chunk);
    }),
    close: vi.fn(async function (this: { closed: boolean }) {
      this.closed = true;
    }),
  } as unknown as FileWriter & { chunks: Uint8Array[]; closed: boolean };
}

describe("downloadSidecarRuntime", () => {
  it("downloads the version-matched zip and checksum from Hugging Face, verifies, and extracts", async () => {
    const zipBytes = fakeZipBytes();
    const expectedHash = createHash("sha256").update(zipBytes).digest("hex");

    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) {
        return fakeResponse([new TextEncoder().encode(expectedHash)]);
      }
      if (urlStr.endsWith(".zip")) {
        return fakeResponse([zipBytes]);
      }
      throw new Error(`unexpected URL in test: ${urlStr}`);
    });

    const writer = fakeWriter();
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const rm = vi.fn().mockResolvedValue(undefined);
    const extractFn = vi.fn().mockResolvedValue(undefined);
    const progressEvents: Array<{ phase: string; bytesDownloaded: number; totalBytes: number }> =
      [];

    await downloadSidecarRuntime({
      version: "1.0.0",
      destDir: "C:\\fake\\sidecar-runtime",
      fetchFn: fetchFn as unknown as typeof fetch,
      openForWrite: vi.fn().mockResolvedValue(writer),
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
    expect(concat(writer.chunks)).toEqual(zipBytes);
    expect(writer.close).toHaveBeenCalled();
    expect(progressEvents.some((p) => p.phase === "downloading")).toBe(true);
    expect(progressEvents.some((p) => p.phase === "extracting")).toBe(true);
    expect(rm).toHaveBeenCalled(); // temp zip cleaned up
  });

  it("writes each chunk to disk as it arrives instead of buffering the whole download in memory", async () => {
    // Regression test: downloadZip used to collect every chunk into an array and
    // then concatenate them into one Uint8Array, holding two full copies of the
    // download in memory at once. That threw "RangeError: Array buffer allocation
    // failed" on a real multi-gigabyte sidecar runtime download. Streaming each
    // chunk straight to the FileWriter as it arrives means no accumulation.
    const chunkA = new TextEncoder().encode("chunk-a-");
    const chunkB = new TextEncoder().encode("chunk-b-");
    const chunkC = new TextEncoder().encode("chunk-c");
    const fullZip = concat([chunkA, chunkB, chunkC]);
    const expectedHash = createHash("sha256").update(fullZip).digest("hex");

    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) {
        return fakeResponse([new TextEncoder().encode(expectedHash)]);
      }
      if (urlStr.endsWith(".zip")) {
        return fakeResponse([chunkA, chunkB, chunkC]);
      }
      throw new Error(`unexpected URL in test: ${urlStr}`);
    });

    const writer = fakeWriter();

    await downloadSidecarRuntime({
      version: "1.0.0",
      destDir: "C:\\fake\\sidecar-runtime",
      fetchFn: fetchFn as unknown as typeof fetch,
      openForWrite: vi.fn().mockResolvedValue(writer),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      extractFn: vi.fn().mockResolvedValue(undefined),
      onProgress: () => {},
    });

    // Each chunk arrives as its own write() call, in order, never combined.
    expect(writer.write).toHaveBeenCalledTimes(3);
    expect(writer.chunks).toEqual([chunkA, chunkB, chunkC]);
  });

  it("throws a specific error and does not extract when the checksum doesn't match", async () => {
    const zipBytes = fakeZipBytes();
    const wrongHash = "0".repeat(64);

    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) return fakeResponse([new TextEncoder().encode(wrongHash)]);
      if (urlStr.endsWith(".zip")) return fakeResponse([zipBytes]);
      throw new Error(`unexpected URL: ${urlStr}`);
    });

    const extractFn = vi.fn().mockResolvedValue(undefined);
    const rm = vi.fn().mockResolvedValue(undefined);

    await expect(
      downloadSidecarRuntime({
        version: "1.0.0",
        destDir: "C:\\fake\\sidecar-runtime",
        fetchFn: fetchFn as unknown as typeof fetch,
        openForWrite: vi.fn().mockResolvedValue(fakeWriter()),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rm,
        extractFn,
        onProgress: () => {},
      }),
    ).rejects.toThrow(/checksum/i);

    expect(extractFn).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalled(); // corrupt temp zip cleaned up
  });

  it("throws a specific error when the download itself fails (404)", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.endsWith(".sha256")) return fakeResponse([new TextEncoder().encode("irrelevant")], false, 404);
      throw new Error(`unexpected URL: ${urlStr}`);
    });

    await expect(
      downloadSidecarRuntime({
        version: "9.9.9",
        destDir: "C:\\fake\\sidecar-runtime",
        fetchFn: fetchFn as unknown as typeof fetch,
        openForWrite: vi.fn().mockResolvedValue(fakeWriter()),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn(),
        extractFn: vi.fn(),
        onProgress: () => {},
      }),
    ).rejects.toThrow(/404|not found/i);
  });
});
