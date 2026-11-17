import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import upload from "../middleware/upload";
import { auth } from "../middleware/auth";
import { uploadImage } from "../controllers/upload.controller";

const router = Router();

const handleUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.single("image")(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File size exceeds 5MB limit",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message,
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "File upload error",
      });
    }
    next();
  });
};

router.post("/", auth, handleUploadMiddleware, uploadImage);

export default router;
