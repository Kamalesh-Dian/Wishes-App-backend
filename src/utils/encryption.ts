import crypto from "node:crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended 96 bits for GCM
const TAG_LENGTH = 16; // 128-bit authentication tag

let warned = false;
let fallbackKey: Buffer | null = null;

function getKey(): Buffer {
  if (process.env.ENCRYPTION_KEY) {
    return crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY).digest();
  }

  if (!warned) {
    logger.warn(
      "[SECURITY WARNING] ENCRYPTION_KEY environment variable is not set! " +
      "Falling back to a random in-memory key. Encrypted tokens will NOT persist across server restarts."
    );
    warned = true;
  }

  if (!fallbackKey) {
    fallbackKey = crypto.randomBytes(32);
  }
  return fallbackKey;
}

/**
 * Encrypts plaintext string using AES-256-GCM
 * Returns string formatted as: iv:authTag:ciphertext (hex encoded)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts string formatted as: iv:authTag:ciphertext (hex encoded)
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";

  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    // If not encrypted in new format, return as-is for backward compatibility
    return encryptedText;
  }

  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const encryptedData = Buffer.from(dataHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
