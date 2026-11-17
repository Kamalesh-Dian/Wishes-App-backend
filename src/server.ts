import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { connectDB } from "./config/db";
import { verifyTransporter } from "./services/email/transporter";
import { startAutomationCron } from "./cron/automation.cron";
import { logger } from "./utils/logger";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    await verifyTransporter();
    startAutomationCron();

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.fatal({ err: error }, "Server startup failed");
    process.exit(1);
  }
}

startServer();
