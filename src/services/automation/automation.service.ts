import Event from "../../models/Event";
import Wish from "../../models/Wish";

import { getCompressedEmployeeImage } from "./employeeImage.service";
import { buildAutomationPrompt } from "./automationPrompt.service";
import { generateImage } from "../image.service";
import { uploadToCloudinary } from "../cloudinary.service";
import { generateVideoWithModel } from "../video.service";
import { overlayTextOnImage } from "../overlay.service";
import { compareFaces, getMinSimilarityThreshold } from "../identityCheck.service";
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

  // 1. Generate clean AI image (no text baked into diffusion)
  let image = await generateImage(prompt, uploadedImage, "flux");
  let rawDataUri = `data:${image.mimeType};base64,${image.base64}`;

  // 1.5 Face likeness verification & conditional retry
  let identityScore: number | null = null;
  let needsReview = false;

  if (uploadedImage) {
    identityScore = await compareFaces(uploadedImage, rawDataUri);
    const minSimilarity = getMinSimilarityThreshold();
    if (identityScore !== null && identityScore < minSimilarity) {
      logger.warn(
        { eventId, identityScore, minSimilarity },
        "Automated event facial likeness below threshold; retrying once with reinforced identity prompt"
      );
      const retryPrompt = `${prompt}\nSTRICT IDENTITY ENFORCEMENT: Preserve exact face structure, eyes, nose, lips and facial identity 100% identically.`;
      try {
        const retryImage = await generateImage(retryPrompt, uploadedImage, "flux");
        const retryDataUri = `data:${retryImage.mimeType};base64,${retryImage.base64}`;
        const retryScore = await compareFaces(uploadedImage, retryDataUri);
        if (retryScore !== null && retryScore > identityScore) {
          image = retryImage;
          rawDataUri = retryDataUri;
          identityScore = retryScore;
        }
      } catch (retryErr) {
        logger.warn({ eventId, err: retryErr }, "Identity retry generation failed; keeping initial image");
      }
      needsReview = identityScore !== null && identityScore < minSimilarity;
    }
  }

  // 2. Upload clean image to Cloudinary CDN
  logger.debug({ eventId }, "Uploading clean generated image to Cloudinary");
  const cleanImageUrl = await uploadToCloudinary(rawDataUri);

  // 3. Generate video from the CLEAN image
  let videoUrl = "";
  const shouldGenerateVideo = event.mediaType === "video" || event.mediaType === "both";

  if (shouldGenerateVideo) {
    try {
      logger.info({ eventId, mediaType: event.mediaType, videoModel: event.videoModel }, "Generating automated celebration video from clean portrait");
      const videoResult = await generateVideoWithModel({
        imageUrl: cleanImageUrl,
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

  // 4. Overlay crisp text on the still image for email / display
  logger.debug({ eventId }, "Applying high-resolution SVG text overlay to still image");
  let finalImageUrl = cleanImageUrl;
  try {
    const overlaid = await overlayTextOnImage(image.base64, {
      occasion: event.occasion,
      name: event.name,
      customMessage: event.customMessage,
    });
    finalImageUrl = await uploadToCloudinary(
      `data:${overlaid.mimeType};base64,${overlaid.base64}`
    );
  } catch (overlayErr) {
    logger.warn({ eventId, err: overlayErr }, "Text overlay failed; falling back to clean image");
  }

  // 5. Persist Wish & Event records with both generatedImage (overlaid) and cleanImage
  const wish = await Wish.create({
    user: event.userId,
    occasion: event.occasion,
    theme: "Corporate",
    generatedImage: finalImageUrl,
    cleanImage: cleanImageUrl,
    identityScore: identityScore !== null ? identityScore : undefined,
    needsReview,
    people: ["Employee"],
    decorations: ["Confetti"],
    customMessage: event.customMessage,
    animationEnabled: shouldGenerateVideo && Boolean(videoUrl),
    aiProvider: "flux",
    prompt,
  });

  event.cleanImage = cleanImageUrl;
  event.generatedWishImage = finalImageUrl;
  event.identityScore = identityScore !== null ? identityScore : undefined;
  event.needsReview = needsReview;
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
