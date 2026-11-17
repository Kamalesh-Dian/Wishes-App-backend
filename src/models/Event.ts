import mongoose, { Schema, Document } from "mongoose";

export interface IEvent extends Document {
  userId: string;

  name: string;
  email: string;

  occasion: string;

  eventDate: Date;

  eventMonth: number;

  eventDay: number;

  department: string;

  timezone?: string;

  customMessage?: string;

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

  generatedWishText?: string;

  generatedAt: Date;

  claimedAt?: Date;

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

    generatedWishText: {
      type: String,
      default: "",
    },

    generatedAt: Date,

    claimedAt: Date,

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
