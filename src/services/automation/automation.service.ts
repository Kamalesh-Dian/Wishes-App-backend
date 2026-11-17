import Event from "../../models/Event";
import Wish from "../../models/Wish";

import { getCompressedEmployeeImage } from "./employeeImage.service";
import { buildAutomationPrompt } from "./automationPrompt.service";
import { generateImage } from "../image.service";
import { uploadToCloudinary } from "../cloudinary.service";
import { logger } from "../../utils/logger";

export async function generateEventWish(eventId: string) {
  const event = await Event.findById(eventId);

  if (!event) {
    throw new Error("Event not found");
  }

  if (!event.photoUrl) {
    throw new Error(`Photo URL missing for ${event.name}`);
  }

  logger.debug({ eventId }, "Downloading employee image for automated wish");

  const uploadedImage = await getCompressedEmployeeImage(event.photoUrl);

  const prompt = buildAutomationPrompt(event);

  logger.debug({ eventId }, "Generating automated AI image");

  const image = await generateImage(prompt, uploadedImage, "flux");

  logger.debug({ eventId }, "Uploading generated image to Cloudinary");

  const imageUrl = await uploadToCloudinary(
    `data:${image.mimeType};base64,${image.base64}`,
  );

  const wish = await Wish.create({
    user: event.userId,
    occasion: event.occasion,
    theme: "Corporate",
    generatedImage: imageUrl,
    people: ["Employee"],
    decorations: ["Confetti"],
    customMessage: event.customMessage,
    animationEnabled: false,
    aiProvider: "flux",
    prompt,
  });

  event.generatedWishImage = imageUrl;
  event.generatedWishText = event.customMessage || "";
  event.generatedAt = new Date();
  event.status = "generated";

  await event.save();

  logger.info({ eventId, wishId: wish._id }, "Automated wish generated successfully");

  return {
    success: true,
    wish,
    event,
  };
}
