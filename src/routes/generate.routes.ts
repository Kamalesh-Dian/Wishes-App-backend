import { Router } from "express";
import { generateWish, getWishStatus, sendCelebrationEmail, generateCelebrationVideo } from "../controllers/generate.controller";
import { auth } from "../middleware/auth";

const router = Router();

router.post("/", auth, generateWish);
router.get("/:wishId/status", auth, getWishStatus);
router.post("/video", auth, generateCelebrationVideo);
router.post("/send-email", auth, sendCelebrationEmail);

export default router;
