export interface VideoPromptOptions {
  duration?: number;
  motionStyle?: string;
  occasion?: string;
}

export interface MotionPreset {
  camera: string;
  background: string;
}

export const motionPresets: Record<string, MotionPreset> = {
  "cinematic-bokeh": {
    camera: "slow push-in with slight parallax",
    background: "soft bokeh lights drifting and twinkling",
  },
  "confetti-party": {
    camera: "steady with a slight handheld sway",
    background: "golden confetti falling past the subject, balloons swaying",
  },
  "diya-lanterns": {
    camera: "slow upward tilt",
    background: "diya flames flickering, floating lanterns rising, warm glow pulsing",
  },
};

export function buildVideoPrompt(options: VideoPromptOptions): string {
  const duration = Math.min(8, Math.max(4, Math.round(options.duration || 8)));
  const rawStyle = (options.motionStyle || "").trim().toLowerCase();
  const preset = motionPresets[rawStyle] || motionPresets["cinematic-bokeh"];

  const occasionClean = options.occasion?.trim();
  const occasionLine = occasionClean ? `Occasion: ${occasionClean} celebration.\n` : "";

  return `Animate this image into a ${duration}-second video.
${occasionLine}The person stays the same: same face, identity and clothing throughout. No face morphing, no extra people, no new objects.
Subject motion: a gentle natural smile, soft blinks, a slight head turn, subtle breathing.
Camera: ${preset.camera}.
Background motion: ${preset.background}.
Keep lighting consistent. Smooth, realistic movement. No text, no captions, no cuts.`.trim();
}
