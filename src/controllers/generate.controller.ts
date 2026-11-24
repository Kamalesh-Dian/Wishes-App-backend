import type { AuthRequest } from "../middleware/auth";
import type { Response } from "express";
import { z } from "zod";
import { buildFluxPrompt } from "../services/promptBuilder";
import { generateImage } from "../services/image.service";
import { uploadToCloudinary } from "../services/cloudinary.service";
import { generateVideoWithModel } from "../services/video.service";
import Wish from "../models/Wish";
import { logger } from "../utils/logger";

const generateWishSchema = z.object({
  occasion: z.string().trim().min(1, "Occasion is required"),
  theme: z.string().trim().min(1, "Theme is required"),
  people: z.array(z.string()).default([]),
  decorations: z.array(z.string()).default([]),
  aiEngine: z.string().default("gemini"),
  uploadedImage: z
    .string()
    .refine(
      (val) => {
        if (!val) return true;
        if (!val.startsWith("data:image/")) return false;
        const commaIdx = val.indexOf(",");
        if (commaIdx === -1) return false;
        const sizeInBytes = (val.length - commaIdx - 1) * 0.75;
        return sizeInBytes <= 5 * 1024 * 1024;
      },
      { message: "Uploaded image must be a valid image data URL under 5 MB" }
    )
    .optional(),
  additionalInformation: z
    .string()
    .max(100, "Additional information must be under 100 characters")
    .optional(),
  customMessage: z.string().optional(),
  animationEnabled: z.boolean().optional().default(false),
});

export async function generateWish(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    // 1. Validate request body with Zod
    const validation = generateWishSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    // 2. Plan-based tier generation cap
    const userEmail = (req.user?.email || "").toLowerCase();
    let maxImages = 5; // Default free plan: 5 images
    let planName = "Free Plan";
    if (userEmail.includes("ultimate") || userEmail.includes("enterprise") || userEmail.includes("12")) {
      maxImages = 75; // 75 images + 25 videos = 100 total
      planName = "Ultimate Plan ($12)";
    } else if (userEmail.includes("pro") || userEmail.includes("5")) {
      maxImages = 40; // 40 images + 10 videos = 50 total
      planName = "Pro Plan ($5)";
    }

    const totalWishesCount = await Wish.countDocuments({ user: userId });
    if (totalWishesCount >= maxImages) {
      return res.status(403).json({
        success: false,
        error: `Image generation limit reached for ${planName} (${totalWishesCount}/${maxImages} images used). Upgrade your plan to continue generating.`,
      });
    }

    // Daily per-user generation cap fallback
    const dailyLimit = parseInt(process.env.DAILY_GENERATION_LIMIT || "200", 10);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayCount = await Wish.countDocuments({
      user: userId,
      createdAt: { $gte: startOfDay },
    });

    if (todayCount >= dailyLimit) {
      return res.status(429).json({
        success: false,
        error: `Daily generation limit of ${dailyLimit} wishes reached. Please try again tomorrow.`,
      });
    }

    // 3. Build AI generation prompt
    const prompt = buildFluxPrompt(data);

    // 4. Generate AI image
    const imageProvider =
      data.aiEngine === "flux" || data.aiEngine === "svd" ? "flux" : "gemini";
    const image = await generateImage(prompt, data.uploadedImage, imageProvider);

    // 5. Upload result to Cloudinary
    const imageUrl = await uploadToCloudinary(
      `data:${image.mimeType};base64,${image.base64}`
    );

    // 5.5 If video creation is enabled, synthesize video alongside image
    let videoUrl: string | undefined = undefined;
    if (data.animationEnabled) {
      try {
        logger.info(
          { model: data.aiEngine },
          "Synthesizing celebration video alongside image"
        );
        const videoRes = await generateVideoWithModel({
          imageUrl,
          occasion: data.occasion,
          theme: data.theme,
          customMessage: data.customMessage,
          people: data.people,
          decorations: data.decorations,
          additionalInformation: data.additionalInformation,
          duration: data.aiEngine === "svd" ? 4 : 8,
          aiEngine: data.aiEngine === "svd" ? "svd" : "gemini",
        });
        videoUrl = videoRes.videoUrl;
        logger.info({ videoUrl, model: videoRes.model }, "Celebration video synthesized successfully");
      } catch (vidErr) {
        logger.warn({ err: vidErr }, "Auto-video synthesis failed; falling back to image-only");
      }
    }

    // 6. Persist Wish record
    const wish = await Wish.create({
      user: userId,
      occasion: data.occasion,
      theme: data.theme,
      generatedImage: imageUrl,
      people: data.people,
      decorations: data.decorations,
      customMessage: data.customMessage,
      animationEnabled: data.animationEnabled,
      aiProvider: data.aiEngine,
      prompt,
    });

    return res.json({
      success: true,
      imageURL: imageUrl,
      videoURL: videoUrl,
      mimeType: image.mimeType,
      wishId: wish._id,
    });
  } catch (error) {
    // Sanitize error logging and client response to avoid leaking upstream API details
    logger.error({ err: error instanceof Error ? error.message : error }, "Wish generation failed");

    return res.status(500).json({
      success: false,
      error: "An error occurred while generating your wish. Please try again later.",
    });
  }
}

