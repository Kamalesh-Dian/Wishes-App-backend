import Event from "../../models/Event";
import Wish from "../../models/Wish";

import { getCompressedEmployeeImage } from "./employeeImage.service";
import { buildAutomationPrompt } from "./automationPrompt.service";
import { generateImage } from "../image.service";
import { uploadToCloudinary } from "../cloudinary.service";
import { generateVideoWithModel } from "../video.service";
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

  let videoUrl = "";
  const shouldGenerateVideo = event.mediaType === "video" || event.mediaType === "both";

  if (shouldGenerateVideo) {
    try {
      logger.info({ eventId, mediaType: event.mediaType, videoModel: event.videoModel }, "Generating automated celebration video");
      const videoResult = await generateVideoWithModel({
        imageUrl,
        occasion: event.occasion,
        theme: "Corporate Celebration",
        customMessage: event.customMessage,
        aiEngine: event.videoModel || "gemini-omni",
        duration: 4,
      });
      videoUrl = videoResult.videoUrl;
      logger.info({ eventId, videoUrl }, "Automated celebration video generated successfully");
    } catch (videoErr) {
      logger.warn({ eventId, err: videoErr }, "Video generation encountered issue; proceeding with generated image");
    }
  }

  const wish = await Wish.create({
    user: event.userId,
    occasion: event.occasion,
    theme: "Corporate",
    generatedImage: imageUrl,
    people: ["Employee"],
    decorations: ["Confetti"],
    customMessage: event.customMessage,
    animationEnabled: shouldGenerateVideo && Boolean(videoUrl),
    aiProvider: "flux",
    prompt,
  });

  event.generatedWishImage = imageUrl;
  if (videoUrl) {
    event.generatedWishVideo = videoUrl;
  }
  event.generatedWishText = event.customMessage || "";
  event.generatedAt = new Date();
  event.status = "generated";

  await event.save();

  logger.info({ eventId, wishId: wish._id, hasVideo: Boolean(videoUrl) }, "Automated wish generated successfully");

  return {
    success: true,
    wish,
    event,
  };
}
