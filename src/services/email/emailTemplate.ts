export interface EmailTemplateOptions {
  headerTitle?: string;
  accentColor?: string;
  signature?: string;
  companyFooter?: string;
}

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isValidCloudinaryImageUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:") return false;

    // Check Cloudinary domain
    if (parsed.hostname !== "res.cloudinary.com") {
      return false;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (cloudName && !parsed.pathname.startsWith(`/${cloudName}/`)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function buildWishTemplate(
  name: string,
  occasion: string,
  imageUrl: string,
  customMessage?: string,
  options?: EmailTemplateOptions,
) {
  if (!isValidCloudinaryImageUrl(imageUrl)) {
    throw new Error("Invalid image URL: Must be a secure Cloudinary image URL");
  }

  const safeName = escapeHtml(name);
  const safeOccasion = escapeHtml(occasion);
  const safeCustomMessage = customMessage
    ? escapeHtml(customMessage)
    : "Wishing you success, happiness and wonderful memories.";

  const rawHeader = options?.headerTitle || `🎉 Happy {occasion} {name}!`;
  const safeHeader = escapeHtml(rawHeader)
    .replace(/{name}/g, safeName)
    .replace(/{occasion}/g, safeOccasion);

  const safeSignature = escapeHtml(options?.signature || "Regards,\nAI Wishes Team");
  const safeCompanyFooter = escapeHtml(options?.companyFooter || "DIAN Technology Solutions");

  // Validate CSS hex color to prevent CSS injection
  const accentColor = /^#[0-9a-fA-F]{3,8}$/.test(options?.accentColor || "")
    ? options!.accentColor!
    : "#0d9488";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body {
  font-family: Arial, sans-serif;
  background: #f3f5f8;
  padding: 40px;
}
.container {
  max-width: 700px;
  margin: auto;
  background: white;
  padding: 30px;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.08);
  border-top: 6px solid ${accentColor};
}
h2 {
  color: ${accentColor};
  margin-top: 0;
}
img {
  width: 100%;
  border-radius: 12px;
  margin-top: 25px;
}
.footer {
  margin-top: 30px;
  color: #666;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-line;
  border-top: 1px solid #eee;
  padding-top: 20px;
}
.company {
  font-weight: bold;
  color: #333;
  margin-top: 4px;
}
</style>
</head>
<body>
<div class="container">
  <h2>${safeHeader}</h2>
  <p>${safeCustomMessage}</p>
  <img src="${imageUrl}" />
  <div class="footer">
    ${safeSignature}
    <div class="company">${safeCompanyFooter}</div>
  </div>
</div>
</body>
</html>
`;
}
