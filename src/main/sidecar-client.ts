type HealthResponse = { status: string };
type DetectResponse = { mask_base64: string };
type InpaintResponse = { result_base64: string };
type NormalizeResponse = { normalized_base64: string };
type ConvertResponse = { result_base64: string; content_type: string };
type ProcessResponse = { result_base64: string; content_type: string; caption: string | null };

export type ConvertOptions = {
  format: string;
  quality?: number;
  lossless?: boolean;
  compressLevel?: number;
  metadataMode?: string;
  originalBase64?: string;
  flattenColor?: string;
};

export type ProcessOptions = {
  autoRemoveWatermark?: boolean;
  generateCaption?: boolean;
  systemPrompt?: string;
  modelId?: string;
  format: string;
  quality?: number;
  lossless?: boolean;
  compressLevel?: number;
  metadataMode?: string;
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

  async process(
    imageRaw: Buffer,
    options: ProcessOptions,
  ): Promise<{ result: Buffer; contentType: string; caption: string | null }> {
    const response = await fetch(`${this.baseUrl}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageRaw.toString("base64"),
        auto_remove_watermark: options.autoRemoveWatermark ?? false,
        generate_caption: options.generateCaption ?? false,
        system_prompt: options.systemPrompt,
        model_id: options.modelId,
        format: options.format,
        quality: options.quality ?? 90,
        lossless: options.lossless ?? false,
        compress_level: options.compressLevel ?? 6,
        metadata_mode: options.metadataMode ?? "strip",
        flatten_color: options.flattenColor,
      }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /process failed: ${response.status}`);
    }
    const body = (await response.json()) as ProcessResponse;
    return {
      result: Buffer.from(body.result_base64, "base64"),
      contentType: body.content_type,
      caption: body.caption,
    };
  }

  async caption(imagePng: Buffer, systemPrompt?: string, modelId?: string): Promise<string | null> {
    const payload: { image_base64: string; system_prompt?: string; model_id?: string } = {
      image_base64: imagePng.toString("base64"),
    };
    if (systemPrompt && systemPrompt.trim()) {
      payload.system_prompt = systemPrompt.trim();
    }
    if (modelId && modelId.trim()) {
      payload.model_id = modelId.trim();
    }
    const response = await fetch(`${this.baseUrl}/caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /caption failed: ${response.status}`);
    }
    const body = (await response.json()) as { caption: string | null };
    return body.caption;
  }

  async shutdown(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/shutdown`, { method: "POST" });
    } catch {
      // Sidecar may already be unreachable (e.g. already stopped) — nothing more to do.
    }
  }

  async gpuStatus(): Promise<GpuStatusResponse> {
    const response = await fetch(`${this.baseUrl}/gpu`);
    if (!response.ok) {
      throw new Error(`Sidecar /gpu failed: ${response.status}`);
    }
    return (await response.json()) as GpuStatusResponse;
  }
}

export type GpuStatusResponse = {
  name: string;
  vram_used_mb: number;
  vram_total_mb: number;
  vram_used_gb: number;
  vram_total_gb: number;
  vram_pct: number;
  temperature_c: number | null;
  status: string;
};





