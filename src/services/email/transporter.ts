import nodemailer from "nodemailer";
import { logger } from "../../utils/logger";

export const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
});

export async function verifyTransporter() {
  try {
    await transporter.verify();
    logger.info("Mail transporter ready");
  } catch (error) {
    logger.error({ err: error }, "Mail transporter verification failed");
  }
}
