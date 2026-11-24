import { Router } from "express";
import { auth } from "../middleware/auth";
import { getMe } from "../controllers/user.controller";

const router = Router();

router.get("/me", auth, getMe);

export default router;
