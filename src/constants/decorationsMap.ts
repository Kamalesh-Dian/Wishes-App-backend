export const decorationMap: Record<string, string> = {
  "Cake": "luxury celebration cake with candles and delicate toppings",

  "Balloons": "metallic party balloons floating gently",

  "Confetti": "golden confetti particles floating in the air",

  "Flowers": "fresh floral arrangements and festive blooms",

  "Diyas": "traditional clay diyas with warm glowing flames",
};

export function getDecorationDescription(decoration?: string): string {
  if (!decoration || !decoration.trim()) {
    return "";
  }
  const clean = decoration.trim();
  const lower = clean.toLowerCase();
  for (const [key, value] of Object.entries(decorationMap)) {
    if (key.trim().toLowerCase() === lower) {
      return value;
    }
  }
  return clean;
}
