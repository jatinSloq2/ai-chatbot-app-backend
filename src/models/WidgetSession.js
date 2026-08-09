const mongoose = require("mongoose");

// One document per unique sessionId. Created/updated when a visitor chats.
// Gives you per-session analytics: how long they chatted, which pages, etc.
const widgetSessionSchema = new mongoose.Schema(
  {
    bot:       { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true, index: true },
    sessionId: { type: String, required: true, index: true },

    // Where the widget was loaded from
    origin:    { type: String, default: null }, // full origin e.g. "https://acme.com"
    domain:    { type: String, default: null }, // just "acme.com"
    country:   { type: String, default: null }, // from CF-IPCountry header if behind Cloudflare
    userAgent: { type: String, default: null },
    ipHash:    { type: String, default: null }, // sha256 of IP — identifies unique visitors without storing PII

    // Pages the visitor was on when they chatted (they may navigate around)
    referrerPages: { type: [String], default: [] },

    // Aggregated stats for this session
    messageCount:   { type: Number, default: 0 },
    firstMessageAt: { type: Date, default: null },
    lastMessageAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

widgetSessionSchema.index({ bot: 1, sessionId: 1 }, { unique: true });
widgetSessionSchema.index({ bot: 1, domain: 1 });
widgetSessionSchema.index({ bot: 1, createdAt: -1 });

module.exports = mongoose.model("WidgetSession", widgetSessionSchema);