import Wish from "../models/Wish";
import { buildFluxPrompt } from "./promptBuilder";
import { generateImage } from "./image.service";
import { uploadToCloudinary } from "./cloudinary.service";
import { generateVideoWithModel } from "./video.service";
import { overlayTextOnImage } from "./overlay.service";
import { compareFaces, getMinSimilarityThreshold } from "./identityCheck.service";
import { logger } from "../utils/logger";

export class AsyncJobQueue {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;

  public push(job: () => Promise<void>): void {
    this.queue.push(job);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    const nextJob = this.queue.shift();
    if (nextJob) {
      try {
        await nextJob();
      } catch (err) {
        logger.error({ err }, "Error processing background job in AsyncJobQueue");
      } finally {
        this.isProcessing = false;
        this.processNext();
      }
    }
  }

  public get pendingCount(): number {
    return this.queue.length;
  }
}

export const wishJobQueue = new AsyncJobQueue();

/**
 * Executes the full asynchronous wish generation pipeline
 */
export async function processWishJob(
  wishId: string,
  data: {
    occasion: string;
    theme: string;
    people?: string[];
    decorations?: string[];
    aiEngine?: string;
    videoModel?: string;
    uploadedImage?: string;
    additionalInformation?: string;
    customMessage?: string;
    animationEnabled?: boolean;
    videoDuration?: number;
  },
  userId: string
): Promise<void> {
  const wish = await Wish.findById(wishId);
  if (!wish) {
    logger.error({ wishId }, "Wish not found when starting background job");
    return;
  }

  try {
    // 1. Mark status as image synthesis
    wish.status = "image";
    await wish.save();

    const effectiveVideoModel =
      data.videoModel ||
      (data.aiEngine === "svd"
        ? "svd"
        : data.aiEngine === "gemini-omni"
        ? "gemini-omni"
        : undefined);
    const isVideoRequest = Boolean(data.animationEnabled || effectiveVideoModel);

    const imageProvider =
      data.aiEngine === "flux" || data.aiEngine === "svd" || data.videoModel === "svd"
        ? "flux"
        : "gemini";

    const prompt = buildFluxPrompt(data);
    wish.prompt = prompt;

    // 2. Synthesize clean image (no text baked into diffusion)
    let image = await generateImage(prompt, data.uploadedImage, imageProvider);
    let rawDataUri = `data:${image.mimeType};base64,${image.base64}`;

    // 2.5 Face likeness verification & conditional retry
    let identityScore: number | null = null;
    let needsReview = false;

    if (data.uploadedImage) {
      identityScore = await compareFaces(data.uploadedImage, rawDataUri);
      const minSimilarity = getMinSimilarityThreshold();
      if (identityScore !== null && identityScore < minSimilarity) {
        logger.warn(
          { wishId, identityScore, minSimilarity },
          "Facial likeness below threshold; retrying once with reinforced identity prompt"
        );
        const retryPrompt = `${prompt}\nSTRICT IDENTITY ENFORCEMENT: Preserve exact face structure, eyes, nose, lips and facial identity 100% identically.`;
        try {
          const retryImage = await generateImage(retryPrompt, data.uploadedImage, imageProvider);
          const retryDataUri = `data:${retryImage.mimeType};base64,${retryImage.base64}`;
          const retryScore = await compareFaces(data.uploadedImage, retryDataUri);
          if (retryScore !== null && retryScore > identityScore) {
            image = retryImage;
            rawDataUri = retryDataUri;
            identityScore = retryScore;
          }
        } catch (retryErr) {
          logger.warn({ wishId, err: retryErr }, "Identity retry generation encountered issue; keeping initial image");
        }
        needsReview = identityScore !== null && identityScore < minSimilarity;
      }
    }

    // 3. Upload clean image to Cloudinary
    let cleanImageUrl = "";
    try {
      cleanImageUrl = await uploadToCloudinary(rawDataUri);
    } catch (cloudErr) {
      logger.warn(
        { err: cloudErr },
        "Initial Cloudinary upload timed out; proceeding with data URI"
      );
      cleanImageUrl = rawDataUri;
    }

    // 4. If video requested, diffuse video motion from CLEAN image
    let videoUrl: string | undefined = undefined;
    if (isVideoRequest) {
      wish.status = "video";
      await wish.save();

      const chosenVideoModel = effectiveVideoModel || "gemini-omni";
      logger.info({ wishId, chosenVideoModel }, "Starting video motion diffusion from clean image");

      try {
        const videoRes = await generateVideoWithModel({
          imageUrl: cleanImageUrl.startsWith("http") ? cleanImageUrl : rawDataUri,
          occasion: data.occasion,
          theme: data.theme,
          customMessage: data.customMessage,
          people: data.people,
          decorations: data.decorations,
          additionalInformation: data.additionalInformation,
          duration: data.videoDuration || 8,
          aiEngine: chosenVideoModel === "svd" ? "svd" : "gemini",
        });
        videoUrl = videoRes.videoUrl;
      } catch (vidErr) {
        if (chosenVideoModel === "svd" || data.aiEngine === "flux" || data.aiEngine === "svd") {
          throw vidErr;
        }
        logger.warn({ wishId, err: vidErr }, "Video synthesis failed; falling back to image-only");
      }
    }

    // If cleanImageUrl was data URI fallback, retry upload
    if (!cleanImageUrl.startsWith("http")) {
      try {
        cleanImageUrl = await uploadToCloudinary(rawDataUri);
      } catch {
        cleanImageUrl = videoUrl || "data:image/png;base64,placeholder";
      }
    }

    // 5. Overlay crisp typography onto still picture
    let finalImageUrl = cleanImageUrl;
    try {
      const recipientName = data.people && data.people.length > 0 ? data.people[0] : undefined;
      const overlaid = await overlayTextOnImage(image.base64, {
        occasion: data.occasion,
        name: recipientName,
        customMessage: data.customMessage,
      });
      finalImageUrl = await uploadToCloudinary(
        `data:${overlaid.mimeType};base64,${overlaid.base64}`
      );
    } catch (overlayErr) {
      logger.warn({ wishId, err: overlayErr }, "Text overlay failed; falling back to clean image");
    }

    // 6. Complete Wish
    wish.status = "done";
    wish.generatedImage = finalImageUrl;
    wish.cleanImage = cleanImageUrl;
    wish.videoUrl = videoUrl;
    wish.videoTier = videoUrl ? (data.aiEngine === "svd" || data.videoModel === "svd" ? "ai-video" : "ai-video") : undefined;
    wish.identityScore = identityScore !== null ? identityScore : undefined;
    wish.needsReview = needsReview;
    wish.animationEnabled = isVideoRequest && Boolean(videoUrl);
    wish.aiProvider = isVideoRequest
      ? `${image.provider} (${data.videoModel || data.aiEngine || "gemini-omni"})`
      : image.provider;
    await wish.save();

    logger.info({ wishId, hasVideo: Boolean(videoUrl) }, "Async wish generation completed successfully");
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : "Wish generation failed";
    logger.error({ wishId, err: errMessage }, "Async wish generation job failed");

    wish.status = "failed";
    wish.error = errMessage;
    await wish.save().catch(() => {});
  }
}

/**
 * On server startup, marks wishes stuck in queued/image/video for > 15 minutes as failed.
 */
export async function recoverStuckWishes(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const result = await Wish.updateMany(
    {
      status: { $in: ["image", "video", "queued"] },
      updatedAt: { $lt: cutoff },
    },
    {
      $set: {
        status: "failed",
        error: "Generation timed out (stuck for more than 15 minutes)",
      },
    }
  );

  if (result.modifiedCount > 0) {
    logger.warn(
      { count: result.modifiedCount },
      "Marked stuck wishes as failed on startup"
    );
  }
  return result.modifiedCount;
}
