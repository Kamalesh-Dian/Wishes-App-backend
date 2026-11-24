import axios from "axios";
import type { Response } from "express";
import OneDriveConnection from "../models/OneDriveConnection";
import { syncOneDriveEvents } from "../services/automation/sync.service";
import Event from "../models/Event";
import { parseExcel, type ParsedExcelEvent } from "../services/excel.service";
import type { AuthRequest } from "../middleware/auth";
import { encrypt, decrypt } from "../utils/encryption";
import { logger } from "../utils/logger";

export async function getOneDriveStatus(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const connection = await OneDriveConnection.findOne({ userId });
    if (!connection) {
      return res.json({ connected: false });
    }

    return res.json({
      connected: true,
      fileName: connection.fileName,
      lastSync: connection.lastSync,
      syncEnabled: connection.syncEnabled,
      needsReconnect: connection.needsReconnect || false,
      lastError: connection.lastError,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to get OneDrive status");
    res.status(500).json({ success: false });
  }
}

export async function importOneDriveExcel(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userEmail = (req.user?.email || "").toLowerCase();
    if (userEmail && !userEmail.includes("ultimate") && !userEmail.includes("enterprise") && (userEmail.includes("free") || userEmail.includes("pro"))) {
      return res.status(403).json({
        success: false,
        message: "OneDrive auto-sync is restricted to the Ultimate Plan ($12). Please upgrade your subscription.",
      });
    }
    const { fileId, fileName } = req.body;

    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: "File Id missing",
      });
    }

    const msToken = req.headers["x-ms-token"] as string;

    if (!msToken) {
      return res.status(400).json({
        success: false,
        message: "Microsoft Access Token missing",
      });
    }

    // Encrypt token before persisting
    const encryptedToken = encrypt(msToken);

    await OneDriveConnection.findOneAndUpdate(
      { userId },
      {
        fileId,
        fileName,
        syncEnabled: true,
        accessToken: encryptedToken,
        needsReconnect: false,
        lastError: undefined,
      },
      {
        upsert: true,
        new: true,
      },
    );

    const metadataResponse = await axios.get(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
      {
        headers: {
          Authorization: `Bearer ${msToken}`,
        },
      }
    );

    const downloadUrl = metadataResponse.data["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) {
      throw new Error("Could not retrieve download URL for the Excel file from Graph API.");
    }

    const response = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(response.data);
    const rows = parseExcel(buffer);

    // Filter duplicate rows (by Email and Occasion/EventType) inside the excel file
    const seen = new Set<string>();
    const uniqueRows = rows.filter((row: any) => {
      const occasion = row.EventType || row.Occasion || "";
      const key = `${row.Email}_${occasion}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // Filter out rows with invalid or missing EventDate/Name/Email
    const validRows = uniqueRows.filter((row: any) => {
      return (
        row.Name &&
        row.Email &&
        row.EventDate &&
        row.EventDate instanceof Date &&
        !isNaN(row.EventDate.getTime())
      );
    });

    const events = validRows.map((row: any) => ({
      userId,
      name: row.Name,
      email: row.Email,
      photoUrl: row.PhotoURL,
      occasion: row.EventType || row.Occasion,
      eventDate: row.EventDate,
      eventMonth: row.EventDate.getMonth() + 1,
      eventDay: row.EventDate.getDate(),
      department: row.Department,
      customMessage: row.CustomMessage,
      source: "onedrive",
      status: "pending",
    }));

    // Insert new events first to preserve existing data if insertion fails
    const saved = await Event.insertMany(events);
    const newIds = saved.map((e: any) => e._id);

    // Clean up previous OneDrive events only after new events are safely saved
    await Event.deleteMany({
      userId,
      source: "onedrive",
      _id: { $nin: newIds },
    });

    return res.json(saved);
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await OneDriveConnection.updateOne(
        { userId: req.user?.uid },
        { needsReconnect: true, lastError: "Microsoft session expired" }
      );
      return res.status(401).json({
        success: false,
        needsReconnect: true,
        message: "Microsoft session expired. Please reconnect your OneDrive account.",
      });
    }

    logger.error({ err: error }, "OneDrive Import Failed");

    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to import OneDrive Excel",
    });
  }
}

export async function syncOneDrive(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const connection = await OneDriveConnection.findOne({
      userId,
      syncEnabled: true,
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: "No OneDrive file connected.",
      });
    }

    let tokenToUse = req.headers["x-ms-token"] as string;

    if (!tokenToUse && connection.accessToken) {
      tokenToUse = decrypt(connection.accessToken);
    }

    if (!tokenToUse) {
      connection.needsReconnect = true;
      connection.lastError = "No Microsoft access token available.";
      await connection.save();

      return res.status(401).json({
        success: false,
        needsReconnect: true,
        message: "Microsoft token missing. Please reconnect.",
      });
    }

    const result = await syncOneDriveEvents(userId, tokenToUse);

    // Save token if new token was passed
    if (req.headers["x-ms-token"]) {
      connection.accessToken = encrypt(req.headers["x-ms-token"] as string);
    }
    connection.needsReconnect = false;
    connection.lastError = undefined;
    connection.lastSync = new Date();

    await connection.save();

    return res.json({
      success: true,
      fileName: connection.fileName,
      lastSync: connection.lastSync,
      summary: result,
    });
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await OneDriveConnection.updateOne(
        { userId: req.user?.uid },
        { needsReconnect: true, lastError: "Microsoft session expired" }
      );
      return res.status(401).json({
        success: false,
        needsReconnect: true,
        message: "Microsoft session expired. Please reconnect your OneDrive account.",
      });
    }

    logger.error({ err: error }, "OneDrive Sync Failed");

    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "OneDrive synchronization failed",
    });
  }
}

export async function previewOneDriveExcel(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ success: false, message: "File Id missing" });
    }

    let msToken = req.headers["x-ms-token"] as string;
    if (!msToken) {
      const connection = await OneDriveConnection.findOne({ userId });
      if (connection?.accessToken) {
        msToken = decrypt(connection.accessToken);
      }
    }

    if (!msToken) {
      return res.status(400).json({ success: false, message: "Microsoft Access Token missing" });
    }

    const metadataResponse = await axios.get(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
      { headers: { Authorization: `Bearer ${msToken}` } }
    );

    const downloadUrl = metadataResponse.data["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) throw new Error("Could not retrieve download URL for preview.");

    const response = await axios.get(downloadUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);

    const rows = parseExcel(buffer);

    const previewData = rows.slice(0, 15).map((row: ParsedExcelEvent) => {
      let formattedDate = "";
      if (row.EventDate instanceof Date && !isNaN(row.EventDate.getTime())) {
        formattedDate = row.EventDate.toISOString().split("T")[0];
      }
      return {
        Name: row.Name || "Unknown",
        Email: row.Email || "",
        EventType: row.EventType || "Unknown",
        EventDate: formattedDate || "",
        photoUrl: row.PhotoURL || null,
      };
    });

    return res.json(previewData);
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await OneDriveConnection.updateOne(
        { userId: req.user?.uid },
        { needsReconnect: true, lastError: "Microsoft session expired during preview" }
      );
      return res.status(401).json({
        success: false,
        needsReconnect: true,
        message: "Microsoft session expired. Please reconnect.",
      });
    }

    const err = error as { message?: string };
    logger.error({ err: err?.message || error }, "OneDrive preview failed");
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to preview Excel",
    });
  }
}
