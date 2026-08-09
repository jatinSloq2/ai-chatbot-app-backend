const mongoose = require("mongoose");

// Every chat message (widget or test) is logged as an immutable event.
// This is the single source of truth for all analytics — never update/delete
// these, just append. Counters on Bot are derived from this for quick checks.
//
// Design rationale:
// - Bot.messagesThisMonth is a fast counter for limit enforcement (O(1) check)
// - MessageEvent is the full audit log for analytics (queryable by any dimension)
// They are kept in sync: increment Bot counter AND write a MessageEvent atomically.

const messageEventSchema = new mongoose.Schema(
  {
    bot:      { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true, index: true },
    user:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // "widget" = real visitor on a customer site, "test" = owner testing in dashboard
    type: {
      type: String,
      enum: ["widget", "test"],
      required: true,
      index: true,
    },

    // Widget usage tracking — which site embedded this bot
    origin:    { type: String, default: null },  // e.g. "https://acme.com"
    domain:    { type: String, default: null },  // e.g. "acme.com" (parsed from origin)
    userAgent: { type: String, default: null },
    ip:        { type: String, default: null },  // hashed, not raw — privacy-safe

    sessionId: { type: String, default: null, index: true },

    // Message stats
    promptTokensEstimate:    { type: Number, default: 0 }, // rough estimate: chars/4
    responseTokensEstimate:  { type: Number, default: 0 },
    chunksRetrieved:         { type: Number, default: 0 },
    topChunkScore:           { type: Number, default: null },

    // Timing (ms)
    embeddingMs:   { type: Number, default: null },
    retrievalMs:   { type: Number, default: null },
    llmMs:         { type: Number, default: null },
    totalMs:       { type: Number, default: null },

    // Was the response successfully generated?
    success: { type: Boolean, default: true },
    errorMessage: { type: String, default: null },

    // Billing period snapshot (for auditing plan limits at time of message)
    planSlug: { type: String, default: null },
  },
  {
    timestamps: true, // createdAt is when the message was sent
    // Capped at 5M docs — auto-rotates oldest events. Remove cap for full history.
    // capped: { size: 1024 * 1024 * 512, max: 5000000 },
  }
);

// Compound indexes for the analytics queries we run most often
messageEventSchema.index({ bot: 1, createdAt: -1 });
messageEventSchema.index({ bot: 1, type: 1, createdAt: -1 });
messageEventSchema.index({ bot: 1, domain: 1, createdAt: -1 });
messageEventSchema.index({ user: 1, createdAt: -1 });
messageEventSchema.index({ createdAt: -1 }); // for admin platform-wide queries

module.exports = mongoose.model("MessageEvent", messageEventSchema);