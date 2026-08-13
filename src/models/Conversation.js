const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    // Only meaningful for role:"assistant" — distinguishes an AI-generated
    // reply from one typed by a human agent during handover.
    via: { type: String, enum: ["ai", "agent"], default: "ai" },
    agentName: { type: String, default: null }, // set when via:"agent"
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const conversationSchema = new mongoose.Schema(
  {
    bot: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true, index: true },
    sessionId: { type: String, required: true, index: true }, // generated client-side, persisted in widget's localStorage
    // "widget" = a real visitor talking through the embedded widget
    // "test"   = the bot owner using the Test Chat tab in the dashboard
    type: { type: String, enum: ["widget", "test"], default: "widget", index: true },

    // Visitor identity captured by the widget's pre-chat form (see Bot.leadConfig).
    // All fields optional/null until the visitor fills the form / verifies.
    visitor: {
      name: { type: String, default: null, trim: true },
      email: { type: String, default: null, trim: true, lowercase: true },
      phone: { type: String, default: null, trim: true },
      emailVerified: { type: Boolean, default: false },
      phoneVerified: { type: Boolean, default: false },
    },

    messages: { type: [messageSchema], default: [] },

    // --- Human handover state machine ---
    // none -> requested -> assigned -> resolved
    // (an unclaimed "requested" conversation can also just sit there if no
    // agent ever accepts it — that's a valid, expected end state for Phase 2)
    handover: {
      status: { type: String, enum: ["none", "requested", "assigned", "resolved"], default: "none" },
      assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
      requestedAt: { type: Date, default: null },
      assignedAt: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

conversationSchema.index({ bot: 1, sessionId: 1 }, { unique: true });
conversationSchema.index({ "handover.status": 1, "handover.requestedAt": 1 });
conversationSchema.index({ "handover.assignedAgent": 1, "handover.status": 1 });

module.exports = mongoose.model("Conversation", conversationSchema);