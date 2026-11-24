import mongoose, { Schema, Document } from "mongoose";

export interface IEvent extends Document {
  userId: string;

  name: string;
  email: string;
  phone?: string;

  occasion: string;

  eventDate: Date;

  eventMonth: number;

  eventDay: number;

  department: string;

  timezone?: string;

  customMessage?: string;

  mediaType: "image" | "video" | "both";

  deliveryChannel: "email" | "whatsapp" | "both";

  videoModel?: "gemini-omni" | "svd";

  status:
    | "pending"
    | "generating"
    | "generated"
    | "sending"
    | "sent"
    | "failed";

  source: "excel" | "onedrive";

  photoUrl: string;

  generatedWishImage: string;

  generatedWishVideo?: string;

  generatedWishText?: string;

  generatedAt: Date;

  claimedAt?: Date;

  whatsappStatus?: "pending" | "sent" | "failed";

  emailStatus?: "pending" | "sent" | "failed";

  attempts: number;

  lastError?: string;

  createdAt: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    userId: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      default: "",
    },

    occasion: {
      type: String,
      required: true,
    },

    photoUrl: {
      type: String,
      default: "",
    },

    eventDate: {
      type: Date,
      required: true,
    },

    eventMonth: {
      type: Number,
      required: true,
    },

    eventDay: {
      type: Number,
      required: true,
    },

    department: String,

    timezone: {
      type: String,
      default: () => process.env.DEFAULT_TZ || "Asia/Kolkata",
    },

    customMessage: String,

    mediaType: {
      type: String,
      enum: ["image", "video", "both"],
      default: "image",
    },

    deliveryChannel: {
      type: String,
      enum: ["email", "whatsapp", "both"],
      default: "email",
    },

    videoModel: {
      type: String,
      enum: ["gemini-omni", "svd"],
      default: "gemini-omni",
    },

    status: {
      type: String,
      enum: ["pending", "generating", "generated", "sending", "sent", "failed"],
      default: "pending",
    },

    source: {
      type: String,
      default: "excel",
    },

    generatedWishImage: {
      type: String,
      default: "",
    },

    generatedWishVideo: {
      type: String,
      default: "",
    },

    generatedWishText: {
      type: String,
      default: "",
    },

    generatedAt: Date,

    claimedAt: Date,

    whatsappStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },

    emailStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },

    attempts: {
      type: Number,
      default: 0,
    },

    lastError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IEvent>("Event", EventSchema);
