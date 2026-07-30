type HealthResponse = { status: string };
type DetectResponse = { mask_base64: string };
type InpaintResponse = { result_base64: string };
type NormalizeResponse = { normalized_base64: string };
type ConvertResponse = { result_base64: string; content_type: string };

export type ConvertOptions = {
  format: string;
  quality?: number;
  lossless?: boolean;
  compressLevel?: number;
  metadataMode?: string;
  originalBase64?: string;
  flattenColor?: string;
};

export class SidecarClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Sidecar health check failed: ${response.status}`);
    }
    return (await response.json()) as HealthResponse;
  }

  async normalize(imageRaw: Buffer): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/normalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageRaw.toString("base64") }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /normalize failed: ${response.status}`);
    }
    const body = (await response.json()) as NormalizeResponse;
    return Buffer.from(body.normalized_base64, "base64");
  }

  async detect(imagePng: Buffer): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imagePng.toString("base64") }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /detect failed: ${response.status}`);
    }
    const body = (await response.json()) as DetectResponse;
    return Buffer.from(body.mask_base64, "base64");
  }

  async inpaint(imagePng: Buffer, maskPng: Buffer): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/inpaint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imagePng.toString("base64"),
        mask_base64: maskPng.toString("base64"),
      }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /inpaint failed: ${response.status}`);
    }
    const body = (await response.json()) as InpaintResponse;
    return Buffer.from(body.result_base64, "base64");
  }

  async convert(
    workingImage: Buffer,
    options: ConvertOptions,
  ): Promise<{ result: Buffer; contentType: string }> {
    const response = await fetch(`${this.baseUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: workingImage.toString("base64"),
        format: options.format,
        quality: options.quality ?? 90,
        lossless: options.lossless ?? false,
        compress_level: options.compressLevel ?? 6,
        metadata_mode: options.metadataMode ?? "strip",
        original_base64: options.originalBase64,
        flatten_color: options.flattenColor,
      }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /convert failed: ${response.status}`);
    }
    const body = (await response.json()) as ConvertResponse;
    return {
      result: Buffer.from(body.result_base64, "base64"),
      contentType: body.content_type,
    };
  }
}

