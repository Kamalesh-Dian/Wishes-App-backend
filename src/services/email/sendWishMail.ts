import { transporter } from "./transporter";
import { buildWishTemplate } from "./emailTemplate";
import { logger } from "../../utils/logger";

interface MailPayload {
  to: string;
  name: string;
  occasion: string;
  imageUrl?: string;
  videoUrl?: string;
  customMessage?: string;
}

export async function sendWishMail(data: MailPayload) {
  const imageUrl = data.imageUrl || "";

  await transporter.sendMail({
    from: process.env.MAIL_FROM,

    to: data.to,

    subject: `🎉 Happy ${data.occasion} ${data.name}`,

    html: buildWishTemplate(
      data.name,
      data.occasion,
      imageUrl,
      data.customMessage,
      { videoUrl: data.videoUrl },
    ),
  });

  logger.info({ recipient: data.to, occasion: data.occasion }, "Wish email sent successfully");
}
