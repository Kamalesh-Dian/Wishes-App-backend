import { getThemeDescription } from "../constants/themeMap";
import { getDecorationDescription } from "../constants/decorationsMap";
import { getOccasionDetail } from "../constants/occasionMap";

export const NEGATIVE_PROMPT =
  "extra fingers, distorted face, different person, older face, plastic skin, blurry, text, watermark";

export interface BuildPromptOptions {
  occasion: string;
  theme?: string;
  decorations?: string[] | string;
  people?: string[] | string;
  customMessage?: string;
  additionalInformation?: string;
}

export function buildFluxPrompt(data: BuildPromptOptions): string {
  const occasionClean = data.occasion?.trim() || "celebration";
  const occasionDetail = getOccasionDetail(data.occasion);
  const occasionOutfit = occasionDetail.outfit?.trim();

  let themeDescription = getThemeDescription(data.theme);
  if (!themeDescription && occasionDetail.scene) {
    themeDescription = occasionDetail.scene;
  }

  const rawDecorations = Array.isArray(data.decorations)
    ? data.decorations
    : data.decorations
      ? [data.decorations]
      : [];

  const decorations = rawDecorations
    .map((d) => (typeof d === "string" ? getDecorationDescription(d) : ""))
    .filter((d) => Boolean(d && d.trim().length > 0))
    .join(", ");

  const additionalInfo = data.additionalInformation?.trim();

  const lines: string[] = [
    `Edit the provided photo into a ${occasionClean} celebration image.`,
    "Keep the same person: identical face, facial structure, skin tone, hair, age and expression style. Do not alter or idealize the face.",
    "Change only the clothing, background and surroundings.",
  ];

  if (occasionOutfit) {
    lines.push(`Outfit: ${occasionOutfit}.`);
  }

  if (themeDescription) {
    lines.push(`Setting: ${themeDescription}.`);
  }

  if (decorations) {
    lines.push(`Include: ${decorations}.`);
  }

  lines.push(
    "Lighting and style: warm cinematic lighting, natural skin texture, realistic photography, shallow depth of field.",
    "Composition: subject centered in the lower two-thirds, with clear empty space at the top for a caption.",
    "Do not add any text, letters, logos or watermarks."
  );

  if (additionalInfo) {
    lines.push(additionalInfo);
  }

  return lines.join("\n");
}
