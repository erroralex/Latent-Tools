import { createHash } from "node:crypto";
import * as path from "node:path";

const HF_REPO = "erroralex/latent-tools-sidecar";

export type DownloadProgress = {
  phase: "downloading" | "extracting";
  bytesDownloaded: number;
  totalBytes: number;
};

export type FileWriter = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

export type DownloadSidecarRuntimeOptions = {
  version: string;
  destDir: string;
  onProgress: (progress: DownloadProgress) => void;
  fetchFn?: typeof fetch;
  openForWrite?: (path: string) => Promise<FileWriter>;
  mkdir?: (path: string) => Promise<void>;
  rm?: (path: string) => Promise<void>;
  extractFn?: (zipPath: string, options: { dir: string }) => Promise<void>;
};

function assetUrl(version: string, suffix: string): string {
  return `https://huggingface.co/datasets/${HF_REPO}/resolve/main/sidecar-cuda-win-x64-${version}.zip${suffix}`;
}

async function fetchExpectedChecksum(version: string, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(assetUrl(version, ".sha256"));
  if (!response.ok) {
    throw new Error(
      `Failed to fetch checksum for sidecar runtime v${version}: HTTP ${response.status} (not found - does a sidecar-cuda-win-x64-${version}.zip.sha256 exist on Hugging Face?)`,
    );
  }
  return (await response.text()).trim();
}

async function defaultOpenForWrite(filePath: string): Promise<FileWriter> {
  const fs = await import("node:fs/promises");
  const handle = await fs.open(filePath, "w");
  return {
    write: async (chunk: Uint8Array) => {
      await handle.write(chunk);
    },
    close: () => handle.close(),
  };
}

// Streams the response body straight to disk one chunk at a time. Buffering the
// whole file in memory (collecting chunks in an array, then concatenating into one
// Uint8Array) held two full copies of the ~2.8GB download simultaneously and threw
// "RangeError: Array buffer allocation failed" on ordinary consumer RAM.
async function downloadZip(
  version: string,
  fetchFn: typeof fetch,
  writer: FileWriter,
  onProgress: (progress: DownloadProgress) => void,
): Promise<{ sha256: string; totalBytes: number }> {
  const response = await fetchFn(assetUrl(version, ""));
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download sidecar runtime v${version}: HTTP ${response.status}`,
    );
  }

  const totalBytes = Number(response.headers?.get?.("content-length") ?? 0);
  const hash = createHash("sha256");
  let bytesDownloaded = 0;

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    await writer.write(value);
    bytesDownloaded += value.byteLength;
    onProgress({ phase: "downloading", bytesDownloaded, totalBytes });
  }

  return { sha256: hash.digest("hex"), totalBytes: bytesDownloaded };
}

export async function downloadSidecarRuntime(options: DownloadSidecarRuntimeOptions): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch;
  const openForWrite = options.openForWrite ?? defaultOpenForWrite;
  const mkdir =
    options.mkdir ??
    ((dir: string) =>
      import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true })).then(() => undefined));
  const rm = options.rm ?? ((p: string) => import("node:fs/promises").then((fs) => fs.rm(p, { force: true })));
  const extractFn = options.extractFn ?? ((await import("extract-zip")).default as (zipPath: string, options: { dir: string }) => Promise<void>);

  const expectedChecksum = await fetchExpectedChecksum(options.version, fetchFn);

  await mkdir(path.dirname(options.destDir));
  const tempZipPath = `${options.destDir}.download.zip`;
  const writer = await openForWrite(tempZipPath);
  let sha256: string;
  let totalBytes: number;
  try {
    ({ sha256, totalBytes } = await downloadZip(options.version, fetchFn, writer, options.onProgress));
  } finally {
    await writer.close();
  }

  if (sha256 !== expectedChecksum) {
    await rm(tempZipPath);
    throw new Error(
      `Sidecar runtime download checksum mismatch: expected ${expectedChecksum}, got ${sha256}. The download may be corrupted - try again.`,
    );
  }

  options.onProgress({ phase: "extracting", bytesDownloaded: totalBytes, totalBytes });
  try {
    await extractFn(tempZipPath, { dir: options.destDir });
  } finally {
    await rm(tempZipPath);
  }
}
