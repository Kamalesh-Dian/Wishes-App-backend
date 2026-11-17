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

// General rate limiter for all /api endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: true,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});
app.use("/api", generalLimiter);

// Stricter rate limiter for expensive generation and upload endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: true,
  message: {
    success: false,
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