export async function sendCelebrationEmail(req: AuthRequest, res: Response) {
  try {
    const { to, name, occasion, customMessage, imageUrl, videoBase64 } = req.body;
    if (!to) {
      return res.status(400).json({ success: false, error: "Recipient email is required" });
    }

    const { transporter } = await import("../services/email/transporter");

    const attachments: any[] = [];
    if (videoBase64) {
      const base64Data = videoBase64.includes(",") ? videoBase64.split(",")[1] : videoBase64;
      const buffer = Buffer.from(base64Data, "base64");
      attachments.push({
        filename: `wishes-ai-celebration-${Date.now()}.webm`,
        content: buffer,
        contentType: "video/webm",
      });
    }

    const recipientName = name || "Celebrant";
    const occasionTitle = occasion || "Special Day";

    const mailOptions = {
      from: process.env.MAIL_FROM || '"Wishes AI" <kamaleshe76@gmail.com>',
      to,
      subject: `🎉 Happy ${occasionTitle} ${recipientName}!`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0f2a2a; color: #d9faf4; padding: 32px; border-radius: 20px; max-width: 600px; margin: auto; text-align: center;">
          <div style="display: inline-block; padding: 4px 14px; background: rgba(0,191,166,0.15); border: 1px solid #00bfa6; border-radius: 999px; color: #00bfa6; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            Wishes AI Celebration
          </div>
          <h1 style="color: #ffffff; font-size: 26px; margin-bottom: 8px; font-weight: 800;">
            🎉 Happy ${occasionTitle} ${recipientName}!
          </h1>
          <p style="color: #00bfa6; font-size: 15px; margin-bottom: 24px; font-weight: 600;">
            ${customMessage || "Wishing you joy, happiness and unforgettable memories! ✨"}
          </p>
          ${
            imageUrl
              ? `<div style="margin-bottom: 24px;"><img src="${imageUrl}" alt="Celebration Wish" style="max-width: 100%; border-radius: 16px; border: 1px solid rgba(0,191,166,0.3); box-shadow: 0 10px 30px rgba(0,0,0,0.5);" /></div>`
              : ""
          }
          <div style="background: #143838; border: 1px solid rgba(0,191,166,0.25); border-radius: 16px; padding: 18px; margin-bottom: 20px; text-align: left;">
            <p style="color: #d9faf4; font-size: 13px; line-height: 1.6; margin: 0;">
              ✨ <strong>Celebration Details:</strong><br/>
              • <strong>Occasion:</strong> ${occasionTitle}<br/>
              • <strong>Recipient:</strong> ${recipientName} (${to})<br/>
              ${attachments.length > 0 ? "• <strong>Animated Video:</strong> Attached below (.webm)" : ""}
            </p>
          </div>
          <p style="color: rgba(217,250,244,0.6); font-size: 11px;">
            Created with Wishes AI • Neural Celebration Platform
          </p>
        </div>
      `,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info({ to, messageId: info.messageId }, "Celebration wish email dispatched");

    return res.json({
      success: true,
      message: `Celebration email sent to ${to}`,
      messageId: info.messageId,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to send celebration email");
    return res.status(500).json({
      success: false,
      error: "Failed to send celebration email. Please check recipient address or try again.",
    });
  }
}

const generateVideoSchema = z.object({
  imageUrl: z.string().min(1, "Image URL or data is required"),
  occasion: z.string().default("Celebration"),
  theme: z.string().optional().default(""),
  customMessage: z.string().optional().default(""),
  people: z.array(z.string()).optional().default([]),
  decorations: z.array(z.string()).optional().default([]),
  additionalInformation: z.string().optional().default(""),
  prompt: z.string().optional(),
  duration: z.number().min(4).max(8).optional().default(8),
  motionStyle: z.string().optional().default("cinematic-bokeh"),
  aiEngine: z.string().optional().default("video-model"),
});

export async function generateCelebrationVideo(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const validation = generateVideoSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    // Check if a stored Wish exists with the original generation prompt
    if (!data.prompt && data.imageUrl) {
      try {
        const storedWish = await Wish.findOne({ generatedImage: data.imageUrl, user: userId });
        if (storedWish?.prompt) {
          data.prompt = storedWish.prompt;
          logger.info({ wishId: storedWish._id }, "Retrieved stored image prompt for video synthesis");
        }
      } catch (findErr) {
        // Fall back to building prompt from parameters
      }
    }

    // Plan-based video generation cap
    const userEmail = (req.user?.email || "").toLowerCase();
    let maxVideos = 3; // Free: 3 videos
    let planName = "Free Plan";
    if (userEmail.includes("ultimate") || userEmail.includes("enterprise") || userEmail.includes("12")) {
      maxVideos = 25;
      planName = "Ultimate Plan ($12)";
    } else if (userEmail.includes("pro") || userEmail.includes("5")) {
      maxVideos = 10;
      planName = "Pro Plan ($5)";
    }

    logger.info({ userId, userEmail, planName, duration: data.duration, hasPrompt: Boolean(data.prompt) }, "Processing AI Model Video Generation");

    // Call video model service with full prompt context
    const result = await generateVideoWithModel({
      imageUrl: data.imageUrl,
      occasion: data.occasion,
      theme: data.theme,
      customMessage: data.customMessage,
      people: data.people,
      decorations: data.decorations,
      additionalInformation: data.additionalInformation,
      prompt: data.prompt,
      duration: data.duration,
      motionStyle: data.motionStyle,
      aiEngine: data.aiEngine,
    });

    return res.json({
      success: true,
      videoUrl: result.videoUrl,
      duration: result.duration,
      mimeType: result.mimeType,
      model: result.model,
    });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : error }, "Video generation controller failed");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate celebration video",
    });
  }
}
