import mongoose from "mongoose";
import { logger } from "../utils/logger";

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    logger.fatal("MONGO_URI environment variable is not defined");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    logger.info("MongoDB Connected successfully");
  } catch (error) {
    logger.fatal({ err: error }, "MongoDB Connection Failed");
    process.exit(1);
  }
}
