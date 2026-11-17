import pino from "pino";

const logLevel =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level: logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "apiKey",
      "uploadedImage",
      "image",
      "base64",
      "req.body.uploadedImage",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
