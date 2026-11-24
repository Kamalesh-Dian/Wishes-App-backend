import { describe, it, expect } from "vitest";
import { buildVideoPrompt, motionPresets } from "../services/videoPromptBuilder";

describe("Task 2: Video Prompt Builder", () => {
  it("generates motion-only video prompt with cinematic-bokeh preset", () => {
    const prompt = buildVideoPrompt({
      duration: 8,
      motionStyle: "cinematic-bokeh",
      occasion: "Birthday",
    });

    expect(prompt).toContain("Animate this image into a 8-second video.");
    expect(prompt).toContain("Occasion: Birthday celebration.");
    expect(prompt).toContain("Camera: slow push-in with slight parallax.");
    expect(prompt).toContain("Background motion: soft bokeh lights drifting and twinkling.");
    expect(prompt).toContain("Keep lighting consistent. Smooth, realistic movement. No text, no captions, no cuts.");
    expect(prompt).not.toContain("photorealistic");
    expect(prompt).not.toContain("greeting card");
  });

  it("generates prompt with confetti-party preset", () => {
    const prompt = buildVideoPrompt({
      duration: 6,
      motionStyle: "confetti-party",
      occasion: "Work Anniversary",
    });

    expect(prompt).toContain("Animate this image into a 6-second video.");
    expect(prompt).toContain("Camera: steady with a slight handheld sway.");
    expect(prompt).toContain("Background motion: golden confetti falling past the subject, balloons swaying.");
  });

  it("generates prompt with diya-lanterns preset", () => {
    const prompt = buildVideoPrompt({
      duration: 4,
      motionStyle: "diya-lanterns",
      occasion: "Diwali",
    });

    expect(prompt).toContain("Animate this image into a 4-second video.");
    expect(prompt).toContain("Camera: slow upward tilt.");
    expect(prompt).toContain("Background motion: diya flames flickering, floating lanterns rising, warm glow pulsing.");
  });

  it("falls back to cinematic-bokeh for unknown styles", () => {
    const prompt = buildVideoPrompt({
      duration: 5,
      motionStyle: "space-hyperspace-warp",
    });

    expect(prompt).toContain("Camera: slow push-in with slight parallax.");
    expect(prompt).toContain("Background motion: soft bokeh lights drifting and twinkling.");
  });

  it("clamps duration between 4 and 8 seconds", () => {
    const shortPrompt = buildVideoPrompt({ duration: 1 });
    expect(shortPrompt).toContain("Animate this image into a 4-second video.");

    const longPrompt = buildVideoPrompt({ duration: 30 });
    expect(longPrompt).toContain("Animate this image into a 8-second video.");
  });
});
