import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { xmlEscape, overlayTextOnImage, isFfmpegAvailable } from "../services/overlay.service";

describe("Task 3: Overlay Service", () => {
  it("properly escapes XML special characters", () => {
    const raw = `Tom & Jerry <friends> said "Cheers" and 'Hello'`;
    const escaped = xmlEscape(raw);
    expect(escaped).toBe(
      "Tom &amp; Jerry &lt;friends&gt; said &quot;Cheers&quot; and &apos;Hello&apos;"
    );
  });

  it("applies celebratory headline and message overlay to an image", async () => {
    // Create a 400x400 blank test image with sharp
    const testImage = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 50, g: 50, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await overlayTextOnImage(testImage, {
      occasion: "Birthday",
      name: "Alice",
      customMessage: "Wishing you a wonderful year ahead!",
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.mimeType).toBe("image/png");
    expect(result.base64).toBeDefined();

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(400);
  }, 15000);

  it("formats headline without name when name is omitted", async () => {
    const testImage = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 20, g: 20, b: 20, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await overlayTextOnImage(testImage, {
      occasion: "Diwali",
    });

    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("checks ffmpeg availability safely without throwing", () => {
    const available = isFfmpegAvailable();
    expect(typeof available).toBe("boolean");
  });
});
