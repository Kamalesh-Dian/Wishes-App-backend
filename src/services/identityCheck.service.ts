import axios from "axios";
import { logger } from "../utils/logger";

export function getIdentityCheckUrl(): string | null {
  const url = process.env.IDENTITY_CHECK_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function getMinSimilarityThreshold(): number {
  const val = parseFloat(process.env.IDENTITY_MIN_SIMILARITY || "0.45");
  return isNaN(val) ? 0.45 : val;
}

/**
 * Compares two images using the external InsightFace microservice.
 * Returns similarity (0.0 to 1.0) or null if service is unconfigured or unreachable.
 */
export async function compareFaces(
  image1: string,
  image2: string
): Promise<number | null> {
  const serviceUrl = getIdentityCheckUrl();
  if (!serviceUrl) {
    // Unconfigured: skip silently
    return null;
  }

  try {
    const res = await axios.post<{ similarity: number }>(
      `${serviceUrl}/compare`,
      {
        image1,
        image2,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      }
    );

    if (typeof res.data?.similarity === "number") {
      logger.info(
        { similarity: res.data.similarity },
        "Facial likeness comparison completed"
      );
      return res.data.similarity;
    }
    return null;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: errMsg, url: serviceUrl },
      "Identity check service unreachable; skipping comparison silently"
    );
    return null;
  }
}
