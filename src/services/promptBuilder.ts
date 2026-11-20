import { themeMap } from "../constants/themeMap";
import { decorationMap } from "../constants/decorationsMap";

export function buildFluxPrompt(data: {
  occasion: string;
  theme: string;
  decorations?: string[] | string;
  people?: string[] | string;
  customMessage?: string;
  additionalInformation?: string;
}) {
  const themeDescription = themeMap[data.theme] || data.theme;

  const rawDecorations = Array.isArray(data.decorations)
    ? data.decorations
    : data.decorations
      ? [data.decorations]
      : [];

  const decorationDescriptions = rawDecorations
    .map((d: string) => decorationMap[d] || d)
    .filter(Boolean)
    .join(", ");

  const peopleList = Array.isArray(data.people)
    ? data.people.filter(Boolean).join(", ")
    : (data.people || "").trim();

  const customMessage = data.customMessage?.trim();
  const additionalInfo = data.additionalInformation?.trim();

  const lines = [
    "same person from reference image",
    "preserve identity",
    "preserve face and don't make them old aged face",
    "but you can change the dress that suit the occasion that provided",
    data.occasion,
    themeDescription,
    decorationDescriptions,
    peopleList,
    customMessage ? `add this text: ${customMessage}` : "",
    additionalInfo || "",
    "greeting card",
    "photorealistic",
    "professional",
    "high detail",
    "cinematic lighting",
  ].filter((line) => Boolean(line && line.trim().length > 0));

  return lines.join(",\n");
}
