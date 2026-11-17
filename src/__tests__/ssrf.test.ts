import { describe, it, expect, vi, beforeEach } from "vitest";
import dns from "node:dns";
import { isPrivateIp, validateSafeUrl } from "../services/imageProcessor";

describe("SSRF Protection (Item 4)", () => {
  describe("isPrivateIp", () => {
    it("should identify IPv4 loopback as private", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(true);
      expect(isPrivateIp("127.255.255.255")).toBe(true);
    });

    it("should identify 10.0.0.0/8 as private", () => {
      expect(isPrivateIp("10.0.0.1")).toBe(true);
      expect(isPrivateIp("10.254.254.254")).toBe(true);
    });

    it("should identify 172.16.0.0/12 as private", () => {
      expect(isPrivateIp("172.16.0.1")).toBe(true);
      expect(isPrivateIp("172.31.255.255")).toBe(true);
      expect(isPrivateIp("172.32.0.1")).toBe(false);
    });

    it("should identify 192.168.0.0/16 as private", () => {
      expect(isPrivateIp("192.168.0.1")).toBe(true);
      expect(isPrivateIp("192.168.100.50")).toBe(true);
    });

    it("should identify cloud metadata IP 169.254.169.254 as private/link-local", () => {
      expect(isPrivateIp("169.254.169.254")).toBe(true);
      expect(isPrivateIp("169.254.1.1")).toBe(true);
    });

    it("should identify IPv6 loopback, local and link-local as private", () => {
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("fc00::1")).toBe(true);
      expect(isPrivateIp("fd00::1234")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
    });

    it("should allow legitimate public IPs", () => {
      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("1.1.1.1")).toBe(false);
      expect(isPrivateIp("142.250.190.46")).toBe(false);
    });
  });

  describe("validateSafeUrl", () => {
    it("should reject non-https URLs", async () => {
      await expect(validateSafeUrl("http://example.com/image.png")).rejects.toThrow(
        "Only https: URLs are permitted"
      );
      await expect(validateSafeUrl("file:///etc/passwd")).rejects.toThrow(
        "Only https: URLs are permitted"
      );
    });

    it("should block private IP literals in https URLs", async () => {
      await expect(validateSafeUrl("https://127.0.0.1/secret.png")).rejects.toThrow(
        "Blocked private or local IP"
      );
      await expect(
        validateSafeUrl("https://169.254.169.254/latest/meta-data")
      ).rejects.toThrow("Blocked private or local IP");
    });

    it("should block hostnames resolving to private IP addresses", async () => {
      vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
        { address: "10.0.0.5", family: 4 },
      ]);

      await expect(
        validateSafeUrl("https://internal.corp.local/avatar.jpg")
      ).rejects.toThrow("Blocked private or local IP address");
    });

    it("should allow safe external public https URLs", async () => {
      vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
      ]);

      const parsed = await validateSafeUrl("https://example.com/avatar.jpg");
      expect(parsed.hostname).toBe("example.com");
    });
  });
});
