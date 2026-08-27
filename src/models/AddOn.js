const mongoose = require("mongoose");

// Catalog of purchasable add-ons layered on top of a plan — e.g. "WhatsApp
// Inbox", "Utility Messages (10K)", "Marketing Messages (10K)",
// "Authentication Messages (10K)", "AI Template Builder". Deliberately a
// flat list (no category/type grouping) — each row is its own sellable
// item with its own price, its own optional usage limit, and its own
// billing type. What the add-on actually *unlocks* is not implemented here;
// this only models what's sold and what a user currently owns.
const addOnSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // "WhatsApp Inbox", "Utility Messages"
    slug: { type: String, required: true, unique: true }, // "whatsapp-inbox", "utility-messages-10k"
    description: { type: String },

    // --- Dual currency pricing, same convention as Plan (smallest unit) ---
    price: {
      inr: { type: Number, required: true, default: 0 },
      usd: { type: Number, required: true, default: 0 },
    },

    // "lifetime": one-time purchase, never expires (endDate stays null on
    // the owned record). "recurring": renews on `interval`, same shape as
    // a Plan subscription.
    billingType: {
      type: String,
      enum: ["lifetime", "recurring"],
      required: true,
      default: "lifetime",
    },
    interval: {
      type: String,
      enum: ["month", "quarter", "year"],
      default: null, // only meaningful when billingType === "recurring"
    },

    // --- Optional usage ceiling this add-on grants, e.g. a 10K message
    // pack. Left generic (not WhatsApp-specific) so any future add-on can
    // reuse it. null/0 = no numeric limit (e.g. a feature-unlock add-on).
    limit: {
      amount: { type: Number, default: null }, // e.g. 10000
      unit: { type: String, default: null }, // e.g. "messages"
    },

    // Optional static asset link — e.g. a demo/sample sheet a buyer can
    // download to see the expected format before they buy. Not tied to any
    // real import pipeline; purely a reference download.
    sampleSheetUrl: { type: String, default: null },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AddOn", addOnSchema);