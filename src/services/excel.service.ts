import * as XLSX from "xlsx";
import { logger } from "../utils/logger";

export const MAX_EXCEL_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_EXCEL_ROWS = 1000;

export interface ParsedExcelEvent {
  Name: string;
  Email: string;
  Phone?: string;
  PhotoURL: string;
  EventType: string;
  EventDate: Date | null;
  Department: string;
  CustomMessage: string;
  MediaType?: "image" | "video" | "both";
  DeliveryChannel?: "email" | "whatsapp" | "both";
  VideoModel?: "gemini-omni" | "svd";
}

export const parseExcel = (fileBuffer: Buffer): ParsedExcelEvent[] => {
  if (fileBuffer.length > MAX_EXCEL_BYTES) {
    throw new Error(`Excel file exceeds maximum allowed size of 5MB (${(fileBuffer.length / (1024 * 1024)).toFixed(1)}MB)`);
  }

  const workbook = XLSX.read(fileBuffer, {
    type: "buffer",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel workbook contains no sheets");
  }

  const worksheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    raw: true,
    defval: "",
  });

  if (rows.length > MAX_EXCEL_ROWS) {
    throw new Error(`Excel sheet exceeds maximum limit of 1000 rows (found ${rows.length})`);
  }

  // Filter out empty rows (where name and email are both empty)
  const validRows = rows.filter((row) => {
    const name = String(row.Name || row.name || "").trim();
    const email = String(row.Email || row.email || "").trim();
    return name !== "" || email !== "";
  });

  return validRows.map((row) => {
    // Standardize key names (case-insensitive or common variations)
    const Name = String(row.Name || row.name || "");
    const Email = String(row.Email || row.email || "");
    const Phone = String(row.Phone || row.phone || row.Mobile || row.mobile || row.WhatsApp || row.whatsapp || row.Contact || "");
    const PhotoURL = String(row.PhotoURL || row.photoUrl || row.PhotoUrl || "");
    const EventType = String(row.EventType || row.eventType || row.Occasion || row.occasion || "");
    const EventDateVal = row.EventDate ?? row.eventDate ?? row.Eventdate ?? row.Date ?? row.date ?? "";
    const Department = String(row.Department || row.department || "");
    const CustomMessage = String(row.CustomMessage || row.customMessage || "");

    const rawMediaType = String(row.MediaType || row.mediaType || row.Media || row.media || "").toLowerCase().trim();
    let mediaType: "image" | "video" | "both" = "image";
    if (rawMediaType.includes("both")) {
      mediaType = "both";
    } else if (rawMediaType.includes("vid") || rawMediaType.includes("motion")) {
      mediaType = "video";
    }

    const rawDelivery = String(row.DeliveryChannel || row.deliveryChannel || row.Delivery || row.delivery || row.Channel || row.channel || "").toLowerCase().trim();
    let deliveryChannel: "email" | "whatsapp" | "both" = "email";
    if (rawDelivery.includes("both") || (rawDelivery.includes("email") && rawDelivery.includes("whatsapp"))) {
      deliveryChannel = "both";
    } else if (rawDelivery.includes("whatsapp") || rawDelivery.includes("wa")) {
      deliveryChannel = "whatsapp";
    }

    const rawVideoModel = String(row.VideoModel || row.videoModel || "").toLowerCase().trim();
    const videoModel: "gemini-omni" | "svd" = rawVideoModel.includes("svd") ? "svd" : "gemini-omni";

    let parsedDate: Date | null = null;
    try {
      parsedDate = parseExcelDate(EventDateVal);
    } catch {
      logger.warn("Failed to parse date for an Excel row: invalid date format");
    }

    return {
      Name: Name.trim(),
      Email: Email.trim(),
      Phone: Phone.trim(),
      PhotoURL: PhotoURL.trim(),
      EventType: EventType.trim(),
      EventDate: parsedDate,
      Department: Department.trim(),
      CustomMessage: CustomMessage.trim(),
      MediaType: mediaType,
      DeliveryChannel: deliveryChannel,
      VideoModel: videoModel,
    };
  });
};

function parseExcelDate(value: unknown): Date {
  if (value === null || value === undefined || value === "") {
    throw new Error("Date value is empty or missing");
  }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new Error("Date object is invalid");
    }
    const correctedDate = new Date(value.getTime());
    correctedDate.setDate(correctedDate.getDate() + 1);
    return correctedDate;
  }

  if (typeof value === "number") {
    const excelDate = XLSX.SSF.parse_date_code(value);
    const correctedDate = new Date(excelDate.y, excelDate.m - 1, excelDate.d);
    correctedDate.setDate(correctedDate.getDate() + 1);
    return correctedDate;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Date string is empty");
    }

    // Try standard Date parsing first (handles YYYY-MM-DD, MM/DD/YYYY, etc.)
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    // Fallback: manual parsing for YYYY-MM-DD or DD-MM-YYYY
    const parts = trimmed.split(/[-/]/).map(Number);
    if (parts.length === 3) {
      // Check if it's YYYY-MM-DD
      if (parts[0] > 1000) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
      }
      // Check if it's DD-MM-YYYY
      if (parts[2] > 1000) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
      }
    }
  }

  throw new Error(`Invalid EventDate format: ${String(value)}`);
}
