import type { AuthRequest } from "../middleware/auth";
import type { Response } from "express";
import { z } from "zod";
import { buildFluxPrompt } from "../services/promptBuilder";
import { generateImage } from "../services/image.service";
import { uploadToCloudinary } from "../services/cloudinary.service";
import Wish from "../models/Wish";
import { logger } from "../utils/logger";

const generateWishSchema = z.object({
  occasion: z.string().trim().min(1, "Occasion is required"),
  theme: z.string().trim().min(1, "Theme is required"),
  people: z.array(z.string()).default([]),
  decorations: z.array(z.string()).default([]),
  aiEngine: z.enum(["gemini", "openai", "flux"]).default("gemini"),
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

    // 2. Daily per-user generation cap
    const dailyLimit = parseInt(process.env.DAILY_GENERATION_LIMIT || "20", 10);
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
    const image = await generateImage(prompt, data.uploadedImage, data.aiEngine);

    // 5. Upload result to Cloudinary
    const imageUrl = await uploadToCloudinary(
      `data:${image.mimeType};base64,${image.base64}`
    );

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
