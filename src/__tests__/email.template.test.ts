import { describe, it, expect, beforeEach } from "vitest";
import {
  escapeHtml,
  isValidCloudinaryImageUrl,
  buildWishTemplate,
} from "../services/email/emailTemplate";

describe("Email Template Security (Item 5)", () => {
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "wishes-cloud";
  });

  describe("escapeHtml", () => {
    it("should escape special HTML characters", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
      );
      expect(escapeHtml('John "The Boss" & Co.')).toBe(
        "John &quot;The Boss&quot; &amp; Co."
      );
    });
  });

  describe("isValidCloudinaryImageUrl", () => {
    it("should accept valid Cloudinary HTTPS URLs", () => {
      expect(
        isValidCloudinaryImageUrl(
          "https://res.cloudinary.com/wishes-cloud/image/upload/v12345/wish.jpg"
        )
      ).toBe(true);
    });

    it("should reject non-HTTPS URLs", () => {
      expect(
        isValidCloudinaryImageUrl(
          "http://res.cloudinary.com/wishes-cloud/image/upload/v12345/wish.jpg"
        )
      ).toBe(false);
    });

    it("should reject non-Cloudinary domains", () => {
      expect(
        isValidCloudinaryImageUrl("https://attacker.com/fake-image.png")
      ).toBe(false);
      expect(
        isValidCloudinaryImageUrl("https://res.cloudinary.com.attacker.com/test.png")
      ).toBe(false);
    });

    it("should reject Cloudinary URLs from an unauthorized cloud name", () => {
      expect(
        isValidCloudinaryImageUrl(
          "https://res.cloudinary.com/different-cloud/image/upload/sample.jpg"
        )
      ).toBe(false);
    });
  });

  describe("buildWishTemplate", () => {
    it("should throw an error for non-Cloudinary image URLs", () => {
      expect(() =>
        buildWishTemplate(
          "Alice",
          "Birthday",
          "https://evil.com/xss.png",
          "Happy Birthday!"
        )
      ).toThrow("Must be a secure Cloudinary image URL");
    });

    it("should escape malicious name, occasion, and customMessage", () => {
      const validCloudinaryUrl =
        "https://res.cloudinary.com/wishes-cloud/image/upload/banner.png";

      const html = buildWishTemplate(
        "<img src=x onerror=alert(1)>",
        "Anniversary<script>",
        validCloudinaryUrl,
        "<b>Custom message with <i>HTML</i></b>"
      );

      // Verify dangerous tags are escaped
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).not.toContain("Anniversary<script>");
      expect(html).toContain("Anniversary&lt;script&gt;");
      expect(html).not.toContain("<b>Custom message");
      expect(html).toContain("&lt;b&gt;Custom message with &lt;i&gt;HTML&lt;/i&gt;&lt;/b&gt;");
      expect(html).toContain(validCloudinaryUrl);
    });
  });
});
