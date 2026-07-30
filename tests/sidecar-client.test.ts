import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SidecarClient } from "../src/main/sidecar-client";

describe("SidecarClient", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.url === "/health" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (req.url === "/normalize" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              normalized_base64: Buffer.from("normalized-image").toString("base64"),
            }),
          );
          return;
        }
        if (req.url === "/convert" && req.method === "POST") {
          const parsed = JSON.parse(body) as { format: string };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              result_base64: Buffer.from("converted-image").toString("base64"),
              content_type: `image/${parsed.format}`,
            }),
          );
          return;
        }
        if (req.url === "/detect" && req.method === "POST") {
          const parsed = JSON.parse(body) as { image_base64: string };
          expect(parsed.image_base64).toBe(Buffer.from("fake-image").toString("base64"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ mask_base64: Buffer.from("fake-mask").toString("base64") }));
          return;
        }
        if (req.url === "/inpaint" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result_base64: Buffer.from("fake-result").toString("base64") }));
          return;
        }
        if (req.url === "/caption" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ caption: "A cat on a sofa" }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to bind a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("health() calls GET /health", async () => {
    const client = new SidecarClient(baseUrl);
    const result = await client.health();
    expect(result).toEqual({ status: "ok" });
  });

  it("normalize() posts raw bytes and returns normalized buffer", async () => {
    const client = new SidecarClient(baseUrl);
    const normalized = await client.normalize(Buffer.from("raw-image"));
    expect(normalized.toString()).toBe("normalized-image");
  });

  it("detect() posts the image and returns the decoded mask", async () => {
    const client = new SidecarClient(baseUrl);
    const mask = await client.detect(Buffer.from("fake-image"));
    expect(mask.toString()).toBe("fake-mask");
  });

  it("inpaint() posts image+mask and returns the decoded result", async () => {
    const client = new SidecarClient(baseUrl);
    const result = await client.inpaint(Buffer.from("fake-image"), Buffer.from("fake-mask"));
    expect(result.toString()).toBe("fake-result");
  });

  it("caption() posts image and returns caption text", async () => {
    const client = new SidecarClient(baseUrl);
    const caption = await client.caption(Buffer.from("fake-image"));
    expect(caption).toBe("A cat on a sofa");
  });

  it("convert() posts working image with options and returns result and content type", async () => {
    const client = new SidecarClient(baseUrl);
    const { result, contentType } = await client.convert(Buffer.from("working-image"), {
      format: "webp",
      quality: 80,
      metadataMode: "strip",
    });
    expect(result.toString()).toBe("converted-image");
    expect(contentType).toBe("image/webp");
  });
});


