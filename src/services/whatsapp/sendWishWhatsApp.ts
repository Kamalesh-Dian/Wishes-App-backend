import axios from "axios";
import { logger } from "../../utils/logger";

export interface WhatsAppPayload {
  phone: string;
  name: string;
  occasion: string;
  imageUrl?: string;
  videoUrl?: string;
  customMessage?: string;
}

export interface WhatsAppSendResult {
  success: boolean;
  provider: "meta_cloud_api" | "twilio" | "wa_link_dispatch";
  messageId?: string;
  directLink: string;
  recipientPhone: string;
  details?: string;
}

/**
 * Normalizes phone numbers to standard numeric string with country code.
 * e.g., "+1 (415) 555-0192" -> "14155550192"
 */
export function normalizePhoneNumber(phone: string): string {
  const digits = (phone || "").replace(/[^\d]/g, "");
  return digits;
}

/**
 * Formats a premium celebration message for WhatsApp.
 */
export function buildWhatsAppMessage(payload: WhatsAppPayload): string {
  const { name, occasion, customMessage, imageUrl, videoUrl } = payload;
  const header = `✨ *Happy ${occasion}, ${name}!* 🎉`;
  const messageBody = customMessage?.trim()
    ? customMessage.trim()
    : `Wishing you tremendous joy, vibrant milestones, and wonderful celebration on your special day!`;

  const lines = [
    header,
    "",
    messageBody,
  ];

  if (imageUrl) {
    lines.push("");
    lines.push(`🖼️ *Personalized Celebration Card:*`);
    lines.push(imageUrl);
  }

  if (videoUrl) {
    lines.push("");
    lines.push(`🎬 *Celebration Animation Video:*`);
    lines.push(videoUrl);
  }

  lines.push("");
  lines.push(`_Crafted with Wishes AI Studio_`);

  return lines.join("\n");
}

/**
 * Generates direct wa.me link for manual or client-side dispatching.
 */
export function generateDirectWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = normalizePhoneNumber(phone);
  const encoded = encodeURIComponent(text);
  return cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encoded}`
    : `https://api.whatsapp.com/send?text=${encoded}`;
}

/**
 * Dispatches WhatsApp message via Meta Cloud API, Twilio API, or wa.me dispatch record.
 */
export async function sendWishWhatsApp(payload: WhatsAppPayload): Promise<WhatsAppSendResult> {
  const cleanPhone = normalizePhoneNumber(payload.phone);
  if (!cleanPhone) {
    throw new Error("Phone number is required for WhatsApp delivery");
  }

  const messageText = buildWhatsAppMessage(payload);
  const directLink = generateDirectWhatsAppUrl(payload.phone, messageText);

  // 1. WhatsApp Cloud API (Meta Graph API)
  const metaToken = process.env.WHATSAPP_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (metaToken && metaPhoneId) {
    try {
      logger.info({ phone: cleanPhone, occasion: payload.occasion }, "Dispatching WhatsApp message via Meta Cloud API");

      // Send text message (or media message if imageUrl is present)
      const res = await axios.post(
        `https://graph.facebook.com/v21.0/${metaPhoneId}/messages`,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: payload.imageUrl ? "image" : "text",
          ...(payload.imageUrl
            ? {
                image: {
                  link: payload.imageUrl,
                  caption: messageText.substring(0, 1024),
                },
              }
            : {
                text: {
                  preview_url: true,
                  body: messageText,
                },
              }),
        },
        {
          headers: {
            Authorization: `Bearer ${metaToken}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const msgId = res.data?.messages?.[0]?.id;
      logger.info({ phone: cleanPhone, msgId }, "WhatsApp message sent via Meta Cloud API");

      return {
        success: true,
        provider: "meta_cloud_api",
        messageId: msgId,
        directLink,
        recipientPhone: cleanPhone,
      };
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: unknown }; message?: string })?.response?.data || (err as Error).message;
      logger.warn({ err: errorMsg, phone: cleanPhone }, "Meta WhatsApp Cloud API send failed; checking secondary providers");
    }
  }

  // 2. Twilio WhatsApp API
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  if (twilioSid && twilioToken && twilioFrom) {
    try {
      logger.info({ phone: cleanPhone, occasion: payload.occasion }, "Dispatching WhatsApp message via Twilio API");

      const fromFormatted = twilioFrom.startsWith("whatsapp:") ? twilioFrom : `whatsapp:${twilioFrom}`;
      const toFormatted = `whatsapp:+${cleanPhone}`;

      const params = new URLSearchParams();
      params.append("From", fromFormatted);
      params.append("To", toFormatted);
      params.append("Body", messageText);
      if (payload.imageUrl) {
        params.append("MediaUrl", payload.imageUrl);
      }

      const twilioRes = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`,
          },
          timeout: 15000,
        }
      );

      const sid = twilioRes.data?.sid;
      logger.info({ phone: cleanPhone, sid }, "WhatsApp message sent via Twilio API");

      return {
        success: true,
        provider: "twilio",
        messageId: sid,
        directLink,
        recipientPhone: cleanPhone,
      };
    } catch (twilioErr: unknown) {
      const errorMsg = (twilioErr as { response?: { data?: unknown }; message?: string })?.response?.data || (twilioErr as Error).message;
      logger.warn({ err: errorMsg, phone: cleanPhone }, "Twilio WhatsApp send failed; falling back to direct dispatch link");
    }
  }

  // 3. Direct wa.me Dispatch Record (Default when direct API credentials are not yet linked)
  logger.info(
    { phone: cleanPhone, name: payload.name, occasion: payload.occasion, directLink },
    "WhatsApp automated dispatch prepared with wa.me direct link"
  );

  return {
    success: true,
    provider: "wa_link_dispatch",
    directLink,
    recipientPhone: cleanPhone,
    details: "Prepared for automated WhatsApp delivery via wa.me link. Configure WHATSAPP_TOKEN or TWILIO_ACCOUNT_SID in backend/.env for headless direct API messaging.",
  };
}
