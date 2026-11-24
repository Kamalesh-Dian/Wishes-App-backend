import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import Event from "../models/Event";
import { parseExcel, type ParsedExcelEvent } from "../services/excel.service";
import { sendWishMail } from "../services/email/sendWishMail";
import { sendWishWhatsApp } from "../services/whatsapp/sendWishWhatsApp";
import { logger } from "../utils/logger";

export const uploadEvents = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Excel file required",
      });
    }
    const rows = parseExcel(file.buffer);

    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const userEmail = (req.user?.email || "").toLowerCase();
    if (userEmail && userEmail.includes("free")) {
      return res.status(403).json({
        success: false,
        message: "Event scheduling is restricted to Pro ($5) and Ultimate ($12) plans. Please upgrade your plan.",
      });
    }

    // Filter duplicate rows (by Email and Occasion/EventType) inside the excel file
    const seen = new Set<string>();
    const uniqueRows = rows.filter((row: ParsedExcelEvent) => {
      const occasion = row.EventType || "";
      const key = `${row.Email}_${occasion}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // Filter out rows with invalid or missing EventDate/Name/Email
    const validRows = uniqueRows.filter((row: ParsedExcelEvent) => {
      return (
        Boolean(row.Name) &&
        Boolean(row.Email) &&
        row.EventDate instanceof Date &&
        !isNaN(row.EventDate.getTime())
      );
    });

    const events = validRows.map((row: ParsedExcelEvent) => ({
      userId,
      name: row.Name,
      email: row.Email,
      phone: row.Phone || "",
      photoUrl: row.PhotoURL,
      occasion: row.EventType,
      eventDate: row.EventDate!,
      eventMonth: row.EventDate!.getMonth() + 1,
      eventDay: row.EventDate!.getDate(),
      department: row.Department,
      customMessage: row.CustomMessage,
      mediaType: row.MediaType || "image",
      deliveryChannel: row.DeliveryChannel || "email",
      videoModel: row.VideoModel || "gemini-omni",
      source: "excel" as const,
      status: "pending" as const,
    }));

    // Insert new events first to ensure no data is lost if DB insertion fails
    const saved = await Event.insertMany(events);
    const newIds = saved.map((e) => e._id);

    // Clean up previous manually uploaded events for the user only after successful insertion
    await Event.deleteMany({
      userId,
      source: "excel",
      _id: { $nin: newIds },
    });

    logger.info({ userId, count: saved.length }, "Events uploaded and synced via Excel");

    return res.json({
      success: true,
      count: saved.length,
    });
  } catch (err) {
    logger.error({ err }, "Error uploading events via Excel");

    return res.status(500).json({
      success: false,
    });
  }
};

export const getEvents = async (req: AuthRequest, res: Response) => {
  try {
    const source = req.query.source as "excel" | "onedrive" | undefined;

    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const userEmail = (req.user?.email || "").toLowerCase();
    if (userEmail && userEmail.includes("free")) {
      return res.status(403).json({
        success: false,
        message: "Event scheduling is restricted to Pro ($5) and Ultimate ($12) plans. Please upgrade your plan.",
      });
    }

    const filter: Record<string, unknown> = {
      userId,
    };

    if (source) {
      filter.source = source;
    }

    const events = await Event.find(filter).sort({
      eventDate: 1,
    });
    res.json(events);
  } catch (error) {
    logger.error({ err: error }, "Error fetching events");

    res.status(500).json({
      success: false,
    });
  }
};

export const importJsonEvents = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const userEmail = (req.user?.email || "").toLowerCase();
    if (userEmail && userEmail.includes("free")) {
      return res.status(403).json({
        success: false,
        message: "Event scheduling is restricted to Pro ($5) and Ultimate ($12) plans. Please upgrade your plan.",
      });
    }

    const rawEvents = req.body as Array<Record<string, unknown>>;
    const events = rawEvents.map((event) => {
      const date = new Date(String(event.eventDate));
      return {
        ...event,
        userId,
        eventDate: date,
        eventMonth: date.getMonth() + 1,
        eventDay: date.getDate(),
      };
    });
    const saved = await Event.insertMany(events);

    res.json({
      success: true,
      count: saved.length,
    });
  } catch (error: unknown) {
    logger.error({ err: error }, "Error importing JSON events");

    res.status(500).json({
      success: false,
      error: "Failed to import events",
    });
  }
};

export const saveGeneratedWish = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const { generatedWishImage, generatedWishText } = req.body;

    const event = await Event.findOneAndUpdate(
      { _id: eventId, userId },
      {
        generatedWishImage,
        generatedWishText,
        generatedAt: new Date(),
        status: "generated",
      },
      {
        new: true,
      },
    );

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json(event);
  } catch (error) {
    logger.error({ err: error }, "Error saving generated wish");

    res.status(500).json({
      success: false,
    });
  }
};

export const updateEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const updateData = req.body;
    
    // Validate user
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const event = await Event.findOneAndUpdate(
      { _id: eventId, userId },
      { $set: updateData },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json(event);
  } catch (error) {
    logger.error({ err: error }, "Error updating event");
    res.status(500).json({ success: false });
  }
};

export const deleteEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    
    // Validate user
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const event = await Event.findOneAndDelete({ _id: eventId, userId });

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json({ success: true, message: "Event deleted" });
  } catch (error) {
    logger.error({ err: error }, "Error deleting event");
    res.status(500).json({ success: false });
  }
};

export const sendEventWhatsApp = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const event = await Event.findOne({ _id: eventId, userId });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const phone = (req.body.phone || event.phone || "").trim();
    if (!phone) {
      return res.status(400).json({ success: false, message: "Recipient phone number is required" });
    }

    const imageUrl = event.generatedWishImage;
    const videoUrl = event.generatedWishVideo;

    if (!imageUrl && !videoUrl) {
      return res.status(400).json({ success: false, message: "No generated media available to send. Generate wish first." });
    }

    const result = await sendWishWhatsApp({
      phone,
      name: event.name,
      occasion: event.occasion,
      imageUrl,
      videoUrl,
      customMessage: event.customMessage,
    });

    event.whatsappStatus = "sent";
    if (phone !== event.phone) {
      event.phone = phone;
    }
    await event.save();

    logger.info({ eventId, phone, provider: result.provider }, "Manual WhatsApp dispatch succeeded");

    return res.json({
      success: true,
      message: "WhatsApp wish dispatched successfully",
      result,
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errMessage }, "Error sending WhatsApp wish");
    return res.status(500).json({ success: false, message: errMessage });
  }
};

export const sendEventEmail = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const event = await Event.findOne({ _id: eventId, userId });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const email = (req.body.email || event.email || "").trim();
    if (!email) {
      return res.status(400).json({ success: false, message: "Recipient email is required" });
    }

    const imageUrl = event.generatedWishImage;
    const videoUrl = event.generatedWishVideo;

    if (!imageUrl && !videoUrl) {
      return res.status(400).json({ success: false, message: "No generated media available to send. Generate wish first." });
    }

    await sendWishMail({
      to: email,
      name: event.name,
      occasion: event.occasion,
      imageUrl,
      videoUrl,
      customMessage: event.customMessage,
    });

    event.emailStatus = "sent";
    await event.save();

    logger.info({ eventId, email }, "Manual Email dispatch succeeded");

    return res.json({
      success: true,
      message: "Email wish sent successfully",
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errMessage }, "Error sending email wish");
    return res.status(500).json({ success: false, message: errMessage });
  }
};
