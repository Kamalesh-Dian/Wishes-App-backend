import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import cloudinary from "../config/cloudinary";
import { logger } from "../utils/logger";

export const uploadImage = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No image uploaded",
      });
    }

    const base64 = Buffer.from(file.buffer).toString("base64");
    const dataURI = `data:${file.mimetype};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataURI, {
      folder: "wishes-ai",
    });

    res.json({
      success: true,
      imageUrl: result.secure_url,
    });
  } catch (error) {
    logger.error({ err: error }, "Image upload failed");

    res.status(500).json({
      success: false,
      message: "Image upload failed",
    });
  }
};
