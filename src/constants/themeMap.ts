export const themeMap: Record<string, string> = {
  Beach:
    "Luxury tropical beach resort during golden sunset, ocean waves, premium vacation atmosphere, cinematic sky, luxury travel photography",

  "Luxury Hotel":
    "Five-star luxury hotel lobby, crystal chandeliers, marble interiors, premium hospitality environment, luxury lifestyle photography",

  Office:
    "Modern corporate headquarters, glass architecture, executive workspace, premium business atmosphere, professional achievement setting",

  Mountain:
    "Luxury mountain resort, scenic alpine landscape, breathtaking peaks, premium travel destination, cinematic nature photography",

  Home: "Elegant modern family home, warm luxury interior, cozy celebration atmosphere, premium lifestyle setting",

  Travel:
    "World-class international destination, luxury tourism environment, iconic landmarks, premium travel magazine style photography",

  Diwali:
    "warm festival atmosphere, glowing traditional diyas, decorative floor rangoli, marigold garlands, warm golden string lights",

  Wedding:
    "grand wedding celebration setting, floral arches, warm ambient chandeliers, luxurious festive decor",

  Anniversary:
    "romantic celebration setting, soft candlelight, elegant table arrangement, warm intimate atmosphere",

  Birthday:
    "vibrant party celebration setting, festive background balloons, celebration ribbons, warm golden lighting",

  Corporate:
    "modern office environment, executive glass architecture, professional celebration setting with subtle floating confetti",

  "Festive Home":
    "cozy festive home interior, warm ambient fairy lights, festive holiday decorations, welcoming celebration atmosphere",
};

export function getThemeDescription(theme?: string): string {
  if (!theme || !theme.trim()) {
    return "";
  }
  const clean = theme.trim();
  const lower = clean.toLowerCase();
  for (const [key, value] of Object.entries(themeMap)) {
    if (key.trim().toLowerCase() === lower) {
      return value;
    }
  }
  return clean;
}
