const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
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
  },
  { timestamps: true }
);

conversationSchema.index({ bot: 1, sessionId: 1 }, { unique: true });

module.exports = mongoose.model("Conversation", conversationSchema);