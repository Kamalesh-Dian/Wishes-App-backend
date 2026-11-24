import { Router } from "express";
import { generateWish, sendCelebrationEmail, generateCelebrationVideo } from "../controllers/generate.controller";
import { auth } from "../middleware/auth";

const router = Router();

router.post("/", auth, generateWish);
router.post("/video", auth, generateCelebrationVideo);
router.post("/send-email", auth, sendCelebrationEmail);

export default router;
