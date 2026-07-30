type HealthResponse = { status: string };
type DetectResponse = { mask_base64: string };
type InpaintResponse = { result_base64: string };

export class SidecarClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Sidecar health check failed: ${response.status}`);
    }
    return (await response.json()) as HealthResponse;
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
}
