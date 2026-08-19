import { createHash } from "node:crypto";
import * as path from "node:path";

const HF_REPO = "erroralex/latent-tools-sidecar";

export type DownloadProgress = {
  phase: "downloading" | "extracting";
  bytesDownloaded: number;
  totalBytes: number;
};

export type DownloadSidecarRuntimeOptions = {
  version: string;
  destDir: string;
  onProgress: (progress: DownloadProgress) => void;
  fetchFn?: typeof fetch;
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
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

async function downloadZip(
  version: string,
  fetchFn: typeof fetch,
  onProgress: (progress: DownloadProgress) => void,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const response = await fetchFn(assetUrl(version, ""));
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download sidecar runtime v${version}: HTTP ${response.status}`,
    );
  }

  const totalBytes = Number(response.headers?.get?.("content-length") ?? 0);
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let bytesDownloaded = 0;

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    hash.update(value);
    bytesDownloaded += value.byteLength;
    onProgress({ phase: "downloading", bytesDownloaded, totalBytes });
  }

  const bytes = new Uint8Array(bytesDownloaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes, sha256: hash.digest("hex") };
}

export async function downloadSidecarRuntime(options: DownloadSidecarRuntimeOptions): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch;
  const writeFile = options.writeFile ?? (await import("node:fs/promises")).writeFile;
  const mkdir =
    options.mkdir ??
    ((dir: string) =>
      import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true })).then(() => undefined));
  const rm = options.rm ?? ((p: string) => import("node:fs/promises").then((fs) => fs.rm(p, { force: true })));
  const extractFn = options.extractFn ?? ((await import("extract-zip")).default as (zipPath: string, options: { dir: string }) => Promise<void>);

  const expectedChecksum = await fetchExpectedChecksum(options.version, fetchFn);
  const { bytes, sha256 } = await downloadZip(options.version, fetchFn, options.onProgress);

  if (sha256 !== expectedChecksum) {
    throw new Error(
      `Sidecar runtime download checksum mismatch: expected ${expectedChecksum}, got ${sha256}. The download may be corrupted - try again.`,
    );
  }

  await mkdir(path.dirname(options.destDir));
  const tempZipPath = `${options.destDir}.download.zip`;
  await writeFile(tempZipPath, bytes);

  options.onProgress({ phase: "extracting", bytesDownloaded: bytes.byteLength, totalBytes: bytes.byteLength });
  try {
    await extractFn(tempZipPath, { dir: options.destDir });
  } finally {
    await rm(tempZipPath);
  }
}
