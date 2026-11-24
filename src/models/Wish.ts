import mongoose from "mongoose";

const WishSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
    },
    occasion: {
      type: String,
      required: true,
    },

    theme: {
      type: String,
      required: true,
    },

    generatedImage: {
      type: String,
      default: "",
    },

    cleanImage: {
      type: String,
    },

    videoUrl: {
      type: String,
    },

    status: {
      type: String,
      enum: ["queued", "image", "video", "done", "failed"],
      default: "queued",
    },

    videoTier: {
      type: String,
      enum: ["ai-video", "animated-card"],
    },

    identityScore: {
      type: Number,
    },

    needsReview: {
      type: Boolean,
      default: false,
    },

    error: {
      type: String,
    },

    people: [
      {
        type: String,
      },
    ],

    decorations: [
      {
        type: String,
      },
    ],

    customMessage: {
      type: String,
    },

    animationEnabled: {
      type: Boolean,
      default: false,
    },

    aiProvider: {
      type: String,
      default: "Gemini",
    },

    prompt: {
      type: String,
    },

    downloads: {
      type: Number,
      default: 0,
    },

    shares: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Wish", WishSchema);
