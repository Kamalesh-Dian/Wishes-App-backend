import { buildFluxPrompt } from "../promptBuilder";

export function buildAutomationPrompt(event: any) {
  return buildFluxPrompt({
    occasion: event.occasion,
    theme: "Corporate",
    decorations: ["confetti", "balloons"],
  });
}
