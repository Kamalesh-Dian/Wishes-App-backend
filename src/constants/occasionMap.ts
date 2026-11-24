export interface OccasionDetail {
  outfit: string;
  scene: string;
}

export const occasionMap: Record<string, OccasionDetail> = {
  Birthday: {
    outfit: "stylish celebration party attire",
    scene: "festive birthday celebration environment",
  },
  Diwali: {
    outfit: "traditional festive Indian ethnic attire",
    scene: "brightly illuminated Diwali celebration with glowing lamps",
  },
  Wedding: {
    outfit: "luxurious celebratory wedding formal attire",
    scene: "grand wedding venue with elegant ceremonial decorations",
  },
  Anniversary: {
    outfit: "sophisticated evening dinner wear",
    scene: "romantic celebratory setting with ambient candlelight",
  },
  "Work Anniversary": {
    outfit: "sharp executive business formal attire",
    scene: "modern professional celebration setting",
  },
  "New Year": {
    outfit: "glamorous festive party outfit",
    scene: "joyous New Year countdown celebration setting",
  },
  Christmas: {
    outfit: "warm cozy festive sweater or elegant winter party wear",
    scene: "warm holiday Christmas celebration interior",
  },
  Eid: {
    outfit: "elegant traditional festive attire",
    scene: "warm festive gathering celebration setting",
  },
  Holi: {
    outfit: "traditional festive white ethnic wear with tasteful celebratory color splashes",
    scene: "vibrant joyful Holi celebration setting",
  },
  Pongal: {
    outfit: "traditional South Indian festive attire",
    scene: "traditional harvest festival celebration setting",
  },
  Graduation: {
    outfit: "formal academic cap and graduation gown over smart dress",
    scene: "proud graduation milestone celebration setting",
  },
};

export const DEFAULT_OCCASION_DETAIL: OccasionDetail = {
  outfit: "festive celebratory attire suited for the occasion",
  scene: "joyful festive celebration setting",
};

export function getOccasionDetail(occasion?: string): OccasionDetail {
  if (!occasion || !occasion.trim()) {
    return DEFAULT_OCCASION_DETAIL;
  }
  const clean = occasion.trim().toLowerCase();
  for (const [key, value] of Object.entries(occasionMap)) {
    if (key.trim().toLowerCase() === clean) {
      return value;
    }
  }
  return DEFAULT_OCCASION_DETAIL;
}
