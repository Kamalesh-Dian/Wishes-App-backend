import { describe, it, expect } from "vitest";
import { buildFluxPrompt, NEGATIVE_PROMPT } from "../services/promptBuilder";

describe("Task 1: Prompt Builder", () => {
  it("generates instruction-style prompt containing the identity preservation sentence", () => {
    const prompt = buildFluxPrompt({
      occasion: "Birthday",
      theme: "Luxury Hotel",
      decorations: ["Balloons", "Cake"],
    });

    expect(prompt).toContain(
      "Keep the same person: identical face, facial structure, skin tone, hair, age and expression style. Do not alter or idealize the face."
    );
    expect(prompt).toContain("Edit the provided photo into a Birthday celebration image.");
    expect(prompt).toContain("Outfit: stylish celebration party attire.");
    expect(prompt).toContain("Setting: Five-star luxury hotel lobby");
    expect(prompt).toContain("Include: metallic party balloons floating gently, luxury celebration cake with candles");
  });

  it("never contains 'add this text' even if customMessage is provided", () => {
    const prompt = buildFluxPrompt({
      occasion: "Anniversary",
      theme: "Home",
      customMessage: "Happy 10th Anniversary John & Jane!",
    });

    expect(prompt).not.toContain("add this text");
    expect(prompt).not.toContain("Happy 10th Anniversary");
    expect(prompt).toContain("Do not add any text, letters, logos or watermarks.");
  });

  it("handles an unknown occasion and unknown theme gracefully", () => {
    const prompt = buildFluxPrompt({
      occasion: "Mars Landing",
      theme: "Cyberpunk Moonbase",
    });

    expect(prompt).toContain("Edit the provided photo into a Mars Landing celebration image.");
    expect(prompt).toContain("Outfit: festive celebratory attire suited for the occasion.");
    expect(prompt).toContain("Setting: Cyberpunk Moonbase.");
  });

  it("handles lowercase and unmapped decorations correctly", () => {
    const prompt = buildFluxPrompt({
      occasion: "Diwali",
      theme: "Diwali",
      decorations: ["diyas", "confetti", "golden fairy lights"],
    });

    expect(prompt).toContain("traditional clay diyas with warm glowing flames");
    expect(prompt).toContain("golden confetti particles floating in the air");
    expect(prompt).toContain("golden fairy lights");
  });

  it("exports NEGATIVE_PROMPT constant with required negative tokens", () => {
    expect(NEGATIVE_PROMPT).toBe(
      "extra fingers, distorted face, different person, older face, plastic skin, blurry, text, watermark"
    );
  });
});
