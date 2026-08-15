const mongoose = require("mongoose");

const botSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    systemPrompt: {
      type: String,
      default:
        "You are a helpful assistant. Answer the user's question using only the provided context. If the answer isn't in the context, say you don't know.",
    },

    // --- API keys for this bot ---
    publicKey: { type: String, required: true, unique: true, index: true }, // used by embed widget
    secretKeyHash: { type: String, required: true }, // used for data-management API (hashed)

    // Restrict which domains the public widget key can be used from (optional)
    allowedDomains: { type: [String], default: [] }, // empty = allow all

    // --- LLM config (chat generation) ---
    llmConfig: {
      provider: {
        type: String,
        default: "ollama",
      },
      model: { type: String, default: "llama3.1" },
      // Encrypted user-provided key (BYOK). Null = use platform default (Ollama, free)
      encryptedApiKey: { type: String, default: null },
      temperature: { type: Number, default: 0.7 },
    },

    // --- Embedding config (for RAG) ---
    embeddingConfig: {
      provider: {
        type: String,
        default: "ollama",
      },
      model: { type: String, default: "nomic-embed-text" },
      encryptedApiKey: { type: String, default: null },
      // Tracks the exact model+dimension used for THIS bot's currently stored
      // chunks. If a user changes provider/model, we compare against this to
      // detect a mismatch before it silently breaks retrieval.
      lockedDimension: { type: Number, default: null },
    },

    // --- Widget appearance (used by embed script) ---
    widgetConfig: {
      title: { type: String, default: "Chat with us" },
      primaryColor: { type: String, default: "#4F46E5" },
      welcomeMessage: { type: String, default: "Hi! How can I help you today?" },
      position: { type: String, enum: ["bottom-right", "bottom-left"], default: "bottom-right" },
      // Up to 5 quick-question bubbles shown on the widget's opening screen
      // (alongside the welcome message, before the visitor has sent
      // anything). Tapping one sends its text as the visitor's first
      // message, exactly as if they had typed it.
      faqs: {
        type: [String],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 5,
          message: "You can add up to 5 quick questions",
        },
      },
    },

    // --- Pre-chat lead capture (widget) ---
    // Controls the form shown to a visitor before they can start chatting.
    leadConfig: {
      enabled: { type: Boolean, default: false }, // show the pre-chat form at all

      collectName: { type: Boolean, default: true },
      nameRequired: { type: Boolean, default: false },

      // Only ONE identifier is collected at a time — email OR phone, never both.
      identifierType: { type: String, enum: ["none", "email", "phone"], default: "email" },
      identifierRequired: { type: Boolean, default: true },

      // If true, the visitor must enter an OTP (sent by email or SMS,
      // matching identifierType) before the chat unlocks.
      verifyIdentifier: { type: Boolean, default: false },
    },

    // --- Human agent handover (Agent System) ---
    // Which agents/teams can be handed a conversation on this bot, and
    // whether handover is offered at all. The actual handover trigger logic
    // (context-fails detection, assignment engine, etc.) is a later phase —
    // this is just the config surface + ownership relationships.
    assignedAgents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
    assignedTeams: [{ type: mongoose.Schema.Types.ObjectId, ref: "Team" }],
    agentConfig: {
      assignEnabled: { type: Boolean, default: false }, // "agents_assign_enabled"
      // Number of visitor messages that must be exchanged in a conversation
      // before the "Talk to a human agent" option is offered in the widget.
      // Keeps agents from being pulled in on message 1 — the AI gets a fair
      // shot first. Configurable per bot, shown next to the agent/team
      // selection in the dashboard.
      handoverMessageThreshold: { type: Number, default: 10, min: 1, max: 50 },
    },

    isActive: { type: Boolean, default: true },

    // Denormalized counters for quick limit checks (avoid COUNT queries on every request)
    documentCount: { type: Number, default: 0 },
    messagesThisMonth: { type: Number, default: 0 },
    messagesResetAt: { type: Date, default: Date.now },
    testMessagesTotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

botSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Bot", botSchema);