import path from "path";
import dotenv from "dotenv";

// Load from backend/.env regardless of current working directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../backend/.env") });
dotenv.config();

import app from "./app";
import { connectDB } from "./config/db";
import { verifyTransporter } from "./services/email/transporter";
import { startAutomationCron } from "./cron/automation.cron";
import { recoverStuckWishes } from "./services/jobQueue.service";
import { logger } from "./utils/logger";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    await verifyTransporter();
    startAutomationCron();
    await recoverStuckWishes();

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.fatal({ err: error }, "Server startup failed");
    process.exit(1);
  }
}

startServer();
