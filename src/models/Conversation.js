const mongoose = require("mongoose");

// A single button/chip shown under a message. `value` is what gets sent
// back as the visitor's next message when tapped (falls back to `label`).
const richButtonSchema = new mongoose.Schema(
  { label: { type: String, required: true }, value: { type: String, default: null } },
  { _id: false }
);

// Rich, structured content attached to a message — buttons, quick-reply
// chips, or a simple card (image + title/subtitle + optional buttons).
// Optional on every message; plain-text messages simply omit it.
const richContentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["buttons", "quick_replies", "card"], required: true },
    buttons: { type: [richButtonSchema], default: [] }, // used by "buttons" and "quick_replies"
    card: {
      title: { type: String, default: null },
      subtitle: { type: String, default: null },
      imageUrl: { type: String, default: null },
      buttons: { type: [richButtonSchema], default: [] },
    },
  },
  { _id: false }
);

// A media attachment on a message — an uploaded image/file, stored on disk
// under a path scoped to owner/bot/actor (see storage.service.js).
const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true }, // public URL, e.g. /uploads/<owner>/<bot>/...
    fileName: { type: String, default: null },
    mimeType: { type: String, default: null },
    size: { type: Number, default: null }, // bytes
    kind: { type: String, enum: ["image", "file"], default: "file" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    // Free-text content. Media-only messages may leave this empty — the
    // controller layer requires at least one of content/media/richContent.
    content: { type: String, required: false, default: "" },
    // Only meaningful for role:"assistant" — distinguishes an AI-generated
    // reply from one typed by a human agent during handover.
    via: { type: String, enum: ["ai", "agent"], default: "ai" },
    agentName: { type: String, default: null }, // set when via:"agent"

    // "text" (default) | "image" | "file" — drives how the widget renders
    // this message. Media messages carry a populated `media` object.
    contentType: { type: String, enum: ["text", "image", "file"], default: "text" },
    media: { type: mediaSchema, default: null },

    // Structured buttons/quick-replies/card, independent of contentType —
    // a text message can still carry quick-reply chips underneath it.
    richContent: { type: richContentSchema, default: null },

    // If a canned response (macro) was used to send this message.
    cannedResponse: { type: mongoose.Schema.Types.ObjectId, ref: "CannedResponse", default: null },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const conversationSchema = new mongoose.Schema(
  {
    bot: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true, index: true },
    sessionId: { type: String, required: true, index: true }, // generated client-side, persisted in widget's localStorage
    // "widget"   = a real visitor talking through the embedded widget
    // "test"     = the bot owner using the Test Chat tab in the dashboard
    // "whatsapp" = a visitor messaging the bot's connected WhatsApp number
    type: { type: String, enum: ["widget", "test", "whatsapp"], default: "widget", index: true },

    // Visitor identity captured by the widget's pre-chat form (see Bot.leadConfig).
    // All fields optional/null until the visitor fills the form / verifies.
    // For type:"whatsapp", `phone` is set immediately from the sender's
    // WhatsApp number (sessionId IS that number) rather than a form.
    visitor: {
      name: { type: String, default: null, trim: true },
      email: { type: String, default: null, trim: true, lowercase: true },
      phone: { type: String, default: null, trim: true },
      emailVerified: { type: Boolean, default: false },
      phoneVerified: { type: Boolean, default: false },
      // BCP-47-ish language code the visitor is chatting in (e.g. "en",
      // "hi", "es"). Drives both the widget's UI strings and an instruction
      // appended to the AI's system prompt to reply in this language.
      language: { type: String, default: "en" },
    },

    messages: { type: [messageSchema], default: [] },

    // --- Human handover state machine ---
    // none -> requested -> assigned -> resolved
    // (an unclaimed "requested" conversation can also just sit there if no
    // agent ever accepts it — that's a valid, expected end state for Phase 2)
    // "offHours" is a terminal, agent-free state: the visitor asked for a
    // human outside business hours, so we captured them as a lead instead
    // of creating a real request. See handover.service.js#requestHandover.
    handover: {
      status: {
        type: String,
        enum: ["none", "requested", "assigned", "resolved", "offHours"],
        default: "none",
      },
      // Whoever is CURRENTLY handling this conversation (null once
      // resolved/unassigned). Kept for all the existing queries/indexes
      // that filter "my active chats" by this field — `history` below is
      // what makes every agent who has EVER touched this conversation
      // visible, not just the latest one.
      assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
      requestedAt: { type: Date, default: null },
      assignedAt: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },

      // --- Assignment history (every agent who has handled this chat) ---
      // One entry per assignment period. A conversation that's accepted,
      // then transferred, then resolved ends up with 2 entries: the first
      // agent's (endReason:"transferred") and the second agent's
      // (endReason:"resolved"). `endedAt`/`endReason` are null while an
      // entry is the CURRENT (still-active) assignment.
      history: {
        type: [
          {
            _id: false,
            agent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", required: true },
            agentName: { type: String, default: null }, // snapshot, survives agent deletion
            assignedAt: { type: Date, default: Date.now },
            endedAt: { type: Date, default: null },
            endReason: {
              type: String,
              enum: [null, "transferred", "resolved"],
              default: null,
            },
          },
        ],
        default: [],
      },

      // --- CSAT (post-resolution rating) ---
      // Prompted once, right after an agent marks the chat resolved. `null`
      // rating means "prompted but not yet answered (or skipped)". For
      // type:"whatsapp" conversations the "prompt" is an interactive list
      // message (see handover.service.js#resolveHandover /
      // whatsapp.controller.js's list_reply handling) instead of the
      // widget's in-UI star picker, but it's stored the exact same way.
      csat: {
        promptedAt: { type: Date, default: null },
        rating: { type: Number, min: 1, max: 5, default: null },
        comment: { type: String, default: null },
        ratedAt: { type: Date, default: null },
      },
    },
  },
  { timestamps: true }
);

conversationSchema.index({ bot: 1, sessionId: 1 }, { unique: true });
conversationSchema.index({ "handover.status": 1, "handover.requestedAt": 1 });
conversationSchema.index({ "handover.assignedAgent": 1, "handover.status": 1 });

module.exports = mongoose.model("Conversation", conversationSchema);