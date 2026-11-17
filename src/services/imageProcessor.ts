import sharp from "sharp";
import dns from "node:dns";
import net from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local, cloud metadata service 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved)
    if (parts[0] >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback ::1
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
    // Unspecified ::
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
    // IPv4-mapped IPv6 ::ffff:x.x.x.x
    if (normalized.startsWith("::ffff:")) {
      const ipv4Part = normalized.substring(7);
      if (net.isIPv4(ipv4Part)) return isPrivateIp(ipv4Part);
    }
    // Unique local address fc00::/7 (starts with fc or fd)
    if (/^[fF][cCdD]/.test(normalized)) return true;
    // Link-local address fe80::/10 (starts with fe8, fe9, fea, feb)
    if (/^[fF][eE][89aAbB]/.test(normalized)) return true;
    return false;
  }

  return true; // Any non-standard format is blocked
}

export async function validateSafeUrl(urlString: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only https: URLs are permitted");
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error("URL missing hostname");
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked private or local IP: ${hostname}`);
    }
    return parsed;
  }

  // Resolve hostname via DNS
  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (!addresses || addresses.length === 0) {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  for (const record of addresses) {
    if (isPrivateIp(record.address)) {
      throw new Error(`Blocked private or local IP address for ${hostname}: ${record.address}`);
    }
  }

  return parsed;
}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB limit
const TIMEOUT_MS = 10000; // 10 seconds

export async function fetchSafeImage(initialUrl: string): Promise<Buffer> {
  let currentUrl = initialUrl;
  let redirects = 0;

  while (redirects <= MAX_REDIRECTS) {
    const validatedUrl = await validateSafeUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(validatedUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "WishesAI-ImageProcessor/1.0",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Handle Redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("Redirect response missing Location header");
        }
        currentUrl = new URL(location, validatedUrl).toString();
        redirects++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} downloading image`);
      }

      // Verify Content-Type is an image
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        throw new Error(`Invalid content-type: '${contentType}'. Expected an image.`);
      }

      // Check Content-Length header if provided
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
        throw new Error(`File size ${contentLength} bytes exceeds 10MB limit`);
      }

      // Read response body stream with 10MB cap
      if (!response.body) {
        throw new Error("Empty response body");
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > MAX_BYTES) {
            reader.cancel();
            throw new Error("Image download exceeded maximum 10MB limit");
          }
          chunks.push(value);
        }
      }

      return Buffer.concat(chunks);
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error("Image fetch timed out after 10 seconds");
      }
      throw err;
    }
  }

  throw new Error("Too many redirects");
}

function getDirectDownloadUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Google Drive
    if (urlObj.hostname.includes("drive.google.com")) {
      const matchFileId = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (matchFileId && matchFileId[1]) {
        return `https://drive.google.com/uc?export=download&id=${matchFileId[1]}`;
      }
      const fileIdParam = urlObj.searchParams.get("id");
      if (fileIdParam) {
        return `https://drive.google.com/uc?export=download&id=${fileIdParam}`;
      }
    }

    // Dropbox
    if (urlObj.hostname.includes("dropbox.com")) {
      urlObj.searchParams.set("dl", "1");
      return urlObj.toString();
    }

    // SharePoint
    if (urlObj.hostname.includes("sharepoint.com")) {
      const match = url.match(/https:\/\/([^/]+)\/(?::[a-z]:\/g\/)?personal\/([^/]+)\/([A-Za-z0-9_-]+)/);
      if (match) {
        const tenantHost = match[1];
        const personalUser = match[2];
        const token = match[3];
        return `https://${tenantHost}/personal/${personalUser}/_layouts/15/download.aspx?share=${token}`;
      }
      urlObj.searchParams.set("download", "1");
      return urlObj.toString();
    }

    // OneDrive / 1drv.ms
    if (
      urlObj.hostname.includes("1drv.ms") ||
      urlObj.hostname.includes("onedrive.live.com")
    ) {
      urlObj.searchParams.set("download", "1");
      return urlObj.toString();
    }

    return url;
  } catch {
    return url;
  }
}

export async function compressImageFromUrl(imageUrl: string): Promise<string> {
  const directUrl = getDirectDownloadUrl(imageUrl);
  const buffer = await fetchSafeImage(directUrl);

  // Validate that buffer is a valid image using sharp
  try {
    await sharp(buffer).metadata();
  } catch {
    throw new Error("The downloaded data is not a valid image format");
  }

  const fileSizeMB = buffer.length / 1024 / 1024;

  if (fileSizeMB < 1) {
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  }

  const quality = fileSizeMB >= 2 ? 60 : 80;

  const compressed = await sharp(buffer)
    .jpeg({
      quality,
    })
    .toBuffer();

  return `data:image/jpeg;base64,${compressed.toString("base64")}`;
}
