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
    },

    isActive: { type: Boolean, default: true },

    // Denormalized counters for quick limit checks (avoid COUNT queries on every request)
    documentCount: { type: Number, default: 0 },
    messagesThisMonth: { type: Number, default: 0 },
    messagesResetAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

botSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Bot", botSchema);
