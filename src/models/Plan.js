const mongoose = require("mongoose");

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // "Free", "Starter", "Pro"
    slug: { type: String, required: true, unique: true }, // "free", "starter", "pro"
    description: { type: String },

    // --- Dual currency pricing ---
    // Store as smallest currency unit (paise for INR, cents for USD) to avoid float issues
    price: {
      inr: { type: Number, required: true, default: 0 }, // in paise (₹100 = 10000)
      usd: { type: Number, required: true, default: 0 }, // in cents ($10 = 1000)
    },
    interval: {
      type: String,
      enum: ["month", "quarter", "year"],
      default: "month",
    },

    // --- Limits enforced by planLimits middleware ---
    limits: {
      maxBots: { type: Number, required: true, default: 1 },
      maxDocumentsPerBot: { type: Number, required: true, default: 5 },
      maxMessagesPerMonth: { type: Number, required: true, default: 100 },
      allowUserOwnApiKey: { type: Boolean, default: true }, // BYOK always allowed even on free
      allowedProviders: {
        type: [String],
        default: ["ollama"], // paid plans can add "openai", "anthropic" as platform-provided
      },

      // --- Agent System limits ---
      maxAgents: { type: Number, required: true, default: 0 }, // 0 = no agent seats on this plan
      maxTeams: { type: Number, required: true, default: 0 },
      maxAgentsPerTeam: { type: Number, required: true, default: 0 },
      allowWhatsApp: { type: Boolean, default: false },
      allowTools: { type: Boolean, default: false },

      // --- Monetization: widget watermark removal ---
      // When true, bots on this plan may hide the "Powered by JestBot"
      // watermark from their embedded widget. Free plan keeps it visible.
      hideWatermark: { type: Boolean, default: false },
    },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Plan", planSchema);