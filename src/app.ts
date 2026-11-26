import express from "express";
import cors from "cors";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import uploadRoutes from "./routes/upload.routes";
import generateRoutes from "./routes/generate.routes";
import historyRoutes from "./routes/history.routes";
import eventRoutes from "./routes/event.routes";
import onedriveRoutes from "./routes/onedrive.routes";
import automationRoutes from "./routes/automation.routes";
import userRoutes from "./routes/user.routes";

const app = express();

// Security headers with Helmet
app.use(helmet());

// Restrict CORS to FRONTEND_URL (comma-separated allowed origins)
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked origin: ${origin}`));
      }
    },
    credentials: true,
  }),
);

// Body parsing with reduced 10mb limit
app.use(
  express.json({
    limit: "10mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

// General rate limiter for all /api endpoints (skip async job status polling)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: true,
  skip: (req) => req.method === "GET" && req.path.endsWith("/status"),
  message: {
    success: false,
    error: "Too many requests, please try again later.",
    message: "Too many requests, please try again later.",
  },
});
app.use("/api", generalLimiter);

// Stricter rate limiter for expensive generation and upload endpoints (skip GET /:wishId/status polling)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: true,
  skip: (req) => req.method === "GET" && req.path.endsWith("/status"),
  message: {
    success: false,
    error: "Too many generation/upload requests, please slow down.",
    message: "Too many generation/upload requests, please slow down.",
  },
});
app.use("/api/generate", strictLimiter);
app.use("/api/upload", strictLimiter);

app.use("/api/upload", uploadRoutes);
app.use("/api/generate", generateRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/onedrive", onedriveRoutes);
app.use("/api/automation", automationRoutes);
app.use("/api", userRoutes);

app.use(
  "/uploads",
  express.static(
    path.join(
      process.cwd(),
      "uploads",
    ),
  ),
);

export default app;
