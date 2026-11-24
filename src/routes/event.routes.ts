import express from "express";
import multer from "multer";
import { auth } from "../middleware/auth";

import {
  uploadEvents,
  getEvents,
  importJsonEvents,
  saveGeneratedWish,
  updateEvent,
  deleteEvent,
  sendEventWhatsApp,
  sendEventEmail,
} from "../controllers/event.controller";

const router = express.Router();

const upload = multer();

router.use(auth);

router.post("/import", upload.single("file"), uploadEvents);

router.get("/", getEvents);

router.post("/import-json", importJsonEvents);

router.put("/:eventId/generated", saveGeneratedWish);
router.put("/:eventId", updateEvent);
router.delete("/:eventId", deleteEvent);
router.post("/:eventId/send-whatsapp", sendEventWhatsApp);
router.post("/:eventId/send-email", sendEventEmail);

export default router;
